const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CodexRpc } = require("./codex-rpc.cjs");
const { CodexSession } = require("./codex-provider.cjs");
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, isTerminal, missingCliMessage } = require("./events.cjs");
const { decodeImages } = require("../image-input.cjs");
const { waitUntil } = require("./test-helpers.cjs");

const FAKE = path.join(__dirname, "fixtures", "fake-app-server.cjs");
const TURN = { prompt: "Hi", images: [], model: "gpt-6-sol", permissionMode: "auto" };

function codex(t, { scenario = "reply", resumeId, command = process.execPath, interruptGraceMs } = {}) {
  const events = [];
  const session = new CodexSession({
    cwd: os.tmpdir(),
    resumeId,
    command,
    clientVersion: "test",
    interruptGraceMs,
    emit: (event) => events.push(event),
    createRpc: (options) => new CodexRpc({ ...options, args: [FAKE], env: { ...process.env, FAKE_SCENARIO: scenario } }),
  });
  t.after(() => session.close());
  return { session, events };
}
const ended = (events, count = 1) => waitUntil(() => events.filter(isTerminal).length >= count);
const received = async (session) => (await session.rpc.request("fake/received")).received;
const asked = (events) => waitUntil(() => events.some((event) => event.type === "permission-request"));
const replyText = (events) => events.filter((event) => event.type === "text-delta").map((event) => event.text).join("");

test("streams a reply and keeps one thread across turns", async (t) => {
  const { session, events } = codex(t);
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events, [
    { type: "session-started", nativeId: "thread-1" },
    { type: "turn-started", turnId: "turn-1" },
    { type: "text-delta", messageId: "turn-1", text: "Hel" },
    { type: "text-delta", messageId: "turn-1", text: "lo" },
    { type: "turn-completed" },
  ]);

  await session.startTurn(TURN);
  await ended(events, 2);
  assert.equal(events.filter((event) => event.type === "session-started").length, 1);
  assert.equal((await session.rpc.request("fake/received")).threadStarts, 1);
  assert.equal(session.nativeId, "thread-1");
});

test("starts threads and turns with Milagre's identity, instructions and policy", async (t) => {
  const { session, events } = codex(t);
  await session.startTurn({ ...TURN, permissionMode: "full" });
  await ended(events);
  const messages = await received(session);
  const find = (method) => messages.find((message) => message.method === method).params;

  assert.equal(find("initialize").clientInfo.name, "milagre");
  assert.equal(find("thread/start").developerInstructions, MILAGRE_INSTRUCTIONS);
  assert.equal(find("turn/start").approvalPolicy, "never");
  assert.deepEqual(find("turn/start").sandboxPolicy, { type: "dangerFullAccess" });
  assert.deepEqual(find("turn/start").input, [{ type: "text", text: "Hi", text_elements: [] }]);
});

test("Ask asks about untrusted commands, Auto only about leaving the sandbox", async (t) => {
  const { session, events } = codex(t);
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await ended(events);
  await session.startTurn({ ...TURN, permissionMode: "auto" });
  await ended(events, 2);
  const turnStarts = (await received(session)).filter((message) => message.method === "turn/start").map((message) => message.params);
  assert.deepEqual(turnStarts.map((params) => params.approvalPolicy), ["untrusted", "on-request"]);
  for (const params of turnStarts) {
    assert.equal(params.sandboxPolicy.type, "workspaceWrite");
    assert.deepEqual(params.sandboxPolicy.writableRoots, [os.tmpdir()]);
  }
});

test("resumes a saved thread without announcing it again", async (t) => {
  const { session, events } = codex(t, { resumeId: "thread-9" });
  await session.startTurn(TURN);
  await ended(events);
  assert.equal((await received(session)).find((message) => message.method === "thread/resume").params.threadId, "thread-9");
  assert.equal(events.some((event) => event.type === "session-started"), false);
  assert.equal(session.nativeId, "thread-9");
});

