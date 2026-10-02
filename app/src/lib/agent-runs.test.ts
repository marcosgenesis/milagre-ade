import assert from "node:assert/strict";
import test from "node:test";
import type { AgentEvent, ChatStep, CoordinatorState, ModelOption, PermissionRequest, QuestionRequest } from "../model";
import { applyAgentEvent, capOutput, chatInProject, chatsRunning, chatsWaitingForUser, chatKey, clearAnswered, markAnswered, modelForChat, recordAnswers, sentDecision, sentReply, sessionIdFromKey, startRun, splitRunForSteer } from "./agent-runs.ts";
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

test("Milagre's own failure messages carry no \"Agent error:\" prefix, the agent's raw errors do", () => {
  const run = (text: string) => ({ [key(1)]: { text, model: "gpt-6-sol", approvals: [], steps: [], questions: [], answered: {} } });
  const own = applyAgentEvent(base(), run(""), PROJECT, key(1), { type: "turn-failed", message: "Codex isn't logged in. Run `codex login` in a terminal, then send your message again.", notice: true, login: true });
  assert.equal(own.state.messages[0].body, "Codex isn't logged in. Run `codex login` in a terminal, then send your message again.");
  const partial = applyAgentEvent(base(), run("Half"), PROJECT, key(1), { type: "turn-failed", message: "Codex stopped unexpectedly. Send your message again to continue this chat.", notice: true });
  assert.equal(partial.state.messages[0].body, "Half\n\nCodex stopped unexpectedly. Send your message again to continue this chat.");
  const raw = applyAgentEvent(base(), run(""), PROJECT, key(1), { type: "turn-failed", message: "The model gpt-x is not supported." });
  assert.equal(raw.state.messages[0].body, "Agent error: The model gpt-x is not supported.");
});

test("keeps partial text when a turn fails or is cancelled", () => {
  const runs = { [key(1)]: { text: "Half an answer", model: "gpt-6-sol", approvals: [], steps: [], questions: [], answered: {} } };
  const failed = applyAgentEvent(base(), runs, PROJECT, key(1), { type: "turn-failed", message: "Codex stopped: boom" });
  assert.equal(failed.state.messages[0].body, "Half an answer\n\nAgent error: Codex stopped: boom");
  assert.equal(failed.state.messages[0].outcome, "failed");

  const cancelled = applyAgentEvent(base(), { [key(1)]: { text: "", model: "gpt-6-sol", approvals: [], steps: [], questions: [], answered: {} } }, PROJECT, key(1), { type: "turn-cancelled" });
  assert.equal(cancelled.state.messages[0].body, "What should I work on instead?");
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
    const runs = { [chatKey(other, 2)]: { text: "Not yours", model: "claude-opus-5-5", approvals: [], steps: [], questions: [], answered: {} } };
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
  const runs = { [key(99)]: { text: "Orphan", model: "gpt-6-sol", approvals: [], steps: [], questions: [], answered: {} } };
  for (const chatId of [key(99), `${PROJECT}#`, `${PROJECT}#abc`]) {
    assert.deepEqual(applyAgentEvent(state, runs, PROJECT, chatId, { type: "session-started", nativeId: "x" }), { state, runs, changed: false });
    assert.deepEqual(applyAgentEvent(state, runs, PROJECT, chatId, { type: "turn-completed" }), { state, runs, changed: false });
  }
});

