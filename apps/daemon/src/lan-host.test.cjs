const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { b64url, boxKeyPair } = require("@milagre/shared/relay-crypto");
const { readIdentity, createPhones } = require("./relay-identity.cjs");
const { startLanHost } = require("./lan-host.cjs");
const { random, startFakeBridge, connectPhone, until } = require("./relay-test-kit.cjs");

async function lanMac(t, { knownPhone = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lan-host-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const identity = await readIdentity(dir);
  const phones = createPhones(dir);
  await phones.load();
  const key = boxKeyPair(random);
  if (knownPhone) await phones.add(b64url(key.publicKey));
  const bridge = await startFakeBridge(t);
  const host = await startLanHost({ port: 0, hostname: "127.0.0.1", identity, phones, token: "a".repeat(64), bridgeUrl: bridge.url });
  t.after(() => host.close());
  return { identity, key, bridge, host, url: `ws://127.0.0.1:${host.port}` };
}

test("/v1/hello names this Mac and nothing else", async (t) => {
  const { identity, host } = await lanMac(t);
  const response = await fetch(`http://127.0.0.1:${host.port}/v1/hello`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { v: 1, hostId: identity.hostId });
  assert.equal((await fetch(`http://127.0.0.1:${host.port}/rpc`)).status, 404);
});

test("a known phone calls /rpc over the LAN socket", async (t) => {
  const { identity, key, bridge, url } = await lanMac(t);
  const phone = connectPhone({ relayUrl: url, identity, key });
  t.after(() => phone.close());
  const result = await phone.hello();
  assert.ok(result.channel, JSON.stringify(result));
  phone.request(1, { method: "POST", path: "/rpc", headers: { "content-type": "application/json" }, body: '{"v":1,"method":"daemon:status","args":[]}' });
  const response = await phone.response(1);
  assert.equal(response.status, 200);
  assert.equal(new TextDecoder().decode(response.body), '{"v":1,"result":"pong"}');
  assert.equal(bridge.seen.requests.at(-1).authorization, `Bearer ${"a".repeat(64)}`);
});

test("an unknown phone is refused: the LAN never opens pairing", async (t) => {
  const { identity, url } = await lanMac(t, { knownPhone: false });
  const phone = connectPhone({ relayUrl: url, identity });
  t.after(() => phone.close());
  assert.deepEqual((await phone.hello()).error, { t: "error", code: "unknown-phone" });
});

test("a phone pinning another Mac's key cannot finish the hello", async (t) => {
  const { identity, key, url } = await lanMac(t);
  const other = { ...identity, box: boxKeyPair(random) };
  const phone = connectPhone({ relayUrl: url, identity: other, key });
  t.after(() => phone.close());
  // The hello is sealed to a key this Mac does not hold: it can't open it and refuses.
  assert.deepEqual((await phone.hello()).error, { t: "error", code: "bad-hello" });
});

test("a wrong host id gets no socket", async (t) => {
  const { url } = await lanMac(t);
  const { WebSocket } = require("ws");
  const ws = new WebSocket(`${url}/v1/phone?id=${"A".repeat(22)}`);
  const outcome = await new Promise((resolve) => {
    ws.on("open", () => resolve("open"));
    ws.on("error", () => resolve("refused"));
  });
  assert.equal(outcome, "refused");
});

test("closing the host closes its phones", async (t) => {
  const { identity, key, host, url } = await lanMac(t);
  const phone = connectPhone({ relayUrl: url, identity, key });
  assert.ok((await phone.hello()).channel);
  await host.close();
  await until(async () => (await Promise.race([phone.closed, new Promise((r) => setTimeout(() => r(null), 50))])) !== null, "phone closed");
});