test("forgets a thread that can't be resumed", async (t) => {
  const { session, events } = codex(t, { resumeId: "missing" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events, [{ type: "session-reset" }, { type: "turn-failed", message: RESUME_FAILED_MESSAGE }]);
  assert.equal(session.closed, true);
});

test("interrupts a running turn", async (t) => {
  const { session, events } = codex(t, { scenario: "slow" });
  await session.startTurn(TURN);
  await session.interrupt();
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
});

test("cancels before Codex has started the turn", async (t) => {
  const { session, events } = codex(t);
  const pending = session.startTurn(TURN);
  await session.interrupt();
  await pending;
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
  assert.equal((await received(session)).some((message) => message.method === "turn/start"), false);
});

test("reports a failed turn and a crashed process", async (t) => {
  const failed = codex(t, { scenario: "fail" });
  await failed.session.startTurn(TURN);
  await ended(failed.events);
  assert.deepEqual(failed.events.at(-1), { type: "turn-failed", message: "The model gpt-x is not supported." });

  const crashed = codex(t, { scenario: "crash" });
  await crashed.session.startTurn(TURN);
  await ended(crashed.events);
  assert.match(crashed.events.at(-1).message, /boom: model unavailable/);
  assert.equal(crashed.session.closed, true);
});

test("asks before running a command and passes the answer back", async (t) => {
  const { session, events } = codex(t, { scenario: "approval" });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  assert.deepEqual(events.find((event) => event.type === "permission-request"), {
    type: "permission-request", requestId: "srv-1", kind: "command", tool: "Shell", title: "Run this command?", command: "rm -rf build", cwd: "/repo", reason: "Clean the build", allowForChat: true,
  });
  assert.equal(session.respondToPermission("srv-1", "allow-for-chat"), true);
  await ended(events);
  assert.equal(replyText(events), "decision:acceptForSession");
  assert.deepEqual(events.find((event) => event.type === "permission-resolved"), { type: "permission-resolved", requestId: "srv-1", decision: "allow-for-chat" });
});

test("denying declines the command", async (t) => {
  const { session, events } = codex(t, { scenario: "approval" });
  await session.startTurn(TURN);
  await asked(events);
  session.respondToPermission("srv-1", "deny");
  await ended(events);
  assert.equal(replyText(events), "decision:decline");
});

test("file changes show the diff Codex is about to apply", async (t) => {
  const { session, events } = codex(t, { scenario: "file-approval" });
  await session.startTurn(TURN);
  await asked(events);
  assert.deepEqual(events.find((event) => event.type === "permission-request"), {
    type: "permission-request", requestId: "srv-1", kind: "edit", tool: "Edit files", title: "Edit notes.txt?", files: ["/repo/notes.txt"], diff: "--- /repo/notes.txt\n+hello\n", reason: "Write notes", allowForChat: true,
  });
  session.respondToPermission("srv-1", "allow");
  await ended(events);
  assert.equal(replyText(events), "decision:accept");
});

test("interrupting cancels a pending approval", async (t) => {
  const { session, events } = codex(t, { scenario: "approval" });
  await session.startTurn(TURN);
  await asked(events);
  await session.interrupt();
  await ended(events);
  assert.deepEqual(events.find((event) => event.type === "permission-resolved"), { type: "permission-resolved", requestId: "srv-1", decision: "cancelled" });
  assert.equal(replyText(events), "decision:cancel");
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
});

test("a request Codex withdraws is dropped without an answer", async (t) => {
  const { session, events } = codex(t, { scenario: "withdrawn" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events.find((event) => event.type === "permission-resolved"), { type: "permission-resolved", requestId: "srv-1", decision: "cancelled" });
  assert.equal((await received(session)).some((message) => message.id === "srv-1"), false);
  assert.equal(session.respondToPermission("srv-1", "allow"), false);
});

test("extra sandbox permissions are declined", async (t) => {
  const { session, events } = codex(t, { scenario: "permissions" });
  await session.startTurn(TURN);
  await ended(events);
  assert.equal(replyText(events), 'answer:{"permissions":{},"scope":"turn"}');
  assert.equal(events.some((event) => event.type === "permission-request"), false);
});

test("passes images as local files and removes them afterwards", async (t) => {
  const { session, events } = codex(t);
  const png = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64")}`;
  await session.startTurn({ ...TURN, images: decodeImages([{ dataUrl: png }]) });
  await ended(events);
  const turnStart = (await received(session)).find((message) => message.method === "turn/start");
  const image = turnStart.params.input.find((input) => input.type === "localImage");
  assert.deepEqual(turnStart.imagesExist, [true]);
  assert.equal(fs.existsSync(image.path), false);
});

test("closes a session whose startup failed so the next message starts over", async (t) => {
  const { session, events } = codex(t, { command: "milagre-definitely-missing-cli" });
  await session.startTurn(TURN);
  assert.match(events.at(-1).message, /isn't installed or isn't on your PATH/);
  assert.equal(session.closed, true);
});

test("explains a missing CLI without starting anything", async (t) => {
  const { session, events } = codex(t, { command: null });
  await session.startTurn(TURN);
  assert.deepEqual(events, [{ type: "turn-failed", message: missingCliMessage("codex") }]);
});

test("gives up on an interrupt Codex never answers", async (t) => {
  const { session, events } = codex(t, { scenario: "stubborn", interruptGraceMs: 50 });
  await session.startTurn(TURN);
  await session.interrupt();
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
  assert.equal(session.closed, true);
});

test("cancels a startup that hangs", async (t) => {
  const { session, events } = codex(t, { scenario: "hang-init", interruptGraceMs: 50 });
  const pending = session.startTurn(TURN);
  await session.interrupt();
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
  assert.equal(session.closed, true);
  await pending;
});

test("keeps the saved thread when resuming fails without an answer", async (t) => {
  const { session, events } = codex(t, { scenario: "resume-exit", resumeId: "thread-9" });
  await session.startTurn(TURN);
  await ended(events);
  assert.equal(events.some((event) => event.type === "session-reset"), false);
  assert.equal(events.at(-1).type, "turn-failed");
  assert.equal(session.nativeId, "thread-9");
});

test("steers a running turn", async (t) => {
  const { session, events } = codex(t, { scenario: "steer" });
  const first = await session.startTurn(TURN);
  const second = await session.startTurn({ ...TURN, prompt: "Also add tests" });
  await ended(events);
  assert.deepEqual(first, { turnId: "turn-1", steered: false });
  assert.deepEqual(second, { turnId: "turn-1", steered: true });
  assert.ok(events.some((event) => event.type === "text-delta" && event.text === "steered:Also add tests"));
  const steer = (await received(session)).find((message) => message.method === "turn/steer").params;
  assert.equal(steer.expectedTurnId, "turn-1");
  assert.equal(steer.threadId, "thread-1");
  assert.deepEqual(steer.input, [{ type: "text", text: "Also add tests", text_elements: [] }]);
});

test("a steer Codex refuses starts the next turn once this one ends", async (t) => {
  const { session, events } = codex(t, { scenario: "steer" });
  await session.startTurn(TURN);
  const late = await session.startTurn({ ...TURN, prompt: "too late" });
  await ended(events, 2);
  assert.deepEqual(late, { turnId: "turn-2", steered: false });
  assert.deepEqual(events.filter((event) => event.type === "turn-started").map((event) => event.turnId), ["turn-1", "turn-2"]);
  const types = events.map((event) => event.type);
  assert.ok(types.indexOf("turn-completed") < types.lastIndexOf("turn-started"));
  const starts = (await received(session)).filter((message) => message.method === "turn/start");
  assert.equal(starts.length, 2);
  assert.equal(starts[1].params.input[0].text, "too late");
});

test("a steer sent before Codex has started the turn waits for it", async (t) => {
  const { session, events } = codex(t, { scenario: "steer" });
  const first = session.startTurn(TURN);
  const second = session.startTurn({ ...TURN, prompt: "Also add tests" });
  assert.deepEqual(await second, { turnId: "turn-1", steered: true });
  assert.deepEqual(await first, { turnId: "turn-1", steered: false });
  await ended(events);
});

test("a steer for a turn Codex gave no id becomes the next turn", async (t) => {
  const { session, events } = codex(t, { scenario: "no-turn-id" });
  const first = await session.startTurn(TURN);
  assert.deepEqual(first, { turnId: null, steered: false });
  const second = await session.startTurn({ ...TURN, prompt: "Also add tests" });
  await ended(events, 2);
  assert.deepEqual(second, { turnId: "turn-2", steered: false });
  const starts = (await received(session)).filter((message) => message.method === "turn/start");
  assert.equal(starts.length, 2);
  assert.equal(starts[1].params.input[0].text, "Also add tests");
});

test("a turn's end settles even when a new turn starts during its cleanup", async (t) => {
  const { session } = codex(t, { scenario: "slow" });
  await session.startTurn(TURN);
  const firstEnded = session.turnEnded;
  let settled = false;
  void firstEnded.then(() => { settled = true; });
  // Hold the first turn's finishTurn on a pending image cleanup, so a new turn can start inside it.
  let release;
  session.imageSets.push({ cleanup: () => new Promise((resolve) => { release = resolve; }) });
  await session.interrupt();
  await waitUntil(() => release);
  assert.equal(session.turnActive, false);
  await session.startTurn(TURN);
  const secondEnded = session.turnEnded;
  let secondSettled = false;
  void secondEnded.then(() => { secondSettled = true; });
  release();
  await waitUntil(() => settled);
  assert.notEqual(firstEnded, secondEnded);
  assert.equal(secondSettled, false);
});

test("a message sent while a turn is stopping starts the next turn", async (t) => {
  const { session, events } = codex(t, { scenario: "slow-stop" });
  const first = await session.startTurn(TURN);
  const stopping = session.interrupt();
  const second = await session.startTurn({ ...TURN, prompt: "Next" });
  await stopping;
  await ended(events, 2);
  assert.deepEqual(first, { turnId: "turn-1", steered: false });
  assert.deepEqual(second, { turnId: "turn-2", steered: false });
  assert.deepEqual(events.filter(isTerminal), [{ type: "turn-cancelled" }, { type: "turn-completed" }]);
  const types = events.map((event) => event.type);
  assert.ok(types.indexOf("turn-cancelled") < types.lastIndexOf("turn-started"));
  const messages = await received(session);
  assert.equal(messages.filter((message) => message.method === "turn/steer").length, 0);
  assert.equal(messages.filter((message) => message.method === "turn/start").length, 2);
});

test("an approval requested after the turn was stopped is cancelled at once", async (t) => {
  const { session, events } = codex(t, { scenario: "late-approval" });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await session.interrupt();
  await ended(events);
  let answer;
  await waitUntil(() => {
    void received(session).then((messages) => { answer = messages.find((message) => message.id === "srv-late"); });
    return answer;
  });
  assert.deepEqual(answer.result, { decision: "cancel" });
  assert.equal(events.some((event) => event.type === "permission-request" || event.type === "permission-resolved"), false);
  assert.equal(session.permissions.size, 0);
});

test("a turn Codex announces that this session isn't running is ignored", async (t) => {
  const { session, events } = codex(t);
  await session.startTurn(TURN);
  await ended(events);
  await session.rpc.request("fake/turn-started");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(events.filter((event) => event.type === "turn-started").length, 1);
});

test("an unknown permission mode uses Ask's policy", async (t) => {
  const { session, events } = codex(t);
  await session.startTurn({ ...TURN, permissionMode: "something-else" });
  await ended(events);
  const params = (await received(session)).find((message) => message.method === "turn/start").params;
  assert.equal(params.approvalPolicy, "untrusted");
  assert.equal(params.sandboxPolicy.type, "workspaceWrite");
  assert.equal((await received(session)).find((message) => message.method === "thread/start").params.sandbox, "workspace-write");
});
