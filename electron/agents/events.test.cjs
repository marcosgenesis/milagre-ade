const assert = require("node:assert/strict");
const test = require("node:test");
const { MILAGRE_INSTRUCTIONS, isTerminal, mapClaudeMessage, mapCodexNotification } = require("./events.cjs");

const claudeState = () => ({ sessionId: null, turnId: "turn-a", hasText: false });
const codexState = () => ({ threadId: "thread-1", turnId: null, lastItemId: null, hasText: false });
const delta = (text, extra = {}) => ({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text } }, ...extra });

test("Claude: init announces the session once", () => {
  const state = claudeState();
  assert.deepEqual(mapClaudeMessage({ type: "system", subtype: "init", session_id: "s-1" }, state), [{ type: "session-started", nativeId: "s-1" }]);
  assert.deepEqual(mapClaudeMessage({ type: "system", subtype: "init", session_id: "s-1" }, state), []);
});

test("Claude: streams top-level text and separates text blocks", () => {
  const state = claudeState();
  const start = { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", content_block: { type: "text" } } };
  assert.deepEqual(mapClaudeMessage(start, state), []);
  assert.deepEqual(mapClaudeMessage(delta("Checking"), state), [{ type: "text-delta", messageId: "turn-a", text: "Checking" }]);
  assert.deepEqual(mapClaudeMessage(delta("ignored", { parent_tool_use_id: "tool-1" }), state), []);
  assert.deepEqual(mapClaudeMessage(start, state), [{ type: "text-delta", messageId: "turn-a", text: "\n\n" }]);
});

test("Claude: results end the turn", () => {
  assert.deepEqual(mapClaudeMessage({ type: "result", subtype: "success", is_error: false, result: "ok" }, claudeState()), [{ type: "turn-completed" }]);
  assert.deepEqual(mapClaudeMessage({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["API Error: 529", "Overloaded"] }, claudeState()), [{ type: "turn-failed", message: "API Error: 529\nOverloaded" }]);
  assert.deepEqual(mapClaudeMessage({ type: "result", subtype: "success", is_error: true, result: "Credit balance is too low" }, claudeState()), [{ type: "turn-failed", message: "Credit balance is too low" }]);
});

test("Codex: streams agent message deltas and separates messages", () => {
  const state = codexState();
  assert.deepEqual(mapCodexNotification("item/agentMessage/delta", { threadId: "thread-1", turnId: "t-1", itemId: "a", delta: "First" }, state), [{ type: "text-delta", messageId: "t-1", text: "First" }]);
  assert.deepEqual(mapCodexNotification("item/agentMessage/delta", { threadId: "thread-1", turnId: "t-1", itemId: "b", delta: "Second" }, state), [
    { type: "text-delta", messageId: "t-1", text: "\n\n" },
    { type: "text-delta", messageId: "t-1", text: "Second" },
  ]);
});

test("Codex: ignores other threads and unrelated notifications", () => {
  const state = codexState();
  assert.deepEqual(mapCodexNotification("item/agentMessage/delta", { threadId: "thread-2", turnId: "t", itemId: "a", delta: "x" }, state), []);
  assert.deepEqual(mapCodexNotification("mcpServer/startupStatus/updated", { name: "x" }, state), []);
  assert.deepEqual(mapCodexNotification("hook/started", {}, state), []);
});

test("Codex: turn/completed maps each status", () => {
  const done = (status, error = null) => mapCodexNotification("turn/completed", { threadId: "thread-1", turn: { id: "t-1", status, error } }, codexState());
  assert.deepEqual(done("completed"), [{ type: "turn-completed" }]);
  assert.deepEqual(done("interrupted"), [{ type: "turn-cancelled" }]);
  assert.deepEqual(done("failed", { message: "The 'gpt-6.1-sol' model is not supported." }), [{ type: "turn-failed", message: "The 'gpt-6.1-sol' model is not supported." }]);
  assert.deepEqual(done("failed"), [{ type: "turn-failed", message: "Codex could not finish this turn." }]);
});

test("Codex: a stale completion or text for another turn id is ignored", () => {
  const state = { ...codexState(), turnId: "t-2" };
  assert.deepEqual(mapCodexNotification("turn/completed", { threadId: "thread-1", turn: { id: "t-1", status: "completed" } }, state), []);
  assert.deepEqual(mapCodexNotification("item/agentMessage/delta", { threadId: "thread-1", turnId: "t-1", itemId: "a", delta: "late" }, state), []);
  assert.equal(state.turnId, "t-2");
  assert.deepEqual(mapCodexNotification("turn/completed", { threadId: "thread-1", turn: { id: "t-2", status: "completed" } }, state), [{ type: "turn-completed" }]);
});

test("isTerminal recognises the three turn endings", () => {
  assert.equal(isTerminal({ type: "turn-completed" }), true);
  assert.equal(isTerminal({ type: "turn-failed", message: "x" }), true);
  assert.equal(isTerminal({ type: "turn-cancelled" }), true);
  assert.equal(isTerminal({ type: "text-delta", messageId: null, text: "x" }), false);
});

test("Codex: a started turn is announced", () => {
  const state = { threadId: "thread-1", turnId: null, lastItemId: null, hasText: false };
  assert.deepEqual(mapCodexNotification("turn/started", { threadId: "thread-1", turn: { id: "t-2" } }, state), [{ type: "turn-started", turnId: "t-2" }]);
  assert.deepEqual(mapCodexNotification("turn/started", { threadId: "thread-9", turn: { id: "t-3" } }, state), []);
});

test("agents are told to ask with their question tool, and in a short list without one", () => {
  assert.match(MILAGRE_INSTRUCTIONS, /ask with your question tool if you have one \(AskUserQuestion or request_user_input\)/);
  assert.match(MILAGRE_INSTRUCTIONS, /otherwise ask in your reply as a short numbered list\.$/);
});
