const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createAdvisorStore } = require("./advisor-store.cjs");
const { createAdvisorDelivery } = require("./advisor-delivery.cjs");
async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "advisor-delivery-"));
  const store = createAdvisorStore({ dataDir });
  const result = {
    id: "advisor:a:1",
    advisorId: "advisor:a",
    title: "Review",
    provider: "codex",
    outcome: "completed",
    output: "Choose A",
    delivery: "pending",
  };
  await store.update("chat", () => [{ id: "advisor:a", scopeIdentity: "scope", completions: [result] }]);
  const ctx = { scopeIdentity: "scope", provider: "claude" };
  const sent = [];
  let blocked = false;
  const delivery = createAdvisorDelivery({
    store,
    contextFor: async () => ctx,
    isBlocked: () => blocked,
    send: async (id, message, context) => {
      sent.push({ id, message, context });
      return { turnId: "accepted" };
    },
  });
  t.after(async () => {
    await delivery.close();
    await store.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return { delivery, result, sent, ctx, store, block: (value) => (blocked = value) };
}
test("completion delivers labeled app context once to the current owner after a handoff", async (t) => {
  const f = await fixture(t);
  f.block(true);
  await f.delivery.enqueue("chat", f.result);
  assert.equal(f.sent.length, 0);
  f.ctx.provider = "codex";
  f.block(false);
  await f.delivery.drain("chat");
  await f.delivery.enqueue("chat", f.result);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].context.provider, "codex");
  assert.equal(f.sent[0].message.context.kind, "advisor-result");
  assert.match(f.sent[0].message.prompt, /data|instructions/);
  assert.equal((await f.store.read("chat"))[0].completions[0].delivery, "delivered");
});
test("human waits and preparing handoffs defer delivery", async (t) => {
  const f = await fixture(t);
  f.block(true);
  await f.delivery.enqueue("chat", f.result);
  await f.delivery.drain("chat");
  assert.equal(f.sent.length, 0);
  f.block(false);
  await f.delivery.drain("chat");
  assert.equal(f.sent.length, 1);
});
test("parent Stop fences late completion, resume requires new user work", async (t) => {
  const f = await fixture(t);
  await f.delivery.stop("chat");
  await f.delivery.enqueue("chat", f.result);
  await f.delivery.drain("chat");
  assert.equal(f.sent.length, 0);
  await f.delivery.resume("chat");
  await f.delivery.drain("chat");
  assert.equal(f.sent.length, 0);
});
test("changed scope and uncertain deliveries stay inspectable without replay", async (t) => {
  const f = await fixture(t);
  f.ctx.scopeIdentity = "replaced";
  await f.delivery.enqueue("chat", f.result);
  assert.equal(f.sent.length, 0);
  f.ctx.scopeIdentity = "scope";
  await f.store.update("chat", (rows) => rows.map((r) => ({ ...r, completions: r.completions.map((c) => ({ ...c, delivery: "uncertain" })) })));
  await f.delivery.drain("chat");
  assert.equal(f.sent.length, 0);
});
test("failed durable sending boundary never calls the provider", async (t) => {
  let sent = 0;
  const delivery = createAdvisorDelivery({
    store: {
      read: async () => [{ id: "advisor:a", scopeIdentity: "scope", completions: [{ id: "x", delivery: "pending" }] }],
      update: async () => {
        throw Error("disk full");
      },
    },
    contextFor: async () => ({ scopeIdentity: "scope" }),
    isBlocked: () => false,
    send: async () => {
      sent++;
    },
  });
  await assert.rejects(delivery.drain("chat"), /disk full/);
  assert.equal(sent, 0);
  await delivery.close();
});
