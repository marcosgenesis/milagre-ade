const assert = require("node:assert/strict");
const test = require("node:test");
const { ClaudeSession } = require("./claude-provider.cjs");
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, isTerminal, missingCliMessage } = require("./events.cjs");
const { DISMISSED_MESSAGE, UNSHOWN_MESSAGE } = require("./questions.cjs");
const { waitUntil } = require("./test-helpers.cjs");

const TURN = { prompt: "Hi", images: [], model: "claude-opus-5-5", permissionMode: "auto" };
const init = { type: "system", subtype: "init", session_id: "session-1" };
const delta = (text) => ({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
const success = { type: "result", subtype: "success", is_error: false, result: "Hello" };

const COLOR_QUESTION = { questions: [{ question: "Which color?", header: "Color", options: [{ label: "Red", description: "Warm" }, { label: "Green", description: "Calm" }], multiSelect: false }] };

const scripts = {
  async *absorbs({ next }) {
    yield init;
    const steer = await next();
    yield delta(`steered:${steer.message.content[0].text}`);
    yield success;
  },
  async *held({ released }) {
    yield init;
    await released;
    yield delta("Done");
    yield success;
  },
  async *reply() {
    yield init;
    yield delta("Hel");
    yield delta("lo");
    yield success;
  },
  async *interruptible({ interrupted }) {
    yield init;
    await interrupted;
    yield { type: "result", subtype: "error_during_execution", is_error: true, errors: ["Request was aborted."] };
  },
  async *unresponsive() {
    yield init;
    await new Promise(() => {});
  },
  async *crash() {
    yield init;
    throw new Error("Claude Code process exited with code 1");
  },
  async *missing() {
    throw new Error("No conversation found with session ID: gone");
  },
  async *asks({ options, signal }) {
    yield init;
    const result = await options.canUseTool("Write", { file_path: "/repo/hello.txt", content: "hi" }, {
      signal,
      requestId: "req-1",
      toolUseID: "tool-1",
      suggestions: [{ type: "addRules", rules: [{ toolName: "Write" }], behavior: "allow", destination: "localSettings" }],
    });
    yield delta(JSON.stringify(result));
    yield success;
  },
  async *sdkAbortsPending({ options }) {
    yield init;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const result = await options.canUseTool("Write", { file_path: "/repo/hello.txt", content: "hi" }, {
      signal: controller.signal,
      requestId: "req-2",
      toolUseID: "tool-2",
    });
    yield delta(JSON.stringify(result));
    yield success;
  },
  async *questions({ options, signal }) {
    yield init;
    const result = await options.canUseTool("AskUserQuestion", COLOR_QUESTION, { signal, requestId: "q-1", toolUseID: "tool-q", displayName: "AskUserQuestion", requiresUserInteraction: true });
    yield delta(JSON.stringify(result));
    yield success;
  },
  async *questionThenSteer({ options, signal, next }) {
    yield init;
    const result = await options.canUseTool("AskUserQuestion", COLOR_QUESTION, { signal, requestId: "q-1", toolUseID: "tool-q" });
    const steer = await next();
    yield delta(`${JSON.stringify(result)}|${steer.message.content[0].text}`);
    yield success;
  },
  // Claude Code sends the finished tool_use block, then asks, then sends the tool's result.
  async *runsTools({ options, signal }) {
    yield init;
    yield delta("Checking.");
    yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "npm test" } }] } };
    const answer = await options.canUseTool("Bash", { command: "npm test" }, { signal, requestId: "req-1", toolUseID: "tool-1" });
    const allowed = answer.behavior === "allow";
    yield { type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: allowed ? "ok" : answer.message, is_error: !allowed }] }, tool_use_result: allowed ? { stdout: "ok", stderr: "" } : `Error: ${answer.message}` };
    yield delta("All green.");
    yield success;
  },
  // A tool call that never gets its result before the turn ends.
  async *toolWithoutResult() {
    yield init;
    yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tool-9", name: "Bash", input: { command: "sleep 9" } }] } };
    yield success;
  },
  async *sdkAbortsAlready({ options }) {
    yield init;
    const controller = new AbortController();
    controller.abort();
    const result = await options.canUseTool("Write", { file_path: "/repo/hello.txt", content: "hi" }, {
      signal: controller.signal,
      requestId: "req-3",
      toolUseID: "tool-3",
    });
    yield delta(JSON.stringify(result));
    yield success;
  },
};

