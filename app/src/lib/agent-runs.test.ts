import assert from "node:assert/strict";
import test from "node:test";
import type { AgentEvent, CoordinatorState, ModelOption, PermissionRequest, QuestionRequest } from "../model";
import { applyAgentEvent, chatInProject, chatsWaitingForApproval, chatKey, clearAnswered, markAnswered, modelForChat, sentDecision, sentReply, sessionIdFromKey, startRun, splitRunForSteer } from "./agent-runs.ts";
import type { AgentRuns } from "./agent-runs.ts";

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

test("chat keys name a project and a session, even when the path contains #", () => {
  assert.equal(chatKey("/work/app", 2), "/work/app#2");
  assert.equal(sessionIdFromKey(chatKey("/work/app", 2)), 2);
  assert.equal(chatKey("/tmp/a#b", 12), "/tmp/a#b#12");
  assert.equal(sessionIdFromKey(chatKey("/tmp/a#b", 12)), 12);
  assert.ok(Number.isNaN(sessionIdFromKey("/work/app")));
  assert.ok(Number.isNaN(sessionIdFromKey("/work/app#")));

  assert.equal(chatInProject("/tmp/a#b", chatKey("/tmp/a#b", 12)), true);
  assert.equal(chatInProject("/tmp/a", chatKey("/tmp/a#b", 12)), false);
  assert.equal(chatInProject("/tmp/a#b", chatKey("/tmp/a", 12)), false);
});

test("saves and forgets the agent's native session id", () => {
  const started = applyAgentEvent(base(), {}, PROJECT, key(1), { type: "session-started", nativeId: "thread-1" });
  assert.equal(started.changed, true);
  assert.equal(started.state.sessions["1"].native_session_id, "thread-1");
  assert.equal(applyAgentEvent(started.state, {}, PROJECT, key(1), { type: "session-started", nativeId: "thread-1" }).changed, false);

  const reset = applyAgentEvent(base(), {}, PROJECT, key(2), { type: "session-reset" });
  assert.equal(reset.changed, true);
  assert.equal("native_session_id" in reset.state.sessions["2"], false);
});

test("streams text per chat and saves each finished reply once", () => {
  let state = base();
  let runs = startRun(startRun({}, key(1), "gpt-6-sol"), key(2), "claude-opus-5-5");
  for (const [sessionId, text] of [[1, "Hel"], [2, "Hi"], [1, "lo"], [2, " there"]] as const) {
    ({ state, runs } = applyAgentEvent(state, runs, PROJECT, key(sessionId), { type: "text-delta", messageId: "t", text }));
  }
  assert.equal(runs[key(1)].text, "Hello");
  assert.equal(runs[key(2)].text, "Hi there");

  const first = applyAgentEvent(state, runs, PROJECT, key(2), { type: "turn-completed" });
  const second = applyAgentEvent(first.state, first.runs, PROJECT, key(1), { type: "turn-completed" });
  assert.equal(second.changed, true);
  assert.deepEqual(second.runs, {});
  assert.deepEqual(second.state.messages.map(({ id, session_id, body, role, model, outcome }) => ({ id, session_id, body, role, model, outcome })), [
    { id: 10, session_id: 2, body: "Hi there", role: "assistant", model: "claude-opus-5-5", outcome: "completed" },
    { id: 11, session_id: 1, body: "Hello", role: "assistant", model: "gpt-6-sol", outcome: "completed" },
  ]);
  assert.equal(second.state.next_id, 12);
});

test("keeps partial text when a turn fails or is cancelled", () => {
  const runs = { [key(1)]: { text: "Half an answer", model: "gpt-6-sol", approvals: [], questions: [], answered: {} } };
  const failed = applyAgentEvent(base(), runs, PROJECT, key(1), { type: "turn-failed", message: "Codex stopped: boom" });
  assert.equal(failed.state.messages[0].body, "Half an answer\n\nAgent error: Codex stopped: boom");
  assert.equal(failed.state.messages[0].outcome, "failed");

  const cancelled = applyAgentEvent(base(), { [key(1)]: { text: "", model: "gpt-6-sol", approvals: [], questions: [], answered: {} } }, PROJECT, key(1), { type: "turn-cancelled" });
  assert.equal(cancelled.state.messages[0].body, "Agent run cancelled.");
  assert.equal(cancelled.state.messages[0].outcome, "cancelled");
});

