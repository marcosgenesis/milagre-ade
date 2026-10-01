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