// Stands in for the SDK's query(): consumes the streaming prompt and plays a script per message.
// Scripts get the query options (for canUseTool), an abort signal that interrupt() trips, a gate
// the test opens with calls.release(), and next() to read a message sent while they run.
function fakeSdk(script) {
  const calls = { options: null, queries: 0, prompts: [], models: [], modes: [], interrupts: 0, release: () => {} };
  const query = ({ prompt, options }) => {
    calls.queries += 1;
    calls.options = options;
    let markInterrupted;
    const interrupted = new Promise((resolve) => { markInterrupted = resolve; });
    const released = new Promise((resolve) => { calls.release = resolve; });
    const controller = new AbortController();
    const messages = prompt[Symbol.asyncIterator]();
    const next = async () => {
      const { value } = await messages.next();
      if (value) calls.prompts.push(value);
      return value;
    };
    async function* run() {
      while (await next()) yield* script({ interrupted, released, options, signal: controller.signal, next });
    }
    return Object.assign(run(), {
      interrupt: async () => { calls.interrupts += 1; controller.abort(); markInterrupted(); },
      setModel: async (model) => { calls.models.push(model); },
      setPermissionMode: async (mode) => { calls.modes.push(mode); },
    });
  };
  return { calls, loadSdk: async () => ({ query }) };
}

function claude(t, { script = scripts.reply, resumeId, command = "/usr/local/bin/claude", interruptGraceMs } = {}) {
  const sdk = fakeSdk(script);
  const events = [];
  const session = new ClaudeSession({ cwd: "/repo", resumeId, command, emit: (event) => events.push(event), loadSdk: sdk.loadSdk, interruptGraceMs });
  t.after(() => session.close());
  return { session, events, calls: sdk.calls };
}
const ended = (events, count = 1) => waitUntil(() => events.filter(isTerminal).length >= count);

test("starts with Milagre's options and streams a reply", async (t) => {
  const { session, events, calls } = claude(t);
  await session.startTurn(TURN);
  await ended(events);

  assert.deepEqual(events.map((event) => event.type), ["turn-started", "session-started", "text-delta", "text-delta", "turn-completed"]);
  assert.equal(events[1].nativeId, "session-1");
  assert.equal(events.filter((event) => event.type === "text-delta").map((event) => event.text).join(""), "Hello");
  assert.equal(calls.options.cwd, "/repo");
  assert.equal(calls.options.model, "claude-opus-5-5");
  assert.equal(calls.options.permissionMode, "acceptEdits");
  assert.equal(calls.options.includePartialMessages, true);
  assert.equal(calls.options.allowDangerouslySkipPermissions, true);
  assert.equal(calls.options.pathToClaudeCodeExecutable, "/usr/local/bin/claude");
  assert.deepEqual(calls.options.settingSources, ["user", "project", "local"]);
  assert.deepEqual(calls.options.systemPrompt, { type: "preset", preset: "claude_code", append: MILAGRE_INSTRUCTIONS });
  assert.equal("resume" in calls.options, false);
  assert.deepEqual(calls.prompts[0].message.content, [{ type: "text", text: "Hi" }]);
  assert.equal(typeof calls.options.canUseTool, "function");
  assert.equal("disallowedTools" in calls.options, false);
});

test("keeps one query across turns and applies model and mode changes", async (t) => {
  const { session, events, calls } = claude(t);
  await session.startTurn(TURN);
  await ended(events);
  await session.startTurn({ ...TURN, model: "claude-sonnet-5-5", permissionMode: "full" });
  await ended(events, 2);

  assert.equal(calls.queries, 1);
  assert.deepEqual(calls.models, ["claude-sonnet-5-5"]);
  assert.deepEqual(calls.modes, ["bypassPermissions"]);
  assert.equal(events.filter((event) => event.type === "session-started").length, 1);
});

test("sends images as base64 content blocks", async (t) => {
  const { session, events, calls } = claude(t);
  await session.startTurn({ ...TURN, images: [{ mime: "image/png", base64: "iVBORw0KGgo=" }] });
  await ended(events);
  assert.deepEqual(calls.prompts[0].message.content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } });
});

