import assert from "node:assert/strict";
import test from "node:test";
import type { AgentEvent, CoordinatorState, ModelOption, PermissionRequest, QuestionRequest } from "../model";
import {
  chatKey,
  chatsAskingUser,
  chatsRunning,
  chatsWaitingForUser,
  clearAnswered,
  markAnswered,
  modelForChat,
  sentDecision,
  sentReply,
} from "./agent-runs.ts";
import type { AgentRuns } from "./agent-runs.ts";
// Runs are set up with the reducer the main process saves turns with.
import { applyAgentEvent, startRun } from "@milagre/shared/agent-runs";

const PROJECT = "/work/app";
const key = (sessionId: number) => chatKey(PROJECT, sessionId);

const base = (): CoordinatorState => ({
  next_id: 10,
  projects: {},
  worktrees: {},
  sessions: {
    "1": { id: 1, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex" },
    "2": { id: 2, worktree_id: 1, agent_name: "main", status: "Created", provider: "claude", native_session_id: "s-old" },
  },
  connections: {},
  events: [],
  messages: [],
  approvals: [],
  tasks: {},
  artifacts: {},
  outputs: [],
  conflicts: [],
});

test("picks a model from the chat's provider", () => {
  const catalog: ModelOption[] = [
    { id: "gpt-6-sol", name: "GPT-6 Sol", provider: "codex", description: "" },
    { id: "claude-opus-5-5", name: "Claude Opus 5.5", provider: "claude", description: "" },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", provider: "claude", description: "" },
  ];
  const [codex, opus, sonnet] = catalog;
  const lastUsed = [{ id: 1, session_id: 2, body: "hi", context: null, role: "user" as const, model: "claude-sonnet-5-5" }];

  assert.equal(modelForChat(codex, undefined, [], catalog), codex);
  assert.equal(modelForChat(opus, "claude", lastUsed, catalog), opus);
  assert.equal(modelForChat(codex, "claude", lastUsed, catalog), sonnet);
  assert.equal(modelForChat(codex, "claude", [], catalog), opus);
});

const approval = (requestId: string): PermissionRequest => ({
  requestId,
  kind: "command",
  tool: "Shell",
  title: "Run this command?",
  command: "ls",
  allowForChat: true,
});

test("an answer is kept on its chat's run, and a second chat with the same request id is unaffected", () => {
  const runs: AgentRuns = { [key(1)]: startRun({}, key(1), "gpt-6-sol")[key(1)], [key(2)]: startRun({}, key(2), "claude-opus-5-5")[key(2)] };
  assert.deepEqual(runs[key(1)].answered, {});
  const answered = markAnswered(runs, key(1), "7", "allow");
  assert.deepEqual(answered[key(1)].answered, { "7": "allow" });
  assert.deepEqual(answered[key(2)].answered, {});
  assert.equal(markAnswered({}, key(1), "7", "allow").constructor, Object);
  assert.deepEqual(markAnswered({}, key(1), "7", "allow"), {});

  assert.deepEqual(clearAnswered(answered, key(1), "7")[key(1)].answered, {});
  assert.equal(clearAnswered(answered, key(1), "other"), answered);
  assert.equal(clearAnswered({}, key(1), "7").constructor, Object);
  const empty = {};
  assert.equal(clearAnswered(empty, key(1), "7"), empty);

  const opened = applyAgentEvent(base(), {}, PROJECT, key(1), { type: "turn-started", turnId: "t" } as AgentEvent);
  assert.deepEqual(opened.runs[key(1)].answered, {});
});

test("a resolved request drops its answer", () => {
  const runs = markAnswered(startRun({}, key(1), "gpt-6-sol"), key(1), "7", "deny");
  const resolved = applyAgentEvent(base(), runs, PROJECT, key(1), { type: "permission-resolved", requestId: "7", decision: "deny" });
  assert.deepEqual(resolved.runs[key(1)].answered, {});
});

test("chatsWaitingForUser lists only this project's chats with a pending approval or question", () => {
  const request = { requestId: "r1" } as PermissionRequest;
  const run = (approvals: PermissionRequest[]) => ({ text: "", model: "m", approvals, steps: [], questions: [], answered: {} });
  const runs: AgentRuns = {
    [key(1)]: run([request]),
    [key(2)]: run([]),
    [key(3)]: run([request, { requestId: "r2" } as PermissionRequest]),
    [chatKey("/work/app#other", 4)]: run([request]),
    [chatKey("/work/other", 5)]: run([request]),
  };
  assert.deepEqual([...chatsWaitingForUser(runs, PROJECT)].sort(), [1, 3]);
  const asking: AgentRuns = { [key(6)]: { ...run([]), questions: [question("q1")] }, [key(7)]: run([]) };
  assert.deepEqual([...chatsWaitingForUser(asking, PROJECT)], [6]);
  assert.equal(chatsWaitingForUser({}, PROJECT).size, 0);
});

test("chatsAskingUser lists chats with a question and no approval ahead of it", () => {
  const request = { requestId: "r1" } as PermissionRequest;
  const run = (approvals: PermissionRequest[], questions = [question("q1")]) => ({ text: "", model: "m", approvals, steps: [], questions, answered: {} });
  const runs: AgentRuns = { [key(1)]: run([]), [key(2)]: run([request]), [key(3)]: run([], []), [chatKey("/work/other", 4)]: run([]) };
  assert.deepEqual([...chatsAskingUser(runs, PROJECT)], [1]);
});

test("chatsRunning lists only this project's chats with a run", () => {
  const run = { text: "", model: "m", approvals: [], steps: [], questions: [], answered: {} };
  const runs: AgentRuns = { [key(1)]: run, [key(4)]: run, [chatKey("/work/app#other", 2)]: run, [chatKey("/work/other", 3)]: run };
  assert.deepEqual([...chatsRunning(runs, PROJECT)].sort(), [1, 4]);
});

test("chatsRunning counts a chat whose subagents outlive its turn", () => {
  const sessions = base().sessions;
  const agent = (id: string, status: string) => ({ id, status }) as unknown as NonNullable<CoordinatorState["sessions"][string]["subagents"]>[number];
  sessions["1"] = { ...sessions["1"], subagents: [agent("a", "completed"), agent("b", "running")] };
  sessions["2"] = { ...sessions["2"], subagents: [agent("c", "completed")] };
  assert.deepEqual([...chatsRunning({}, PROJECT, sessions)], [1]);
});

const question = (requestId: string): QuestionRequest => ({
  requestId,
  questions: [
    {
      id: "0",
      header: "Color",
      question: "Which color?",
      options: [{ label: "Red" }, { label: "Green" }],
      multiSelect: false,
      allowOther: true,
      secret: false,
    },
  ],
});

test("questions wait on the run, oldest first, until they're resolved", () => {
  const state = base();
  let runs = startRun({}, key(1), "claude-opus-5-5");
  for (const requestId of ["a", "b"]) runs = applyAgentEvent(state, runs, PROJECT, key(1), { type: "question-request", ...question(requestId) }).runs;
  assert.deepEqual(runs[key(1)].questions, [question("a"), question("b")]);
  assert.deepEqual(runs[key(1)].approvals, []);

  runs = markAnswered(runs, key(1), "a", "answered");
  runs = applyAgentEvent(state, runs, PROJECT, key(1), { type: "question-resolved", requestId: "a", outcome: "answered" }).runs;
  assert.deepEqual(
    runs[key(1)].questions.map((item) => item.requestId),
    ["b"],
  );
  assert.deepEqual(runs[key(1)].answered, {});

  const unchanged = applyAgentEvent(state, runs, PROJECT, key(1), { type: "question-resolved", requestId: "missing", outcome: "cancelled" });
  assert.equal(unchanged.runs, runs);
  assert.equal(applyAgentEvent(state, {}, PROJECT, key(1), { type: "question-request", ...question("c") }).runs[key(1)], undefined);
  assert.equal(applyAgentEvent(state, runs, PROJECT, key(1), { type: "turn-cancelled" }).runs[key(1)], undefined);
});

test("what was sent reads back as a decision for approvals and a reply for questions", () => {
  let runs = startRun({}, key(1), "gpt-6-sol");
  runs = markAnswered(markAnswered(markAnswered(runs, key(1), "p", "allow-for-chat"), key(1), "q", "dismissed"), key(1), "r", "answered");
  assert.equal(sentDecision(runs[key(1)], "p"), "allow-for-chat");
  assert.equal(sentDecision(runs[key(1)], "q"), null);
  assert.equal(sentReply(runs[key(1)], "q"), "dismissed");
  assert.equal(sentReply(runs[key(1)], "r"), "answered");
  assert.equal(sentReply(runs[key(1)], "p"), null);
  assert.equal(sentReply(undefined, "q"), null);
});
