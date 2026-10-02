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

const toolUse = (id, name, input, parent = null) => ({ type: "assistant", parent_tool_use_id: parent, message: { content: [{ type: "tool_use", id, name, input }] } });
const toolResult = (id, content, { parent = null, structured, ...block } = {}) => ({
  type: "user", parent_tool_use_id: parent, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, ...block }] }, ...(structured ? { tool_use_result: structured } : {}),
});

test("Claude: a tool call starts a step and its result ends it", () => {
  const state = claudeState();
  assert.deepEqual(mapClaudeMessage(toolUse("t1", "Bash", { command: "npm test" }), state), [
    { type: "step-started", step: { id: "t1", kind: "shell", title: "Ran `npm test`", detail: "$ npm test\n" } },
  ]);
  assert.deepEqual(mapClaudeMessage(toolResult("t1", "ok", { is_error: false }), state), [{ type: "step-completed", id: "t1", status: "done", detail: "$ npm test\nok" }]);
  // A second result for the same call, or one for a call this state never saw, changes nothing.
  assert.deepEqual(mapClaudeMessage(toolResult("t1", "again"), state), []);
  assert.deepEqual(mapClaudeMessage(toolResult("unknown", "x"), state), []);
});

test("Claude: the question tool is a card, not a step", () => {
  const state = claudeState();
  assert.deepEqual(mapClaudeMessage(toolUse("q1", "AskUserQuestion", { questions: [] }), state), []);
  assert.deepEqual(mapClaudeMessage(toolResult("q1", "User answered"), state), []);
  assert.equal(mapClaudeMessage(toolUse("t1", "Bash", { command: "pwd" }), state).length, 1);
});

test("Claude: a subagent's own tool calls are not steps", () => {
  const state = claudeState();
  assert.equal(mapClaudeMessage(toolUse("agent-1", "Agent", { description: "List files", prompt: "ls" }), state).length, 1);
  assert.deepEqual(mapClaudeMessage(toolUse("t2", "Bash", { command: "ls" }, "agent-1"), state), []);
  assert.deepEqual(mapClaudeMessage(toolResult("t2", "README.md", { parent: "agent-1" }), state), []);
  const report = { status: "completed", content: [{ type: "text", text: "Found README.md" }] };
  assert.deepEqual(mapClaudeMessage(toolResult("agent-1", [{ type: "text", text: "[Subagent hand-back] …" }], { structured: report }), state), [
    { type: "step-completed", id: "agent-1", status: "done", detail: "Found README.md" },
  ]);
});

test("Claude: text, thinking and plain user messages are not steps", () => {
  const state = claudeState();
  assert.deepEqual(mapClaudeMessage({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Hi" }, { type: "thinking", thinking: "" }] } }, state), []);
  assert.deepEqual(mapClaudeMessage({ type: "user", parent_tool_use_id: null, message: { role: "user", content: "Steer this" } }, state), []);
  assert.deepEqual(mapClaudeMessage({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] } }, state), []);
});

const shell = (overrides = {}) => ({ type: "commandExecution", id: "exec-1", command: "/bin/zsh -lc 'npm test'", status: "inProgress", commandActions: [{ type: "unknown", command: "npm test" }], aggregatedOutput: null, exitCode: null, ...overrides });
const itemEvent = (method, item, state, extra = {}) => mapCodexNotification(method, { threadId: "thread-1", turnId: "t-1", item, ...extra }, state);
const output = (delta, state) => mapCodexNotification("item/commandExecution/outputDelta", { threadId: "thread-1", turnId: "t-1", itemId: "exec-1", delta }, state);

test("Codex: a command streams its output and ends with the whole of it", () => {
  const state = { ...codexState(), turnId: "t-1" };
  assert.deepEqual(itemEvent("item/started", shell(), state), [{ type: "step-started", step: { id: "exec-1", kind: "shell", title: "Ran `npm test`", detail: "$ npm test\n" } }]);
  assert.deepEqual(itemEvent("item/started", shell(), state), []);
  assert.deepEqual(output("ok 2\n", state), [{ type: "step-output", id: "exec-1", text: "ok 2\n" }]);
  assert.deepEqual(itemEvent("item/completed", shell({ status: "completed", exitCode: 0, aggregatedOutput: "ok 1\nok 2\n" }), state), [
    { type: "step-completed", id: "exec-1", status: "done", detail: "$ npm test\nok 1\nok 2\n" },
  ]);
  // Output for an item that isn't a running step is dropped.
  assert.deepEqual(output("late", state), []);
});

test("Codex: items that aren't tool calls, or belong to another turn, are not steps", () => {
  const state = { ...codexState(), turnId: "t-2" };
  assert.deepEqual(itemEvent("item/started", { type: "agentMessage", id: "msg-1", text: "" }, state, { turnId: "t-2" }), []);
  assert.deepEqual(itemEvent("item/started", { type: "reasoning", id: "rs-1" }, state, { turnId: "t-2" }), []);
  assert.deepEqual(itemEvent("item/started", shell(), state), []);
  assert.deepEqual(itemEvent("item/started", shell(), state, { threadId: "thread-9", turnId: "t-2" }), []);
});

test("Codex: an item that completes without having started still shows", () => {
  const state = { ...codexState(), turnId: "t-1" };
  const search = { type: "webSearch", id: "ws-1", query: "IANA", action: { type: "search", query: "IANA", queries: null }, results: [] };
  assert.deepEqual(itemEvent("item/completed", search, state), [
    { type: "step-started", step: { id: "ws-1", kind: "search", title: "Searched the web for `IANA`" } },
    { type: "step-completed", id: "ws-1", status: "done", title: "Searched the web for `IANA`" },
  ]);
});