test("resumes a saved session without announcing it again", async (t) => {
  const { session, events, calls } = claude(t, { resumeId: "session-1" });
  await session.startTurn(TURN);
  await ended(events);
  assert.equal(calls.options.resume, "session-1");
  assert.equal(events.some((event) => event.type === "session-started"), false);
});

test("forgets a session that can't be resumed", async (t) => {
  const { session, events } = claude(t, { script: scripts.missing, resumeId: "gone" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events.slice(1), [{ type: "session-reset" }, { type: "turn-failed", message: RESUME_FAILED_MESSAGE }]);
  assert.equal(events[0].type, "turn-started");
  assert.equal(session.closed, true);
});

test("interrupts a running turn", async (t) => {
  const { session, events, calls } = claude(t, { script: scripts.interruptible });
  await session.startTurn(TURN);
  await waitUntil(() => events.length > 0);
  await session.interrupt();
  await ended(events);
  assert.equal(calls.interrupts, 1);
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
});

test("gives up on an interrupt Claude never answers", async (t) => {
  const { session, events } = claude(t, { script: scripts.unresponsive, interruptGraceMs: 50 });
  await session.startTurn(TURN);
  await waitUntil(() => events.length > 0);
  await session.interrupt();
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
});

test("reports a crash mid-turn", async (t) => {
  const { session, events } = claude(t, { script: scripts.crash });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-failed", message: "Claude Code process exited with code 1" });
  assert.equal(session.closed, true);
});

test("explains a missing CLI without starting anything", async (t) => {
  const { session, events, calls } = claude(t, { command: null });
  await session.startTurn(TURN);
  assert.deepEqual(events, [{ type: "turn-failed", message: missingCliMessage("claude") }]);
  assert.equal(calls.queries, 0);
});

test("keeps the saved session when a resumed start fails for another reason", async (t) => {
  const script = async function* () { throw new Error("spawn EACCES"); };
  const { session, events } = claude(t, { script, resumeId: "session-1" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events.slice(1), [{ type: "turn-failed", message: "spawn EACCES" }]);
});

test("cancels a turn interrupted while the SDK is still loading", async (t) => {
  const sdk = fakeSdk(scripts.reply);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const events = [];
  const session = new ClaudeSession({ cwd: "/repo", command: "/usr/local/bin/claude", emit: (event) => events.push(event), loadSdk: async () => { await gate; return sdk.loadSdk(); } });
  t.after(() => session.close());
  const turn = session.startTurn(TURN);
  await session.interrupt();
  release();
  await turn;
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
  assert.deepEqual(sdk.calls.prompts, []);
});

test("close() ends a running turn even when Claude never answers", async (t) => {
  const { session, events } = claude(t, { script: scripts.unresponsive });
  await session.startTurn(TURN);
  await waitUntil(() => events.length > 0);
  await session.close();
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
});

test("refuses new turns once closed", async (t) => {
  const { session } = claude(t);
  await session.close();
  await assert.rejects(session.startTurn(TURN), /closed/);
});

const asked = (events) => waitUntil(() => events.some((event) => event.type === "permission-request"));
const replyText = (events) => events.filter((event) => event.type === "text-delta").map((event) => event.text).join("");

test("Ask mode lets Claude Code check with the user", async (t) => {
  const { session, events, calls } = claude(t);
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await ended(events);
  assert.equal(calls.options.permissionMode, "default");
});

test("asks before a tool runs and passes the answer back", async (t) => {
  const { session, events } = claude(t, { script: scripts.asks });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  assert.deepEqual(events.find((event) => event.type === "permission-request"), {
    type: "permission-request", requestId: "req-1", kind: "edit", tool: "Write", title: "Write hello.txt?", files: ["/repo/hello.txt"], diff: "+hi", allowForChat: true, stepId: "tool-1",
  });
  assert.equal(session.respondToPermission("req-1", "allow"), true);
  await ended(events);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "allow", updatedInput: { file_path: "/repo/hello.txt", content: "hi" } });
  const types = events.map((event) => event.type);
  assert.ok(types.indexOf("permission-resolved") < types.indexOf("turn-completed"));
  assert.deepEqual(events.find((event) => event.type === "permission-resolved"), { type: "permission-resolved", requestId: "req-1", decision: "allow" });
});