test("an unknown event type changes nothing", () => {
  const state = base();
  const runs = { [key(1)]: { text: "Partial", model: "gpt-6-sol", approvals: [], steps: [], questions: [], answered: {} } };
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
  assert.deepEqual(opened.runs[key(2)], { text: "", model: "claude-opus-5-5", approvals: [], steps: [], questions: [], answered: {} });
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
  const runs = { [key(1)]: { text: "  Half an answer \n", model: "gpt-6-sol", approvals: [approval("a")], steps: [], questions: [], answered: {} } };
  const split = splitRunForSteer(state, runs, PROJECT, key(1));
  assert.equal(split.changed, true);
  assert.deepEqual(split.state.messages.at(-1), { id: state.next_id, session_id: 1, body: "Half an answer", context: null, role: "assistant", model: "gpt-6-sol" });
  assert.equal(split.state.next_id, state.next_id + 1);
  assert.deepEqual(split.runs[key(1)], { text: "", model: "gpt-6-sol", approvals: [approval("a")], steps: [], questions: [], answered: {}, split: true });

  const cases: Array<[AgentRuns, string]> = [
    [{ [key(1)]: { text: "  ", model: "gpt-6-sol", approvals: [], steps: [], questions: [], answered: {} } }, key(1)],
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
  const runs = { [key(1)]: { text: "Half", model: "gpt-6-sol", approvals: [], steps: [], questions: [], answered: {} } };
  const split = splitRunForSteer(state, runs, PROJECT, key(1));
  assert.equal(split.runs[key(1)].split, true);
  const done = applyAgentEvent(split.state, split.runs, PROJECT, key(1), { type: "turn-completed" });
  assert.equal(done.runs[key(1)], undefined);
  assert.equal(done.state, split.state);
  assert.equal(done.changed, false);
  const cancelled = applyAgentEvent(split.state, split.runs, PROJECT, key(1), { type: "turn-cancelled" });
  assert.equal(cancelled.state.messages.at(-1)?.body, "What should I work on instead?");
  const more = applyAgentEvent(split.state, { [key(1)]: { ...split.runs[key(1)], text: "Rest" } }, PROJECT, key(1), { type: "turn-completed" });
  assert.equal(more.state.messages.at(-1)?.body, "Rest");
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

test("chatsRunning lists only this project's chats with a run", () => {
  const run = { text: "", model: "m", approvals: [], steps: [], questions: [], answered: {} };
  const runs: AgentRuns = { [key(1)]: run, [key(4)]: run, [chatKey("/work/app#other", 2)]: run, [chatKey("/work/other", 3)]: run };
  assert.deepEqual([...chatsRunning(runs, PROJECT)].sort(), [1, 4]);
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

const npmTest = { id: "s1", kind: "shell" as const, title: "Ran `npm test`", detail: "$ npm test\n" };

/** Folds events into one chat's run, starting from a fresh run unless `runs` is given. */
function fold(events: AgentEvent[], runs: AgentRuns = startRun({}, key(1), "gpt-6-sol"), state = base()) {
  let result = { state, runs, changed: false };
  for (const event of events) result = applyAgentEvent(result.state, result.runs, PROJECT, key(1), event);
  return result;
}

test("a step starts where the reply's text has got to, streams its output, and ends with its own detail", () => {
  const { runs } = fold([
    { type: "text-delta", messageId: "t", text: "Testing." },
    { type: "step-started", step: npmTest },
    { type: "step-output", id: "s1", text: "ok 2\n" },
  ]);
  assert.deepEqual(runs[key(1)].steps, [{ ...npmTest, status: "running", offset: 8, detail: "$ npm test\nok 2\n" }]);

  const ended = fold([{ type: "step-completed", id: "s1", status: "failed", detail: "$ npm test\nok 1\nok 2\n1 failing\n" }], runs).runs;
  assert.deepEqual(ended[key(1)].steps, [{ ...npmTest, status: "failed", offset: 8, detail: "$ npm test\nok 1\nok 2\n1 failing\n" }]);
  // Output after the end, or for a step the run doesn't have, changes nothing.
  assert.equal(fold([{ type: "step-output", id: "s1", text: "late" }], ended).runs, ended);
  assert.equal(fold([{ type: "step-completed", id: "nope", status: "done" }], ended).runs, ended);
});

test("a step that ends without a detail keeps none, and a new title replaces the first", () => {
  const read = { id: "r1", kind: "read" as const, title: "Read `app.js`", detail: "$ cat app.js\n" };
  const { runs } = fold([
    { type: "step-started", step: read },
    { type: "step-output", id: "r1", text: "export const a = 1;\n" },
    { type: "step-completed", id: "r1", status: "done" },
    { type: "step-started", step: { id: "w1", kind: "search", title: "Searched the web" } },
    { type: "step-completed", id: "w1", status: "done", title: "Searched the web for `IANA`" },
  ]);
  assert.deepEqual(runs[key(1)].steps, [
    { id: "r1", kind: "read", title: "Read `app.js`", status: "done", offset: 0 },
    { id: "w1", kind: "search", title: "Searched the web for `IANA`", status: "done", offset: 0 },
  ]);
});

test("thinking streams its summary and ends with how long it took", () => {
  const { runs } = fold([
    { type: "step-started", step: { id: "th1", kind: "thinking", title: "Thinking" } },
    { type: "step-output", id: "th1", text: "Plan " },
    { type: "step-output", id: "th1", text: "it." },
  ]);
  assert.equal(runs[key(1)].steps[0].detail, "Plan it.");
  const ended = fold([{ type: "step-completed", id: "th1", status: "done", title: "Thought for 2s", detail: "Plan it.", durationMs: 2_100 }], runs).runs;
  assert.deepEqual(ended[key(1)].steps, [{ id: "th1", kind: "thinking", title: "Thought for 2s", status: "done", offset: 0, detail: "Plan it.", durationMs: 2_100 }]);
});

test("thinking cut off by a cancelled turn is saved as done, not failed", () => {
  const { state } = fold([{ type: "step-started", step: { id: "th1", kind: "thinking", title: "Thinking" } }, { type: "step-started", step: npmTest }, { type: "turn-cancelled" }]);
  assert.deepEqual(state.messages.at(-1)?.steps?.map((step) => step.status), ["done", "failed"]);
});

test("streamed output keeps its last 20,000 characters", () => {
  const { runs } = fold([
    { type: "step-started", step: { ...npmTest, detail: "" } },
    { type: "step-output", id: "s1", text: "a".repeat(15_000) },
    { type: "step-output", id: "s1", text: "b".repeat(15_000) },
  ]);
  assert.equal(runs[key(1)].steps[0].detail, `… truncated\n${"a".repeat(5_000)}${"b".repeat(15_000)}`);
  assert.equal(capOutput("short"), "short");
});

test("a step that starts with a huge detail is saved capped when the turn is cancelled", () => {
  const { state } = fold([{ type: "step-started", step: { ...npmTest, detail: `$ ${"x".repeat(60_000)}\n` } }, { type: "turn-cancelled" }]);
  assert.ok((state.messages.at(-1)?.steps?.[0].detail?.length ?? 0) <= 20_012);
});

test("step events for a chat with nothing running change nothing", () => {
  const state = base();
  for (const event of [{ type: "step-started", step: npmTest }, { type: "step-output", id: "s1", text: "x" }, { type: "step-completed", id: "s1", status: "done" }] as AgentEvent[]) {
    assert.deepEqual(applyAgentEvent(state, {}, PROJECT, key(1), event), { state, runs: {}, changed: false });
  }
});

test("a finished reply saves its steps where they happened in the trimmed text", () => {
  const { state } = fold([
    { type: "text-delta", messageId: "t", text: "\n  Testing." },
    { type: "step-started", step: npmTest },
    { type: "step-completed", id: "s1", status: "done", detail: "$ npm test\nok\n" },
    { type: "text-delta", messageId: "t", text: "\n\nAll green. " },
    { type: "turn-completed" },
  ]);
  const saved = state.messages.at(-1);
  assert.equal(saved?.body, "Testing.\n\nAll green.");
  assert.deepEqual(saved?.steps, [{ ...npmTest, status: "done", offset: 8, detail: "$ npm test\nok\n" }]);
});

test("a step still running when the turn ends is saved as done or failed with the turn", () => {
  const running = fold([{ type: "text-delta", messageId: "t", text: "Testing." }, { type: "step-started", step: npmTest }, { type: "step-output", id: "s1", text: "ok 1\n" }]).runs;
  const cancelled = fold([{ type: "turn-cancelled" }], running).state.messages.at(-1);
  assert.equal(cancelled?.body, "Testing.\n\nWhat should I work on instead?");
  assert.deepEqual(cancelled?.steps, [{ ...npmTest, status: "failed", offset: 8, detail: "$ npm test\nok 1\n" }]);
  assert.equal(fold([{ type: "turn-failed", message: "boom" }], running).state.messages.at(-1)?.steps?.[0].status, "failed");
  assert.equal(fold([{ type: "turn-completed" }], running).state.messages.at(-1)?.steps?.[0].status, "done");
});

test("a reply with steps and no text saves an empty body; one with neither says so", () => {
  const withSteps = fold([{ type: "step-started", step: npmTest }, { type: "step-completed", id: "s1", status: "done", detail: "$ npm test\n" }, { type: "turn-completed" }]).state.messages.at(-1);
  assert.equal(withSteps?.body, "");
  assert.deepEqual(withSteps?.steps?.map((step: ChatStep) => step.offset), [0]);
  const empty = fold([{ type: "turn-completed" }]).state.messages.at(-1);
  assert.equal(empty?.body, "The agent finished without a reply.");
  assert.equal(empty && "steps" in empty, false);
});

test("a steer saves finished steps with the reply so far; running ones carry on below the new message", () => {
  const { runs, state } = fold([
    { type: "text-delta", messageId: "t", text: "Testing." },
    { type: "step-started", step: { id: "r1", kind: "read", title: "Read `a.js`" } },
    { type: "step-completed", id: "r1", status: "done" },
    { type: "step-started", step: npmTest },
  ]);
  const split = splitRunForSteer(state, runs, PROJECT, key(1));
  assert.deepEqual(split.state.messages.at(-1)?.steps, [{ id: "r1", kind: "read", title: "Read `a.js`", status: "done", offset: 8 }]);
  assert.deepEqual(split.runs[key(1)].steps, [{ ...npmTest, status: "running", offset: 0 }]);
  assert.equal(split.runs[key(1)].text, "");

  // The running step finishes after the steer and is saved with the rest of the reply.
  const rest = fold([{ type: "step-completed", id: "s1", status: "done", detail: "$ npm test\nok\n" }, { type: "turn-completed" }], split.runs, split.state).state.messages.at(-1);
  assert.equal(rest?.body, "");
  assert.deepEqual(rest?.steps, [{ ...npmTest, status: "done", offset: 0, detail: "$ npm test\nok\n" }]);
});

test("a steer with only finished steps and no text still saves them", () => {
  const { runs, state } = fold([{ type: "step-started", step: npmTest }, { type: "step-completed", id: "s1", status: "done", detail: "$ npm test\n" }]);
  const split = splitRunForSteer(state, runs, PROJECT, key(1));
  assert.equal(split.changed, true);
  assert.equal(split.state.messages.at(-1)?.body, "");
  assert.equal(split.state.messages.at(-1)?.steps?.length, 1);
  // Nothing new after the split: the turn saves no second reply.
  const done = fold([{ type: "turn-completed" }], split.runs, split.state);
  assert.equal(done.changed, false);
  // Only a running step and no text: nothing to save yet.
  const onlyRunning = fold([{ type: "step-started", step: npmTest }]);
  assert.equal(splitRunForSteer(onlyRunning.state, onlyRunning.runs, PROJECT, key(1)).changed, false);
});

test("an open approval and question survive a steer and keep their steps; the turn's end drops them with the run", () => {
  const request = { ...approval("a"), stepId: "s1" };
  const { runs, state } = fold([
    { type: "text-delta", messageId: "t", text: "Testing." },
    { type: "step-started", step: npmTest },
    { type: "permission-request", ...request },
    { type: "question-request", requestId: "q-1", questions: [{ id: "0", header: "", question: "Which?", options: [], multiSelect: false, allowOther: true, secret: false }] },
  ]);
  const split = splitRunForSteer(state, runs, PROJECT, key(1));
  const run = split.runs[key(1)];
  assert.equal(run.approvals[0].stepId, "s1");
  assert.deepEqual(run.questions.map((question) => question.requestId), ["q-1"]);
  assert.deepEqual(run.steps.map((step) => step.id), ["s1"]);
  const ended = fold([{ type: "turn-cancelled" }], split.runs, split.state);
  assert.equal(ended.runs[key(1)], undefined);
  assert.equal(ended.state.messages.at(-1)?.steps?.[0].status, "failed");
});

test('subagent snapshots survive parent completion and late child results remain chat scoped', () => {
  let state = base();
  let runs = startRun({},key(1),'codex');
  const agent = {id:'child',title:'Review',status:'running' as const,startedAt:1,updatedAt:2,transcript:[]};
  ({state,runs}=applyAgentEvent(state,runs,PROJECT,key(1),{type:'subagent-update',agent}));
  ({state,runs}=applyAgentEvent(state,runs,PROJECT,key(1),{type:'turn-completed'}));
  assert.equal(state.sessions[1].subagents?.[0].status,'running');
  ({state,runs}=applyAgentEvent(state,runs,PROJECT,key(1),{type:'subagent-update',agent:{...agent,status:'failed',updatedAt:3}}));
  assert.equal(state.sessions[1].subagents?.[0].status,'failed');
  assert.equal(state.sessions[2].subagents,undefined);
  assert.deepEqual(runs,{});
  assert.equal(JSON.parse(JSON.stringify(state)).sessions[1].subagents[0].title,'Review');
});
test('explicit subagent waiting clears when the parent resumes output', () => {
 let state=base(), runs=startRun({},key(1),'codex');
 ({state,runs}=applyAgentEvent(state,runs,PROJECT,key(1),{type:'subagents-waiting',waiting:true}));
 assert.equal(runs[key(1)].waitingForSubagents,true);
 ({state,runs}=applyAgentEvent(state,runs,PROJECT,key(1),{type:'text-delta',messageId:'m',text:'Continuing'}));
 assert.equal(runs[key(1)].waitingForSubagents,false);
});
test('a rediscovered child keeps its saved transcript and original start time', () => {
 let state=base();
 const agent={id:'child',title:'Review',status:'unknown' as const,startedAt:1,updatedAt:2,transcript:[{id:'old',kind:'message' as const,text:'Earlier finding'}]};
 ({state}=applyAgentEvent(state,{},PROJECT,key(1),{type:'subagent-update',agent}));
 ({state}=applyAgentEvent(state,{},PROJECT,key(1),{type:'subagent-update',agent:{...agent,status:'running',startedAt:3,updatedAt:3,transcript:[]}}));
 assert.equal(state.sessions[1].subagents?.[0].startedAt,1);
 assert.equal(state.sessions[1].subagents?.[0].transcript[0].text,'Earlier finding');
});

test("answers to a question join the chat as the user's message, after the reply so far", () => {
  const state = base();
  const runs: AgentRuns = { [key(1)]: { text: "Which color? ", model: "gpt-6-sol", approvals: [], steps: [], questions: [], answered: {} } };
  const recorded = recordAnswers(state, runs, PROJECT, key(1), "Red");
  assert.deepEqual(recorded.state.messages.map(({ id, role, body }) => ({ id, role, body })), [
    { id: 10, role: "assistant", body: "Which color?" },
    { id: 11, role: "user", body: "Red" },
  ]);
  assert.equal(recorded.messageId, 11);
  assert.equal(recorded.state.next_id, 12);
  assert.deepEqual(recorded.runs[key(1)], { text: "", model: "gpt-6-sol", approvals: [], steps: [], questions: [], answered: {}, split: true });

  // Nothing streamed yet: only the answers are added, and the run still knows it was split.
  const empty: AgentRuns = { [key(1)]: { ...runs[key(1)], text: "" } };
  const alone = recordAnswers(state, empty, PROJECT, key(1), "Red");
  assert.deepEqual(alone.state.messages.map(({ role, body }) => ({ role, body })), [{ role: "user", body: "Red" }]);
  assert.equal(alone.runs[key(1)].split, true);

  for (const [testRuns, chatId, body] of [[runs, key(1), ""], [{}, key(1), "Red"], [runs, chatKey("/work/other", 1), "Red"]] as Array<[AgentRuns, string, string]>) {
    const unchanged = recordAnswers(state, testRuns, PROJECT, chatId, body);
    assert.equal(unchanged.messageId, null);
    assert.equal(unchanged.state, state);
  }
});
