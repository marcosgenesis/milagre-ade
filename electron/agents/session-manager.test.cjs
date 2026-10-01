const assert = require("node:assert/strict");
const test = require("node:test");
const { SessionManager } = require("./session-manager.cjs");
const { waitUntil } = require("./test-helpers.cjs");

class FakeSession {
  constructor(provider, options) {
    Object.assign(this, { provider, options, turns: [], interrupts: 0, closed: false, running: false });
  }

  async startTurn(turn) {
    this.turns.push(turn);
    return { turnId: `t${this.turns.length}` };
  }

  emit(event) {
    this.options.emit(event);
  }

  async interrupt() {
    this.interrupts += 1;
  }

  respondToPermission(requestId, decision) {
    this.answers = [...(this.answers ?? []), { requestId, decision }];
    return true;
  }

  answerQuestion(requestId, answers) {
    this.replies = [...(this.replies ?? []), { requestId, answers }];
    return true;
  }

  async close() {
    this.closed = true;
    if (this.running) {
      this.running = false;
      this.emit({ type: "turn-cancelled" });
    }
  }
}

function harness({ idleMs = 60_000 } = {}) {
  const sent = [];
  const created = [];
  const manager = new SessionManager({
    send: (chatId, event) => sent.push({ chatId, event }),
    createSession: (provider, options) => {
      const session = new FakeSession(provider, options);
      created.push(session);
      return session;
    },
    idleMs,
    batchMs: 20,
  });
  return { manager, sent, created };
}
const request = (chatId, extra = {}) => ({ chatId, provider: "codex", model: "gpt-6-sol", cwd: "/repo", permissionMode: "auto", prompt: "hi", images: [], command: "/bin/codex", ...extra });

test("creates one session per chat and reuses it", async (t) => {
  const { manager, created } = harness();
  t.after(() => manager.closeAll());
  assert.deepEqual(await manager.startTurn(request("1", { resumeId: "thread-7" })), { turnId: "t1" });
  await manager.startTurn(request("1"));

  assert.equal(created.length, 1);
  assert.equal(created[0].turns.length, 2);
  assert.equal(created[0].options.cwd, "/repo");
  assert.equal(created[0].options.resumeId, "thread-7");
  assert.equal(created[0].options.command, "/bin/codex");
  assert.deepEqual(created[0].turns[0], { prompt: "hi", images: [], model: "gpt-6-sol", permissionMode: "auto", effort: undefined, ultracode: undefined });
});

test("keeps chats apart", async (t) => {
  const { manager, sent, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  await manager.startTurn(request("2", { provider: "claude" }));
  created[1].emit({ type: "turn-completed" });
  created[0].emit({ type: "turn-failed", message: "x" });

  assert.equal(created.length, 2);
  assert.deepEqual(sent, [
    { chatId: "2", event: { type: "turn-completed" } },
    { chatId: "1", event: { type: "turn-failed", message: "x" } },
  ]);
});

test("batches text and flushes it before the turn ends", async (t) => {
  const { manager, sent, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].emit({ type: "text-delta", messageId: "t1", text: "Hel" });
  created[0].emit({ type: "text-delta", messageId: "t1", text: "lo" });
  assert.deepEqual(sent, []);
  created[0].emit({ type: "turn-completed" });

  assert.deepEqual(sent, [
    { chatId: "1", event: { type: "text-delta", messageId: "t1", text: "Hello" } },
    { chatId: "1", event: { type: "turn-completed" } },
  ]);
});

test("sends batched text after the batch window", async (t) => {
  const { manager, sent, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].emit({ type: "text-delta", messageId: "t1", text: "Hi" });
  await waitUntil(() => sent.length === 1);
  assert.deepEqual(sent[0], { chatId: "1", event: { type: "text-delta", messageId: "t1", text: "Hi" } });
});

test("replaces a session after a provider switch or a crash", async (t) => {
  const { manager, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  await manager.startTurn(request("1", { provider: "claude" }));
  assert.equal(created[0].closed, true);
  assert.equal(created[1].provider, "claude");

  created[1].closed = true;
  await manager.startTurn(request("1", { provider: "claude", resumeId: "session-1" }));
  assert.equal(created.length, 3);
  assert.equal(created[2].options.resumeId, "session-1");
});

test("replaces a chat's session when its working directory changes", async (t) => {
  const { manager, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("2", { cwd: "/project-a" }));
  await manager.startTurn(request("2", { cwd: "/project-b" }));

  assert.equal(created.length, 2);
  assert.equal(created[0].closed, true);
  assert.equal(created[0].turns.length, 1);
  assert.equal(created[1].options.cwd, "/project-b");
  assert.equal(created[1].turns.length, 1);
});

test("closes idle sessions", async (t) => {
  const { manager, created } = harness({ idleMs: 30 });
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].emit({ type: "turn-completed" });
  await waitUntil(() => created[0].closed);
});

test("routes interrupts and closes everything on shutdown", async () => {
  const { manager, created } = harness();
  await manager.startTurn(request("1"));
  await manager.startTurn(request("2"));
  await manager.interrupt("2");
  await manager.interrupt("missing");
  assert.equal(created[1].interrupts, 1);

  await manager.closeAll();
  assert.ok(created.every((session) => session.closed));
});

test("drops events from a session that was replaced", async (t) => {
  const { manager, sent, created } = harness({ idleMs: 30 });
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  await manager.startTurn(request("1", { provider: "claude" }));
  created[0].emit({ type: "text-delta", messageId: "old", text: "late" });
  created[0].emit({ type: "turn-completed" });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(sent, []);
  assert.equal(created[1].closed, false);
});

test("closing a chat delivers its final event and pending text, then goes quiet", async (t) => {
  const { manager, sent, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].running = true;
  created[0].emit({ type: "text-delta", messageId: "t1", text: "Hi" });
  await manager.closeChat("1");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(sent, [
    { chatId: "1", event: { type: "text-delta", messageId: "t1", text: "Hi" } },
    { chatId: "1", event: { type: "turn-cancelled" } },
  ]);
});

test("concurrent turns during a replacement share one new session", async (t) => {
  const { manager, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].closed = true;
  await Promise.all([manager.startTurn(request("1")), manager.startTurn(request("1"))]);
  assert.equal(created.length, 2);
  assert.equal(created[1].turns.length, 2);
});

test("an idle close never reaches the session that replaced it", async (t) => {
  const { manager, created } = harness({ idleMs: 30 });
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].running = true;
  await manager.startTurn(request("1", { provider: "claude" }));
  await manager.startTurn(request("1", { provider: "claude" }));
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(created[0].closed, true);
  assert.equal(created[1].closed, false);
});