test("always allowing in this chat keeps the rule in the session", async (t) => {
  const { session, events } = claude(t, { script: scripts.asks });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  session.respondToPermission("req-1", "allow-for-chat");
  await ended(events);
  assert.deepEqual(JSON.parse(replyText(events)).updatedPermissions, [{ type: "addRules", rules: [{ toolName: "Write" }], behavior: "allow", destination: "session" }]);
});

test("denying tells Claude it was denied in Milagre", async (t) => {
  const { session, events } = claude(t, { script: scripts.asks });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  session.respondToPermission("req-1", "deny");
  await ended(events);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "deny", message: "Denied in Milagre" });
});

test("interrupting cancels a pending approval", async (t) => {
  const { session, events } = claude(t, { script: scripts.asks });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  await session.interrupt();
  await ended(events);
  assert.deepEqual(events.find((event) => event.type === "permission-resolved"), { type: "permission-resolved", requestId: "req-1", decision: "cancelled" });
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
  assert.equal(session.respondToPermission("req-1", "allow"), false);
});

test("closing cancels a pending approval", async (t) => {
  const { session, events } = claude(t, { script: scripts.asks });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  await session.close();
  assert.ok(events.some((event) => event.type === "permission-resolved" && event.decision === "cancelled"));
  // The script may still flush its last text while the query closes, so check the ending, not the order.
  assert.deepEqual(events.filter(isTerminal), [{ type: "turn-cancelled" }]);
});

test("a tool call shows as a step before its approval, and ends with its result", async (t) => {
  const { session, events } = claude(t, { script: scripts.runsTools });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  const request = events.find((event) => event.type === "permission-request");
  const started = events.find((event) => event.type === "step-started");
  assert.deepEqual(started, { type: "step-started", step: { id: "tool-1", kind: "shell", title: "Ran `npm test`", detail: "$ npm test\n" } });
  assert.equal(request.stepId, started.step.id);
  assert.ok(events.indexOf(started) < events.indexOf(request));
  session.respondToPermission("req-1", "allow");
  await ended(events);
  assert.deepEqual(events.filter((event) => event.type !== "permission-request").map((event) => event.type), [
    "turn-started", "session-started", "text-delta", "step-started", "permission-resolved", "step-completed", "text-delta", "turn-completed",
  ]);
  assert.deepEqual(events.find((event) => event.type === "step-completed"), { type: "step-completed", id: "tool-1", status: "done", detail: "$ npm test\nok" });
});

test("a denied tool call ends as a failed step", async (t) => {
  const { session, events } = claude(t, { script: scripts.runsTools });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  session.respondToPermission("req-1", "deny");
  await ended(events);
  assert.deepEqual(events.find((event) => event.type === "step-completed"), { type: "step-completed", id: "tool-1", status: "failed", detail: "$ npm test\nDenied in Milagre" });
});

test("tool calls still waiting for a result are forgotten when the turn ends", async (t) => {
  const { session, events } = claude(t, { script: scripts.toolWithoutResult });
  await session.startTurn(TURN);
  await ended(events);
  assert.equal(session.state.tools.size, 0);
});

test("an answer for an unknown request changes nothing", async (t) => {
  const { session } = claude(t);
  assert.equal(session.respondToPermission("nope", "allow"), false);
});

test("the SDK can abort a pending approval", async (t) => {
  const { session, events } = claude(t, { script: scripts.sdkAbortsPending });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  // Wait for the abort to fire and resolve the request
  await waitUntil(() => events.some((event) => event.type === "permission-resolved" && event.decision === "cancelled"));
  // The turn should end normally with turn-completed since the SDK aborted, not the session
  await ended(events);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "deny", message: "The turn was cancelled in Milagre.", interrupt: true });
  assert.deepEqual(events.at(-1), { type: "turn-completed" });
});

test("canUseTool works when the signal is already aborted", async (t) => {
  const { session, events } = claude(t, { script: scripts.sdkAbortsAlready });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  // The request should be immediately resolved as cancelled
  await waitUntil(() => events.some((event) => event.type === "permission-resolved" && event.decision === "cancelled"));
  await ended(events);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "deny", message: "The turn was cancelled in Milagre.", interrupt: true });
  // respondToPermission should return false since the request is already resolved
  assert.equal(session.respondToPermission("req-3", "allow"), false);
});

