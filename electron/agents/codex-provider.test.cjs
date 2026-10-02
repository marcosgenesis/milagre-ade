const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CodexRpc } = require("./codex-rpc.cjs");
const { CodexSession } = require("./codex-provider.cjs");
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, crashMessage, isTerminal, loginMessage, missingCliMessage, failedWith } = require("./events.cjs");
const { decodeImages } = require("../image-input.cjs");
const { waitUntil } = require("./test-helpers.cjs");

const FAKE = path.join(__dirname, "fixtures", "fake-app-server.cjs");
const TURN = { prompt: "Hi", images: [], model: "gpt-6-sol", permissionMode: "auto" };

function codex(t, { scenario = "reply", resumeId, tldrEnabled, command = process.execPath, interruptGraceMs } = {}) {
  const events = [];
  const session = new CodexSession({
    cwd: os.tmpdir(),
    resumeId,
    tldrEnabled,
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
  assert.deepEqual(find("thread/start").config, { features: { default_mode_request_user_input: true } });
  assert.equal(find("turn/start").approvalPolicy, "never");
  assert.deepEqual(find("turn/start").sandboxPolicy, { type: "dangerFullAccess" });
  assert.deepEqual(find("turn/start").input, [{ type: "text", text: "Hi", text_elements: [] }]);
  // Reasoning summaries are what the reply's thinking steps show.
  assert.equal(find("turn/start").summary, "auto");
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
  const resume = (await received(session)).find((message) => message.method === "thread/resume").params;
  assert.equal(resume.threadId, "thread-9");
  assert.deepEqual(resume.config, { features: { default_mode_request_user_input: true } });
  assert.equal(events.some((event) => event.type === "session-started"), false);
  assert.equal(session.nativeId, "thread-9");
});

test("forgets a thread that can't be resumed", async (t) => {
  const { session, events } = codex(t, { resumeId: "missing" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events, [{ type: "session-reset" }, failedWith(RESUME_FAILED_MESSAGE)]);
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
  assert.deepEqual(crashed.events.at(-1), failedWith(crashMessage("codex", "boom: model unavailable")));
  assert.equal(crashed.session.closed, true);
});

test("asks before running a command and passes the answer back", async (t) => {
  const { session, events } = codex(t, { scenario: "approval" });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  assert.deepEqual(events.find((event) => event.type === "permission-request"), {
    type: "permission-request", requestId: "srv-1", kind: "command", tool: "Shell", title: "Run this command?", command: "rm -rf build", cwd: "/repo", reason: "Clean the build", allowForChat: true, stepId: "cmd-1",
  });
  assert.equal(session.respondToPermission("srv-1", "allow-for-chat"), true);
  await ended(events);
  assert.equal(replyText(events), "decision:acceptForSession");
  assert.deepEqual(events.find((event) => event.type === "permission-resolved"), { type: "permission-resolved", requestId: "srv-1", decision: "allow-for-chat" });
});

test("switching to Full mid-turn approves the waiting command", async (t) => {
  const { session, events } = codex(t, { scenario: "approval" });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  session.setPermissionMode("full");
  await ended(events);
  assert.equal(replyText(events), "decision:accept");
  assert.deepEqual(events.find((event) => event.type === "permission-resolved"), { type: "permission-resolved", requestId: "srv-1", decision: "allow" });
});

test("switching to Auto mid-turn leaves a waiting command to the user", async (t) => {
  const { session, events } = codex(t, { scenario: "approval" });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  session.setPermissionMode("auto");
  assert.equal(session.permissions.size, 1);
  session.respondToPermission("srv-1", "deny");
  await ended(events);
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
    type: "permission-request", requestId: "srv-1", kind: "edit", tool: "Edit files", title: "Edit notes.txt?", files: ["/repo/notes.txt"], diff: "--- /repo/notes.txt\n+hello\n", reason: "Write notes", allowForChat: true, stepId: "patch-1",
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

test("a logged-out Codex fails the turn at once with the login message", async (t) => {
  const { session, events } = codex(t, { scenario: "logged-out" });
  await session.startTurn(TURN);
  assert.deepEqual(events, [failedWith(loginMessage("codex"), { login: true })]);
  assert.equal(session.closed, true);
});

test("a Codex on a provider that needs no OpenAI login isn't held up", async (t) => {
  const { session, events } = codex(t, { scenario: "custom-provider" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-completed" });
  assert.deepEqual((await received(session)).map((message) => message.method).slice(0, 4), ["initialize", "initialized", "account/read", "thread/start"]);
});

test("explains a missing CLI without starting anything", async (t) => {
  const { session, events } = codex(t, { command: null });
  await session.startTurn(TURN);
  assert.deepEqual(events, [failedWith(missingCliMessage("codex"))]);
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

test("a message sent while Stop closes the session is handed back as sessionClosed", async (t) => {
  const { session, events } = codex(t, { scenario: "stubborn", interruptGraceMs: 50 });
  await session.startTurn(TURN);
  const stopping = session.interrupt();
  await assert.rejects(session.startTurn({ ...TURN, prompt: "Next" }), (error) => error.sessionClosed === true);
  await stopping;
  assert.deepEqual(events.filter(isTerminal), [{ type: "turn-cancelled" }]);
  assert.equal(events.some((event) => event.type === "turn-failed"), false);
  assert.equal(session.closed, true);
});

test("an approval requested after the turn was stopped is cancelled at once", async (t) => {
  const { session, events } = codex(t, { scenario: "late-approval" });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await session.interrupt();
  await ended(events);
  let answer;
  for (let attempt = 0; !answer; attempt += 1) {
    assert.ok(attempt < 300, "Timed out waiting for the late approval's answer");
    answer = (await received(session)).find((message) => message.id === "srv-late");
    if (!answer) await new Promise((resolve) => setTimeout(resolve, 10));
  }
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

test("commands, reasoning and file changes become steps, in order with the reply", async (t) => {
  const { session, events } = codex(t, { scenario: "steps" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events.slice(2), [
    { type: "step-started", step: { id: "exec-1", kind: "shell", title: "Ran `npm test`", detail: "$ npm test\n" } },
    { type: "step-output", id: "exec-1", text: "ok 2\n" },
    { type: "step-completed", id: "exec-1", status: "done", detail: "$ npm test\nok 1\nok 2\n" },
    { type: "step-started", step: { id: "rs-1", kind: "thinking", title: "Thinking" } },
    { type: "step-started", step: { id: "exec-2", kind: "edit", title: "Created `notes.txt`", file: "/repo/notes.txt" } },
    { type: "step-completed", id: "exec-2", status: "done", title: "Created `notes.txt`", detail: "--- /repo/notes.txt\n+hello\n" },
    { type: "text-delta", messageId: "turn-1", text: "Done" },
    { type: "turn-completed" },
  ]);
});

test("a command still running when the turn is stopped gets no step-completed", async (t) => {
  const { session, events } = codex(t, { scenario: "running-step" });
  await session.startTurn(TURN);
  await waitUntil(() => events.some((event) => event.type === "step-started"));
  await session.interrupt();
  await ended(events);
  assert.equal(events.some((event) => event.type === "step-completed"), false);
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
  assert.equal(session.state.steps.size, 0);
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

const questioned = (events) => waitUntil(() => events.some((event) => event.type === "question-request"));
// Polls until the fake app-server has received the client's reply to one of its own requests.
async function replyTo(session, id) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const reply = (await received(session)).find((message) => message.id === id && !message.method);
    if (reply) return reply;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for the reply to ${id}`);
}

test("Codex's question becomes a card, and the answers go back per question id", async (t) => {
  const { session, events } = codex(t, { scenario: "question" });
  await session.startTurn(TURN);
  await questioned(events);
  assert.deepEqual(events.find((event) => event.type === "question-request"), {
    type: "question-request",
    requestId: "srv-q",
    questions: [{ id: "color", header: "Color", question: "Which color?", options: [{ label: "Red", description: "Warm" }, { label: "Green", description: "Calm" }], multiSelect: false, allowOther: true, secret: false }],
  });
  assert.equal(session.answerQuestion("srv-q", { color: ["Green"] }), true);
  await ended(events);
  assert.equal(replyText(events), 'answer:{"answers":{"color":{"answers":["Green"]}}}');
  assert.deepEqual(events.find((event) => event.type === "question-resolved"), { type: "question-resolved", requestId: "srv-q", outcome: "answered" });
});

test("dismissing Codex's question sends no answers", async (t) => {
  const { session, events } = codex(t, { scenario: "question" });
  await session.startTurn(TURN);
  await questioned(events);
  session.answerQuestion("srv-q", null);
  await ended(events);
  assert.equal(replyText(events), 'answer:{"answers":{}}');
  assert.equal(events.find((event) => event.type === "question-resolved").outcome, "dismissed");
});

test("interrupting cancels Codex's open question", async (t) => {
  const { session, events } = codex(t, { scenario: "question" });
  await session.startTurn(TURN);
  await questioned(events);
  await session.interrupt();
  await ended(events);
  assert.deepEqual(events.find((event) => event.type === "question-resolved"), { type: "question-resolved", requestId: "srv-q", outcome: "cancelled" });
  assert.equal(replyText(events), 'answer:{"answers":{}}');
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
  assert.equal(session.answerQuestion("srv-q", { color: ["Green"] }), false);
});

test("a question Codex withdraws is dropped without an answer", async (t) => {
  const { session, events } = codex(t, { scenario: "question-withdrawn" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events.find((event) => event.type === "question-resolved"), { type: "question-resolved", requestId: "srv-q", outcome: "cancelled" });
  assert.equal((await received(session)).some((message) => message.id === "srv-q"), false);
  assert.equal(session.answerQuestion("srv-q", null), false);
});

test("a steering message dismisses Codex's open question, then steers the turn", async (t) => {
  const { session, events } = codex(t, { scenario: "question-steer" });
  await session.startTurn(TURN);
  await questioned(events);
  assert.deepEqual(await session.startTurn({ ...TURN, prompt: "Green, please" }), { turnId: "turn-1", steered: true });
  await ended(events);
  assert.equal(events.find((event) => event.type === "question-resolved").outcome, "dismissed");
  assert.equal(replyText(events), "steered:Green, please");
  const messages = await received(session);
  const answer = messages.findIndex((message) => message.id === "srv-q");
  assert.deepEqual(messages[answer].result, { answers: {} });
  assert.ok(answer < messages.findIndex((message) => message.method === "turn/steer"));
});

test("a question asked after the turn was stopped gets no answers at once", async (t) => {
  const { session, events } = codex(t, { scenario: "late-question" });
  await session.startTurn(TURN);
  await session.interrupt();
  await ended(events);
  assert.deepEqual((await replyTo(session, "srv-late")).result, { answers: {} });
  assert.equal(events.some((event) => event.type === "question-request" || event.type === "question-resolved"), false);
  assert.equal(session.questions.size, 0);
});

test("threads start and resume without the question tool when Codex rejects the config", async (t) => {
  for (const options of [{}, { resumeId: "thread-9" }]) {
    const { session, events } = codex(t, { scenario: "reject-config", ...options });
    await session.startTurn(TURN);
    await ended(events);
    const calls = (await received(session)).filter((message) => message.method === "thread/start" || message.method === "thread/resume");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].params.config !== undefined, true);
    assert.equal("config" in calls[1].params, false);
    assert.equal(events.some((event) => event.type === "session-reset"), false);
    assert.deepEqual(events.at(-1), { type: "turn-completed" });
  }
});


test("a Codex whose token expired mid-session closes its session, so the next message starts a fresh app-server", async (t) => {
  const { session, events } = codex(t, { scenario: "unauthorized" });
  await session.startTurn(TURN);
  await ended(events);
  // closed flips when close() starts; the app-server's exit lands once the kill completes.
  await waitUntil(() => session.closed && session.rpc.exited);
  assert.deepEqual(events.at(-1), failedWith(loginMessage("codex"), { login: true }));
});

test("a 401 on a provider that needs no OpenAI login keeps Codex's own error and the session", async (t) => {
  const { session, events } = codex(t, { scenario: "unauthorized-custom" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-failed", message: "unexpected status 401 Unauthorized: token expired" });
  assert.equal(session.closed, false);
});

test("after a login failure the next message starts a fresh app-server that resumes the saved thread", async (t) => {
  const { SessionManager } = require("./session-manager.cjs");
  const sessions = [];
  const sent = [];
  const manager = new SessionManager({
    send: (chatId, event) => sent.push(event),
    createSession: (provider, options) => {
      const scenario = sessions.length === 0 ? "unauthorized" : "reply";
      const session = new CodexSession({ ...options, cwd: os.tmpdir(), clientVersion: "test", createRpc: (rpcOptions) => new CodexRpc({ ...rpcOptions, args: [FAKE], env: { ...process.env, FAKE_SCENARIO: scenario } }) });
      sessions.push(session);
      return session;
    },
  });
  t.after(() => Promise.all(sessions.map((session) => session.close())));
  const request = { chatId: "chat-1", provider: "codex", cwd: os.tmpdir(), command: process.execPath, prompt: "Hi", images: [], model: "gpt-6-sol", permissionMode: "auto", resumeId: "thread-1" };
  await manager.startTurn(request);
  await waitUntil(() => sent.some((event) => event.login) && sessions[0].closed);
  await manager.startTurn(request);
  await waitUntil(() => sent.filter(isTerminal).length === 2);
  assert.equal(sessions.length, 2);
  assert.deepEqual(sent.at(-1), { type: "turn-completed" });
  assert.equal(sent.some((event) => event.message === RESUME_FAILED_MESSAGE), false);
});

test("a crashed Codex's failure is one of Milagre's own messages", async (t) => {
  const { session, events } = codex(t, { scenario: "crash" });
  await session.startTurn(TURN);
  await ended(events);
  assert.equal(events.at(-1).notice, true);
});


test("TLDR can be disabled when starting or resuming Codex", async (t) => {
  for (const resumeId of [undefined, "thread-existing"]) {
    const { session, events } = codex(t, { tldrEnabled: false, resumeId });
    await session.startTurn(TURN);
    await ended(events);
    const calls = await received(session);
    const params = calls.find((call) => call.method === (resumeId ? "thread/resume" : "thread/start")).params;
    assert.ok(!params.developerInstructions.includes("# tldr eval"));
    assert.match(params.developerInstructions, /TLDR.*disabled/);
  }
});

test('reads child history without resuming it and keeps child completion separate from parent', async () => {
 const events=[];
 const session=new CodexSession({emit:e=>events.push(e)});
 session.state.threadId='parent';
 session.state.subagents=new Map([['child',{id:'child',title:'Review',status:'running',startedAt:1,updatedAt:1,transcript:[]}]]);
 session.rpc={request:async(method,params)=>{
  assert.equal(method,'thread/read');
  assert.deepEqual(params,{threadId:'child',includeTurns:true});
  return {thread:{id:'child',turns:[{id:'child-turn',status:'completed',items:[{type:'agentMessage',id:'answer',text:'Review finished'}]}]}};
 }};
 await session.refreshSubagents();
 assert.equal(events.some(e=>e.type==='turn-completed'),false);
 const child=events.filter(e=>e.type==='subagent-update').at(-1).agent;
 assert.equal(child.status,'completed');
 assert.equal(child.transcript[0].text,'Review finished');
});

test('child history falls back to paginated threads when full reads are rejected', async () => {
 const events=[];
 const session=new CodexSession({emit:e=>events.push(e)});
 session.state.threadId='parent';
 session.state.subagents=new Map([['child',{id:'child',title:'Review',status:'running',startedAt:1,updatedAt:1,transcript:[]}]]);
 session.rpc={request:async(method,params)=>{
  if(method==='thread/read' && params.includeTurns) throw Object.assign(new Error('paginated history'),{rpcError:true});
  if(method==='thread/read') return {thread:{id:'child',status:{type:'idle'}}};
  assert.equal(method,'thread/turns/list');
  assert.equal(params.itemsView,'full');
  assert.equal(params.sortDirection,'desc');
  return {data:[{id:'t',status:'completed',items:[{id:'m',type:'agentMessage',text:'Paged result'}]}],nextCursor:null};
 }};
 await session.refreshSubagents();
 assert.equal(events.filter(e=>e.type==='subagent-update').at(-1)?.agent.transcript[0].text,'Paged result');
});