test("a turn the provider starts itself is not closed by the idle timer", async (t) => {
  const { manager, created } = harness({ idleMs: 30 });
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].emit({ type: "turn-completed" });
  created[0].emit({ type: "turn-started", turnId: "t2" });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(created[0].closed, false);
  created[0].emit({ type: "turn-completed" });
  await waitUntil(() => created[0].closed);
});

test("routes approval answers to the chat's session and refuses unknown decisions", async (t) => {
  const { manager, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  assert.equal(manager.respondToPermission("1", "req-1", "allow-for-chat"), true);
  assert.deepEqual(created[0].answers, [{ requestId: "req-1", decision: "allow-for-chat" }]);
  assert.equal(manager.respondToPermission("9", "req-1", "allow"), false);
  assert.throws(() => manager.respondToPermission("1", "req-1", "cancelled"), /Unknown permission decision: cancelled/);
  assert.throws(() => manager.respondToPermission("1", "req-1", "yes"), /Unknown permission decision: yes/);
});

test("interruptAll stops every chat's turn", async (t) => {
  const { manager, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  await manager.startTurn(request("2"));
  await manager.interruptAll();
  assert.deepEqual(created.map((session) => session.interrupts), [1, 1]);
});

test("an approval request is sent right after the text before it", async (t) => {
  const { manager, sent, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].emit({ type: "text-delta", messageId: "t1", text: "Let me check" });
  created[0].emit({ type: "permission-request", requestId: "r1", kind: "command", tool: "Shell", title: "Run this command?", command: "ls", allowForChat: true });
  assert.deepEqual(sent.map((item) => item.event.type), ["text-delta", "permission-request"]);
});

test("a message a closed session hands back is retried once on a fresh session", async (t) => {
  const { manager, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].startTurn = async function () {
    this.closed = true;
    throw Object.assign(new Error("closed"), { sessionClosed: true });
  };
  assert.deepEqual(await manager.startTurn(request("1", { prompt: "again" })), { turnId: "t1" });
  assert.equal(created.length, 2);
  assert.equal(created[1].turns[0].prompt, "again");
});

test("a second sessionClosed failure propagates instead of retrying forever", async (t) => {
  const { manager, created } = harness();
  t.after(() => manager.closeAll());
  const closing = async function () {
    this.closed = true;
    throw Object.assign(new Error("closed"), { sessionClosed: true });
  };
  await manager.startTurn(request("1"));
  created[0].startTurn = closing;
  const original = manager.createSession;
  manager.createSession = (provider, options) => {
    const session = original(provider, options);
    session.startTurn = closing;
    return session;
  };
  await assert.rejects(manager.startTurn(request("1")), (error) => error.sessionClosed === true);
  assert.equal(created.length, 2);
});

test("routes question answers to the chat's session and refuses malformed ones", async (t) => {
  const { manager, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  assert.equal(manager.answerQuestion("1", "q-1", { color: ["Green", "a darker one"] }), true);
  assert.equal(manager.answerQuestion("1", "q-2", null), true);
  assert.deepEqual(created[0].replies, [{ requestId: "q-1", answers: { color: ["Green", "a darker one"] } }, { requestId: "q-2", answers: null }]);
  assert.equal(manager.answerQuestion("9", "q-1", null), false);
  for (const bad of [undefined, "Green", ["Green"], { color: "Green" }, { color: [7] }, { color: ["x".repeat(10_001)] }]) {
    assert.throws(() => manager.answerQuestion("1", "q-1", bad), /Invalid answers to an agent question/);
  }
  assert.equal(created[0].replies.length, 2);
});

test("a question is sent right after the text before it", async (t) => {
  const { manager, sent, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].emit({ type: "text-delta", messageId: "t1", text: "One thing first" });
  created[0].emit({ type: "question-request", requestId: "q-1", questions: [] });
  created[0].emit({ type: "question-resolved", requestId: "q-1", outcome: "dismissed" });
  assert.deepEqual(sent.map((item) => item.event.type), ["text-delta", "question-request", "question-resolved"]);
});