test("steers a running turn", async (t) => {
  const { session, events, calls } = claude(t, { script: scripts.absorbs });
  const first = await session.startTurn(TURN);
  const second = await session.startTurn({ ...TURN, prompt: "Also add tests" });
  await ended(events);
  assert.equal(first.steered, false);
  assert.deepEqual(second, { turnId: first.turnId, steered: true });
  assert.equal(calls.prompts.length, 2);
  assert.ok(events.some((event) => event.type === "text-delta" && event.text === "steered:Also add tests"));
  assert.equal(events.filter(isTerminal).length, 1);
});

test("a steer that arrives as the turn ends becomes a turn of its own", async (t) => {
  const { session, events, calls } = claude(t, { script: scripts.held });
  const first = await session.startTurn(TURN);
  const second = await session.startTurn({ ...TURN, prompt: "One more thing" });
  calls.release();
  await ended(events, 2);
  assert.equal(second.steered, true);
  const started = events.filter((event) => event.type === "turn-started");
  assert.equal(started.length, 2);
  assert.equal(started[0].turnId, first.turnId);
  assert.notEqual(started[1].turnId, first.turnId);
  assert.equal(session.turnActive, false);
  assert.equal(calls.prompts.length, 2);
});

test("a steer sent while the SDK is still loading waits for the turn", async (t) => {
  const { session, events, calls } = claude(t, { script: scripts.absorbs });
  const first = session.startTurn(TURN);
  const second = session.startTurn({ ...TURN, prompt: "Also add tests" });
  assert.equal((await second).steered, true);
  await first;
  await ended(events);
  assert.deepEqual(calls.prompts.map((prompt) => prompt.message.content[0].text), ["Hi", "Also add tests"]);
});

test("a message sent while a turn is stopping starts the next turn", async (t) => {
  let runs = 0;
  const script = async function* ({ interrupted, released }) {
    runs += 1;
    yield init;
    if (runs === 1) {
      await interrupted;
      await released;
      yield { type: "result", subtype: "error_during_execution", is_error: true, errors: ["Request was aborted."] };
      return;
    }
    yield delta("second");
    yield success;
  };
  const { session, events, calls } = claude(t, { script });
  const first = await session.startTurn(TURN);
  await waitUntil(() => events.length > 0);
  const release = calls.release;
  await session.interrupt();
  const pending = session.startTurn({ ...TURN, prompt: "Next" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.prompts.length, 1);
  release();
  const second = await pending;
  await ended(events, 2);

  assert.equal(second.steered, false);
  assert.notEqual(second.turnId, first.turnId);
  assert.deepEqual(events.filter(isTerminal), [{ type: "turn-cancelled" }, { type: "turn-completed" }]);
  const types = events.map((event) => event.type);
  assert.ok(types.indexOf("turn-cancelled") < types.lastIndexOf("turn-started"));
  assert.deepEqual(calls.prompts.map((prompt) => prompt.message.content[0].text), ["Hi", "Next"]);
});

test("a message sent while Stop closes the session is handed back as sessionClosed", async (t) => {
  const { session, events } = claude(t, { script: scripts.unresponsive, interruptGraceMs: 50 });
  await session.startTurn(TURN);
  await waitUntil(() => events.length > 0);
  await session.interrupt();
  await assert.rejects(session.startTurn({ ...TURN, prompt: "Next" }), (error) => error.sessionClosed === true);
  assert.deepEqual(events.filter(isTerminal), [{ type: "turn-cancelled" }]);
  assert.equal(session.closed, true);
  await assert.rejects(session.startTurn(TURN), (error) => error.sessionClosed === true);
});

test("an approval requested after the turn was stopped is cancelled at once", async (t) => {
  const script = async function* ({ interrupted, options }) {
    yield init;
    await interrupted;
    const result = await options.canUseTool("Write", { file_path: "/repo/hello.txt", content: "hi" }, { requestId: "late-1", toolUseID: "tool-late" });
    yield delta(JSON.stringify(result));
    yield { type: "result", subtype: "error_during_execution", is_error: true, errors: ["Request was aborted."] };
  };
  const { session, events } = claude(t, { script });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await waitUntil(() => events.length > 0);
  await session.interrupt();
  await ended(events);
  assert.equal(events.some((event) => event.type === "permission-request" || event.type === "permission-resolved"), false);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "deny", message: "The turn was cancelled in Milagre.", interrupt: true });
  assert.equal(session.respondToPermission("late-1", "allow"), false);
});