test("ignores events for chats with nothing running", () => {
  const state = base();
  assert.deepEqual(applyAgentEvent(state, {}, PROJECT, key(1), { type: "text-delta", messageId: "t", text: "x" }), { state, runs: {}, changed: false });
  assert.deepEqual(applyAgentEvent(state, {}, PROJECT, key(1), { type: "turn-completed" }), { state, runs: {}, changed: false });
});

test("a key from another project path never touches this state", () => {
  const state = base();
  // "/work/app#x" + "#2" starts with "/work/app#" but belongs to the project at "/work/app#x".
  for (const other of ["/work/other", "/work", "/work/app#x", "/work/app/sub"]) {
    const runs = { [chatKey(other, 2)]: { text: "Not yours", model: "claude-opus-5-5", approvals: [], questions: [], answered: {} } };
    for (const event of [
      { type: "session-started", nativeId: "foreign" },
      { type: "session-reset" },
      { type: "text-delta", messageId: "t", text: "x" },
      { type: "turn-completed" },
    ] as const) {
      assert.deepEqual(applyAgentEvent(state, runs, PROJECT, chatKey(other, 2), event), { state, runs, changed: false });
    }
  }
});

test("an unknown session id is a no-op", () => {
  const state = base();
  const runs = { [key(99)]: { text: "Orphan", model: "gpt-6-sol", approvals: [], questions: [], answered: {} } };
  for (const chatId of [key(99), `${PROJECT}#`, `${PROJECT}#abc`]) {
    assert.deepEqual(applyAgentEvent(state, runs, PROJECT, chatId, { type: "session-started", nativeId: "x" }), { state, runs, changed: false });
    assert.deepEqual(applyAgentEvent(state, runs, PROJECT, chatId, { type: "turn-completed" }), { state, runs, changed: false });
  }
});

