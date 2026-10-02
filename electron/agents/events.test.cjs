const assert = require("node:assert/strict");
const test = require("node:test");
const { MILAGRE_INSTRUCTIONS, cliBrokenMessage, cliTooOldMessage, crashMessage, isTerminal, lastLine, loginMessage, mapClaudeMessage, mapCodexNotification, missingCliMessage, failedWith } = require("./events.cjs");

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

test("CLI failures name the fix", () => {
  assert.equal(missingCliMessage("claude"), "Milagre couldn't find Claude Code. Install it with `curl -fsSL https://claude.ai/install.sh | bash`, then send your message again.");
  assert.equal(missingCliMessage("codex"), "Milagre couldn't find Codex. Install it with `npm install -g @openai/codex`, then send your message again.");
  assert.equal(cliTooOldMessage("claude", "2.1.200", "2.1.286"), "Milagre needs Claude Code 2.1.286 or later, and you have 2.1.200. Run `claude update` in a terminal, then send your message again.");
  assert.equal(cliTooOldMessage("codex", "0.150.0", "0.158.0"), "Milagre needs Codex 0.158.0 or later, and you have 0.150.0. Run `codex update` in a terminal, then send your message again.");
  assert.equal(cliBrokenMessage("codex", "/Users/x/.nvm/versions/node/v24.13.0/bin/codex", "env: node: No such file or directory\n"), "Codex (/Users/x/.nvm/versions/node/v24.13.0/bin/codex) didn't start: env: node: No such file or directory. Check that it runs in a terminal, then send your message again.");
  assert.equal(loginMessage("claude"), "Claude Code isn't logged in. Run `claude auth login` in a terminal, then send your message again.");
  assert.equal(loginMessage("codex"), "Codex isn't logged in. Run `codex login` in a terminal, then send your message again.");
  assert.equal(crashMessage("claude", "Claude Code process terminated by signal SIGKILL"), "Claude Code stopped unexpectedly: Claude Code process terminated by signal SIGKILL. Send your message again to continue this chat.");
  assert.equal(crashMessage("codex", "Codex exited with code null (SIGKILL)."), "Codex stopped unexpectedly: Codex exited with code null (SIGKILL). Send your message again to continue this chat.");
  assert.equal(crashMessage("claude", ""), "Claude Code stopped unexpectedly. Send your message again to continue this chat.");
});

test("lastLine keeps the last thing a CLI printed, without colours", () => {
  assert.equal(lastLine("\x1b[2m2026-10-01T23:30:17Z\x1b[0m \x1b[31mERROR\x1b[0m connecting\nthread 'main' panicked at core.rs\n\n"), "thread 'main' panicked at core.rs");
  assert.equal(lastLine("x".repeat(400)).length, 300);
  assert.equal(lastLine(undefined), "");
});