const questioned = (events) => waitUntil(() => events.some((event) => event.type === "question-request"));

test("Claude's question becomes a card, and the answers go back keyed by question text", async (t) => {
  const { session, events, calls } = claude(t, { script: scripts.questions });
  await session.startTurn({ ...TURN, permissionMode: "full" });
  await questioned(events);
  assert.equal(calls.options.permissionMode, "bypassPermissions");
  assert.deepEqual(events.find((event) => event.type === "question-request"), {
    type: "question-request",
    requestId: "q-1",
    questions: [{ id: "0", header: "Color", question: "Which color?", options: [{ label: "Red", description: "Warm" }, { label: "Green", description: "Calm" }], multiSelect: false, allowOther: true, secret: false }],
  });
  assert.equal(session.answerQuestion("q-1", { "0": ["Green"] }), true);
  assert.equal(session.answerQuestion("q-1", { "0": ["Red"] }), false);
  await ended(events);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "allow", updatedInput: { ...COLOR_QUESTION, answers: { "Which color?": "Green" } } });
  assert.deepEqual(events.find((event) => event.type === "question-resolved"), { type: "question-resolved", requestId: "q-1", outcome: "answered" });
  assert.deepEqual(events.at(-1), { type: "turn-completed" });
});

test("dismissing Claude's question tells Claude the user closed it", async (t) => {
  const { session, events } = claude(t, { script: scripts.questions });
  await session.startTurn(TURN);
  await questioned(events);
  assert.equal(session.answerQuestion("q-1", null), true);
  await ended(events);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "deny", message: DISMISSED_MESSAGE });
  assert.equal(events.find((event) => event.type === "question-resolved").outcome, "dismissed");
});

test("interrupting cancels Claude's open question", async (t) => {
  const { session, events } = claude(t, { script: scripts.questions });
  await session.startTurn(TURN);
  await questioned(events);
  await session.interrupt();
  await ended(events);
  assert.deepEqual(events.find((event) => event.type === "question-resolved"), { type: "question-resolved", requestId: "q-1", outcome: "cancelled" });
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
  assert.equal(session.answerQuestion("q-1", { "0": ["Green"] }), false);
});

test("a steering message dismisses Claude's open question and reaches Claude", async (t) => {
  const { session, events } = claude(t, { script: scripts.questionThenSteer });
  const first = await session.startTurn(TURN);
  await questioned(events);
  assert.deepEqual(await session.startTurn({ ...TURN, prompt: "Green, please" }), { turnId: first.turnId, steered: true });
  await ended(events);
  const [result, steer] = replyText(events).split("|");
  assert.deepEqual(JSON.parse(result), { behavior: "deny", message: DISMISSED_MESSAGE });
  assert.equal(steer, "Green, please");
  assert.equal(events.find((event) => event.type === "question-resolved").outcome, "dismissed");
});

test("a question Milagre can't show is turned down without a card", async (t) => {
  const script = async function* ({ options }) {
    yield init;
    yield delta(JSON.stringify(await options.canUseTool("AskUserQuestion", { questions: [] }, { requestId: "q-bad", toolUseID: "tool-bad" })));
    yield success;
  };
  const { session, events } = claude(t, { script });
  await session.startTurn(TURN);
  await ended(events);
  assert.equal(events.some((event) => event.type === "question-request"), false);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "deny", message: UNSHOWN_MESSAGE });
});

test("a question asked after the turn was stopped is cancelled at once", async (t) => {
  const script = async function* ({ interrupted, options }) {
    yield init;
    await interrupted;
    yield delta(JSON.stringify(await options.canUseTool("AskUserQuestion", COLOR_QUESTION, { requestId: "q-late", toolUseID: "tool-late" })));
    yield { type: "result", subtype: "error_during_execution", is_error: true, errors: ["Request was aborted."] };
  };
  const { session, events } = claude(t, { script });
  await session.startTurn(TURN);
  await waitUntil(() => events.length > 0);
  await session.interrupt();
  await ended(events);
  assert.equal(events.some((event) => event.type === "question-request" || event.type === "question-resolved"), false);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "deny", message: "The turn was cancelled in Milagre.", interrupt: true });
  assert.equal(session.answerQuestion("q-late", null), false);
});
