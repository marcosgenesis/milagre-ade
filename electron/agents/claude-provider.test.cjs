const assert = require("node:assert/strict");
const test = require("node:test");
const { ClaudeSession } = require("./claude-provider.cjs");
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, isTerminal, missingCliMessage } = require("./events.cjs");
const { waitUntil } = require("./test-helpers.cjs");

const TURN = { prompt: "Hi", images: [], model: "claude-opus-5-5", permissionMode: "auto" };
const init = { type: "system", subtype: "init", session_id: "session-1" };
const delta = (text) => ({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
const success = { type: "result", subtype: "success", is_error: false, result: "Hello" };

const scripts = {
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
};

// Stands in for the SDK's query(): consumes the streaming prompt and plays a script per turn.
function fakeSdk(script) {
  const calls = { options: null, queries: 0, prompts: [], models: [], modes: [], interrupts: 0 };
  const query = ({ prompt, options }) => {
    calls.queries += 1;
    calls.options = options;
    let markInterrupted;
    const interrupted = new Promise((resolve) => { markInterrupted = resolve; });
    async function* run() {
      for await (const message of prompt) {
        calls.prompts.push(message);
        yield* script({ interrupted });
      }
    }
    return Object.assign(run(), {
      interrupt: async () => { calls.interrupts += 1; markInterrupted(); },
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

  assert.deepEqual(events.map((event) => event.type), ["session-started", "text-delta", "text-delta", "turn-completed"]);
  assert.equal(events[0].nativeId, "session-1");
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
  assert.deepEqual(events, [{ type: "session-reset" }, { type: "turn-failed", message: RESUME_FAILED_MESSAGE }]);
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