test("an unknown event type changes nothing", () => {
  const state = base();
  const runs = { [key(1)]: { text: "Partial", model: "gpt-6-sol", approvals: [], questions: [], answered: {} } };
  // Later steps add event types (tool steps, approvals); only the three turn endings end a run.
  const event = { type: "tool-started", toolId: "t-1" } as unknown as AgentEvent;
  assert.deepEqual(applyAgentEvent(state, runs, PROJECT, key(1), event), { state, runs, changed: false });
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

const approval = (requestId: string): PermissionRequest => ({ requestId, kind: "command", tool: "Shell", title: "Run this command?", command: "ls", allowForChat: true });

test("turn-started opens a run for a turn this window didn't start", () => {
  const state = { ...base(), messages: [{ id: 5, session_id: 2, body: "One more thing", context: null, role: "user" as const, model: "claude-opus-5-5" }] };
  const opened = applyAgentEvent(state, {}, PROJECT, key(2), { type: "turn-started", turnId: "t-2" });
  assert.deepEqual(opened.runs[key(2)], { text: "", model: "claude-opus-5-5", approvals: [], questions: [], answered: {} });
  assert.equal(opened.changed, false);

  const running = startRun({}, key(2), "claude-sonnet-5-5");
  const kept = applyAgentEvent(state, running, PROJECT, key(2), { type: "turn-started", turnId: "t-2" });
  assert.equal(kept.runs, running);
});

test("approval requests wait on the run, oldest first, until they're resolved", () => {
  let runs = startRun({}, key(1), "gpt-6-sol");
  const state = base();
  for (const requestId of ["a", "b"]) runs = applyAgentEvent(state, runs, PROJECT, key(1), { type: "permission-request", ...approval(requestId) }).runs;
  assert.deepEqual(runs[key(1)].approvals.map((item) => item.requestId), ["a", "b"]);
  assert.deepEqual(runs[key(1)].approvals[0], approval("a"));

  runs = applyAgentEvent(state, runs, PROJECT, key(1), { type: "permission-request", ...approval("a"), title: "Again?" }).runs;
  assert.deepEqual(runs[key(1)].approvals.map((item) => item.requestId), ["b", "a"]);

  runs = applyAgentEvent(state, runs, PROJECT, key(1), { type: "permission-resolved", requestId: "b", decision: "deny" }).runs;
  assert.deepEqual(runs[key(1)].approvals.map((item) => item.requestId), ["a"]);
  runs = applyAgentEvent(state, runs, PROJECT, key(1), { type: "permission-resolved", requestId: "missing", decision: "cancelled" }).runs;
  assert.equal(runs[key(1)].approvals.length, 1);

  const ended = applyAgentEvent(state, runs, PROJECT, key(1), { type: "turn-cancelled" });
  assert.equal(ended.runs[key(1)], undefined);
  assert.equal(applyAgentEvent(state, {}, PROJECT, key(1), { type: "permission-request", ...approval("c") }).runs[key(1)], undefined);
});

test("a steer saves the reply so far and keeps the run going", () => {
  const state = base();
  const runs = { [key(1)]: { text: "  Half an answer \n", model: "gpt-6-sol", approvals: [approval("a")], questions: [], answered: {} } };
  const split = splitRunForSteer(state, runs, PROJECT, key(1));
  assert.equal(split.changed, true);
  assert.deepEqual(split.state.messages.at(-1), { id: state.next_id, session_id: 1, body: "Half an answer", context: null, role: "assistant", model: "gpt-6-sol" });
  assert.equal(split.state.next_id, state.next_id + 1);
  assert.deepEqual(split.runs[key(1)], { text: "", model: "gpt-6-sol", approvals: [approval("a")], questions: [], answered: {}, split: true });

  const cases: Array<[AgentRuns, string]> = [
    [{ [key(1)]: { text: "  ", model: "gpt-6-sol", approvals: [], questions: [], answered: {} } }, key(1)],
    [{}, key(1)],
    [runs, chatKey("/work/other", 1)],
    [runs, key(99)],
  ];
  for (const [testRuns, chatId] of cases) {
    const unchanged = splitRunForSteer(state, testRuns, PROJECT, chatId);
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.state, state);
    assert.equal(unchanged.runs, testRuns);
  }
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

test("a turn that completes with no text after a steer split saves no reply", () => {
  const state = base();
  const runs = { [key(1)]: { text: "Half", model: "gpt-6-sol", approvals: [], questions: [], answered: {} } };
  const split = splitRunForSteer(state, runs, PROJECT, key(1));
  assert.equal(split.runs[key(1)].split, true);
  const done = applyAgentEvent(split.state, split.runs, PROJECT, key(1), { type: "turn-completed" });
  assert.equal(done.runs[key(1)], undefined);
  assert.equal(done.state, split.state);
  assert.equal(done.changed, false);
  const cancelled = applyAgentEvent(split.state, split.runs, PROJECT, key(1), { type: "turn-cancelled" });
  assert.equal(cancelled.state.messages.at(-1)?.body, "Agent run cancelled.");
  const more = applyAgentEvent(split.state, { [key(1)]: { ...split.runs[key(1)], text: "Rest" } }, PROJECT, key(1), { type: "turn-completed" });
  assert.equal(more.state.messages.at(-1)?.body, "Rest");
});

test("chatsWaitingForApproval lists only this project's chats with a pending approval", () => {
  const request = { requestId: "r1" } as PermissionRequest;
  const run = (approvals: PermissionRequest[]) => ({ text: "", model: "m", approvals, questions: [], answered: {} });
  const runs: AgentRuns = {
    [key(1)]: run([request]),
    [key(2)]: run([]),
    [key(3)]: run([request, { requestId: "r2" } as PermissionRequest]),
    [chatKey("/work/app#other", 4)]: run([request]),
    [chatKey("/work/other", 5)]: run([request]),
  };
  assert.deepEqual([...chatsWaitingForApproval(runs, PROJECT)].sort(), [1, 3]);
  assert.equal(chatsWaitingForApproval({}, PROJECT).size, 0);
});

const question = (requestId: string): QuestionRequest => ({ requestId, questions: [{ id: "0", header: "Color", question: "Which color?", options: [{ label: "Red" }, { label: "Green" }], multiSelect: false, allowOther: true, secret: false }] });

test("questions wait on the run, oldest first, until they're resolved", () => {
  const state = base();
  let runs = startRun({}, key(1), "claude-opus-5-5");
  for (const requestId of ["a", "b"]) runs = applyAgentEvent(state, runs, PROJECT, key(1), { type: "question-request", ...question(requestId) }).runs;
  assert.deepEqual(runs[key(1)].questions, [question("a"), question("b")]);
  assert.deepEqual(runs[key(1)].approvals, []);

  runs = markAnswered(runs, key(1), "a", "answered");
  runs = applyAgentEvent(state, runs, PROJECT, key(1), { type: "question-resolved", requestId: "a", outcome: "answered" }).runs;
  assert.deepEqual(runs[key(1)].questions.map((item) => item.requestId), ["b"]);
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