test("Claude: a turn it can't authenticate asks to log in", () => {
  const state = claudeState();
  const notLoggedIn = { type: "assistant", error: "authentication_failed", parent_tool_use_id: null, message: { model: "<synthetic>", content: [{ type: "text", text: "Not logged in · Please run /login" }] } };
  assert.deepEqual(mapClaudeMessage(notLoggedIn, state), []);
  assert.deepEqual(mapClaudeMessage({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" }, state), [failedWith(loginMessage("claude"), { login: true })]);
  assert.deepEqual(mapClaudeMessage({ type: "result", subtype: "success", is_error: true, result: "Credit balance is too low" }, state), [{ type: "turn-failed", message: "Credit balance is too low" }]);
});

test("Codex: a turn it can't authenticate asks to log in, and raw API errors read as their message", () => {
  const failed = (error) => mapCodexNotification("turn/completed", { threadId: "thread-1", turn: { id: "t-1", status: "failed", error } }, { ...codexState(), requiresOpenaiAuth: true });
  const unauthorized = { message: "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses", codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } } };
  assert.deepEqual(failed(unauthorized), [failedWith(loginMessage("codex"), { login: true })]);
  assert.deepEqual(failed({ message: "Unauthorized", codexErrorInfo: "unauthorized" }), [failedWith(loginMessage("codex"), { login: true })]);
  const unsupported = JSON.stringify({ type: "error", status: 400, error: { type: "invalid_request_error", message: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account." } });
  assert.deepEqual(failed({ message: unsupported, codexErrorInfo: null }), [{ type: "turn-failed", message: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account." }]);
  assert.deepEqual(failed({ message: "stream disconnected", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 500 } } }), [{ type: "turn-failed", message: "stream disconnected" }]);
});

test("Codex: a 401 is a login problem only where OpenAI auth is required", () => {
  const unauthorized = { message: "unexpected status 401 Unauthorized: bad key", codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } } };
  const failed = (state) => mapCodexNotification("turn/completed", { threadId: "thread-1", turn: { id: "t-1", status: "failed", error: unauthorized } }, state);
  const raw = [{ type: "turn-failed", message: "unexpected status 401 Unauthorized: bad key" }];
  assert.deepEqual(failed({ ...codexState(), requiresOpenaiAuth: false }), raw);
  assert.deepEqual(failed(codexState()), raw);
});

test("a log line's timestamp, level and module are dropped, and a killed process is named by its signal", () => {
  const logged = "2026-10-02T00:59:00.724526Z ERROR codex_core::tools::router: error=exec_command failed: UnknownProcessId { process_id: 52867 }";
  assert.equal(lastLine(logged), "error=exec_command failed: UnknownProcessId { process_id: 52867 }");
  assert.equal(lastLine("WARN something odd"), "something odd");
  assert.equal(lastLine("Error: connect ECONNREFUSED"), "Error: connect ECONNREFUSED");
  assert.equal(crashMessage("codex", logged, { signal: "SIGKILL" }), "Codex stopped unexpectedly: error=exec_command failed: UnknownProcessId { process_id: 52867 }. Send your message again to continue this chat.");
  // A log line with nothing after its prefix leaves nothing to say; the signal does.
  assert.equal(crashMessage("codex", "2026-10-02T00:59:00Z ERROR ", { signal: "SIGKILL" }), "Codex stopped unexpectedly: Codex exited with signal SIGKILL. Send your message again to continue this chat.");
  assert.equal(crashMessage("codex", "", { signal: "SIGKILL" }), "Codex stopped unexpectedly: Codex exited with signal SIGKILL. Send your message again to continue this chat.");
  assert.equal(crashMessage("codex", logged), "Codex stopped unexpectedly: error=exec_command failed: UnknownProcessId { process_id: 52867 }. Send your message again to continue this chat.");
  assert.equal(crashMessage("codex", "boom: model unavailable", { signal: "SIGKILL" }), "Codex stopped unexpectedly: boom: model unavailable. Send your message again to continue this chat.");
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

const block = (event) => ({ type: "stream_event", parent_tool_use_id: null, event });
const clock = (state, ...times) => Object.assign(state, { now: () => times.shift() });

test("Claude: a thinking block streams as a thinking step that ends with how long it took", () => {
  const state = clock(claudeState(), 1_000, 5_200);
  assert.deepEqual(mapClaudeMessage(block({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }), state), [
    { type: "step-started", step: { id: "thinking-1", kind: "thinking", title: "Thinking" } },
  ]);
  assert.deepEqual(mapClaudeMessage(block({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Check the " } }), state), [{ type: "step-output", id: "thinking-1", text: "Check the " }]);
  assert.deepEqual(mapClaudeMessage(block({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "tests." } }), state), [{ type: "step-output", id: "thinking-1", text: "tests." }]);
  // A text block that follows starts the reply: no separator before it.
  assert.deepEqual(mapClaudeMessage(block({ type: "content_block_stop", index: 0 }), state), [
    { type: "step-completed", id: "thinking-1", status: "done", title: "Thought for 4s", detail: "Check the tests.", durationMs: 4_200 },
  ]);
  assert.deepEqual(mapClaudeMessage(block({ type: "content_block_start", index: 1, content_block: { type: "text" } }), state), []);
});

test("Claude: hidden thinking still shows how long it took, and each block gets its own step", () => {
  const state = clock(claudeState(), 0, 400, 1_000, 61_500);
  mapClaudeMessage(block({ type: "content_block_start", index: 0, content_block: { type: "redacted_thinking" } }), state);
  assert.deepEqual(mapClaudeMessage(block({ type: "content_block_stop", index: 0 }), state), [{ type: "step-completed", id: "thinking-1", status: "done", title: "Thought for 1s", durationMs: 400 }]);
  assert.deepEqual(mapClaudeMessage(block({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }), state)[0].step.id, "thinking-2");
  // The stop of another block (a tool call's input, say) doesn't end the thinking.
  assert.deepEqual(mapClaudeMessage(block({ type: "content_block_stop", index: 3 }), state), []);
  assert.deepEqual(mapClaudeMessage(block({ type: "content_block_stop", index: 0 }), state), [{ type: "step-completed", id: "thinking-2", status: "done", title: "Thought for 1m 1s", durationMs: 60_500 }]);
});

test("Claude: a subagent's thinking is not part of the reply", () => {
  const state = claudeState();
  assert.deepEqual(mapClaudeMessage({ ...block({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }), parent_tool_use_id: "agent-1" }, state), []);
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
  assert.deepEqual(itemEvent("item/started", { type: "plan", id: "plan-1" }, state, { turnId: "t-2" }), []);
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

const reasoning = (overrides = {}) => ({ type: "reasoning", id: "rs-1", summary: [], content: [], ...overrides });
const reasoningEvent = (method, params, state) => mapCodexNotification(method, { threadId: "thread-1", turnId: "t-1", itemId: "rs-1", ...params }, state);

test("Codex: reasoning streams its summary as a thinking step that ends with how long it took", () => {
  const state = clock({ ...codexState(), turnId: "t-1" }, 2_000, 4_900);
  assert.deepEqual(itemEvent("item/started", reasoning(), state), [{ type: "step-started", step: { id: "rs-1", kind: "thinking", title: "Thinking" } }]);
  assert.deepEqual(reasoningEvent("item/reasoning/summaryPartAdded", { summaryIndex: 0 }, state), []);
  assert.deepEqual(reasoningEvent("item/reasoning/summaryTextDelta", { delta: "Plan the fix.", summaryIndex: 0 }, state), [{ type: "step-output", id: "rs-1", text: "Plan the fix." }]);
  assert.deepEqual(reasoningEvent("item/reasoning/summaryPartAdded", { summaryIndex: 1 }, state), [{ type: "step-output", id: "rs-1", text: "\n\n" }]);
  assert.deepEqual(itemEvent("item/completed", reasoning({ summary: ["Plan the fix.", "Run the tests."] }), state), [
    { type: "step-completed", id: "rs-1", status: "done", title: "Thought for 3s", detail: "Plan the fix.\n\nRun the tests.", durationMs: 2_900 },
  ]);
  // Deltas for reasoning that isn't running are dropped.
  assert.deepEqual(reasoningEvent("item/reasoning/summaryTextDelta", { delta: "late", summaryIndex: 0 }, state), []);
});

test("Codex: reasoning without a summary, or that only completes, still shows", () => {
  const state = clock({ ...codexState(), turnId: "t-1" }, 0);
  assert.deepEqual(itemEvent("item/completed", reasoning({ id: "rs-2" }), state), [
    { type: "step-started", step: { id: "rs-2", kind: "thinking", title: "Thinking" } },
    { type: "step-completed", id: "rs-2", status: "done", title: "Thought" },
  ]);
});
