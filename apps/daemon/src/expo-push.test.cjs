const test = require("node:test");
const assert = require("node:assert/strict");
const { createExpoPush } = require("./expo-push.cjs");
const notice = { to: "ExpoPushToken[one]", title: "Needs approval", body: "Run: ls", data: { kind: "milagre-chat" } };
const response = (data, status = 200) => new Response(JSON.stringify({ data }), { status });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("sends only to Expo, retries transient failures and checks receipts", async (t) => {
  const calls = [],
    invalid = [];
  let attempts = 0;
  const sender = createExpoPush({
    retryDelaysMs: [1],
    receiptDelayMs: 1,
    onInvalid: (token) => invalid.push(token),
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/send")) return ++attempts === 1 ? response({}, 503) : response({ status: "ok", id: "ticket-1" });
      return response({ "ticket-1": { status: "error", details: { error: "DeviceNotRegistered" } } });
    },
  });
  t.after(() => sender.close());
  await sender.send(notice);
  for (let i = 0; i < 100 && !invalid.length; i++) await delay(2);
  assert.deepEqual(invalid, [notice.to]);
  assert.equal(attempts, 2);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.url.startsWith("https://exp.host/--/api/v2/push/")));
  assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].options.body), notice);
});

test("invalid tickets remove tokens immediately and credentials failures never retry", async (t) => {
  const invalid = [],
    errors = [];
  let calls = 0;
  const sender = createExpoPush({
    retryDelaysMs: [1, 1],
    onInvalid: (token) => invalid.push(token),
    onError: (error) => errors.push(error.message),
    fetcher: async () => {
      calls++;
      return response({ status: "error", details: { error: calls === 1 ? "DeviceNotRegistered" : "InvalidCredentials" } });
    },
  });
  t.after(() => sender.close());
  await sender.send(notice);
  await sender.send(notice);
  assert.deepEqual(invalid, [notice.to]);
  assert.equal(calls, 2);
  assert.equal(errors.length, 1);
  assert.ok(!errors.join().includes(notice.to));
});

test("a full queue rejects additional work and stale queued notices never send", async (t) => {
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  const sender = createExpoPush({
    maxQueued: 1,
    fetcher: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      await ready;
      return response({ status: "ok", id: "ticket" });
    },
  });
  t.after(() => sender.close());
  const first = sender.send(notice);
  const stale = sender.send({ ...notice, title: "Stale" }, () => false);
  await assert.rejects(sender.send(notice), /queue/);
  release();
  await Promise.all([first, stale]);
  assert.equal(calls.length, 1);
});

test("timeouts bound delivery and closing aborts an active request without retries", async () => {
  let calls = 0;
  const fetcher = (_url, options) =>
    new Promise((_resolve, reject) => {
      calls++;
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  const sender = createExpoPush({ timeoutMs: 5, retryDelaysMs: [], fetcher });
  await sender.send(notice);
  assert.equal(calls, 1);
  await sender.close();
  const closing = createExpoPush({ timeoutMs: 10000, retryDelaysMs: [1], fetcher });
  const sending = closing.send(notice);
  await closing.close();
  await sending;
  assert.equal(calls, 2);
});

test("focus becoming current during retry drops the queued alert", async (t) => {
  let current = true;
  let calls = 0;
  const sender = createExpoPush({
    retryDelaysMs: [1],
    fetcher: async () => {
      calls++;
      current = false;
      return response({}, 429);
    },
  });
  t.after(() => sender.close());
  await sender.send(notice, () => current);
  assert.equal(calls, 1);
});
