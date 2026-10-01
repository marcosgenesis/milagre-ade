import assert from "node:assert/strict";
import test from "node:test";
import type { CoordinatorState, ModelOption } from "../model";
import { applyAgentEvent, modelForChat, startRun } from "./agent-runs.ts";

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

test("saves and forgets the agent's native session id", () => {
  const started = applyAgentEvent(base(), {}, "1", { type: "session-started", nativeId: "thread-1" });
  assert.equal(started.changed, true);
  assert.equal(started.state.sessions["1"].native_session_id, "thread-1");
  assert.equal(applyAgentEvent(started.state, {}, "1", { type: "session-started", nativeId: "thread-1" }).changed, false);

  const reset = applyAgentEvent(base(), {}, "2", { type: "session-reset" });
  assert.equal(reset.changed, true);
  assert.equal("native_session_id" in reset.state.sessions["2"], false);
});

test("streams text per chat and saves each finished reply once", () => {
  let state = base();
  let runs = startRun(startRun({}, "1", "gpt-6-sol"), "2", "claude-opus-5-5");
  for (const [chatId, text] of [["1", "Hel"], ["2", "Hi"], ["1", "lo"], ["2", " there"]] as const) {
    ({ state, runs } = applyAgentEvent(state, runs, chatId, { type: "text-delta", messageId: "t", text }));
  }
  assert.equal(runs["1"].text, "Hello");
  assert.equal(runs["2"].text, "Hi there");

  const first = applyAgentEvent(state, runs, "2", { type: "turn-completed" });
  const second = applyAgentEvent(first.state, first.runs, "1", { type: "turn-completed" });
  assert.equal(second.changed, true);
  assert.deepEqual(second.runs, {});
  assert.deepEqual(second.state.messages.map(({ id, session_id, body, role, model, outcome }) => ({ id, session_id, body, role, model, outcome })), [
    { id: 10, session_id: 2, body: "Hi there", role: "assistant", model: "claude-opus-5-5", outcome: "completed" },
    { id: 11, session_id: 1, body: "Hello", role: "assistant", model: "gpt-6-sol", outcome: "completed" },
  ]);
  assert.equal(second.state.next_id, 12);
});

test("keeps partial text when a turn fails or is cancelled", () => {
  const runs = { "1": { text: "Half an answer", model: "gpt-6-sol" } };
  const failed = applyAgentEvent(base(), runs, "1", { type: "turn-failed", message: "Codex stopped: boom" });
  assert.equal(failed.state.messages[0].body, "Half an answer\n\nAgent error: Codex stopped: boom");
  assert.equal(failed.state.messages[0].outcome, "failed");

  const cancelled = applyAgentEvent(base(), { "1": { text: "", model: "gpt-6-sol" } }, "1", { type: "turn-cancelled" });
  assert.equal(cancelled.state.messages[0].body, "Agent run cancelled.");
  assert.equal(cancelled.state.messages[0].outcome, "cancelled");
});

test("ignores events for chats with nothing running", () => {
  const state = base();
  assert.deepEqual(applyAgentEvent(state, {}, "1", { type: "text-delta", messageId: "t", text: "x" }), { state, runs: {}, changed: false });
  assert.deepEqual(applyAgentEvent(state, {}, "1", { type: "turn-completed" }), { state, runs: {}, changed: false });
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
