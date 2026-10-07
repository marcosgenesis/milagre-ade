const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { b64url, boxKeyPair } = require("@milagre/shared/relay-crypto");
const { readIdentity, createPhones } = require("./relay-identity.cjs");
const { startLanHost } = require("./lan-host.cjs");
const { random, startFakeBridge, connectPhone, until } = require("./relay-test-kit.cjs");

async function lanMac(t, { knownPhone = true, ...hostOptions } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lan-host-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const identity = await readIdentity(dir);
  const phones = createPhones(dir);
  await phones.load();
  const key = boxKeyPair(random);
  if (knownPhone) await phones.add(b64url(key.publicKey));
  const bridge = await startFakeBridge(t);
  const host = await startLanHost({ port: 0, hostname: "127.0.0.1", identity, phones, token: "a".repeat(64), bridgeUrl: bridge.url, ...hostOptions });
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

/** Writes raw bytes to the listener and waits for it to answer or hang up. */
function rawRequest(port, text) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(text));
    let answer = "";
    socket.on("data", (chunk) => {
      answer += chunk;
      socket.destroy();
    });
    socket.on("error", () => {});
    socket.on("close", () => resolve(answer));
    setTimeout(() => socket.destroy(), 1000).unref();
  });
}

const helloStatus = async (port) => (await fetch(`http://127.0.0.1:${port}/v1/hello`)).status;

test("a request line that is not a URL gets a 404 and cannot crash the daemon", async (t) => {
  const { host } = await lanMac(t);
  assert.match(await rawRequest(host.port, "GET http://[ HTTP/1.1\r\nHost: lan\r\n\r\n"), /^HTTP\/1\.1 404/);
  assert.equal(await helloStatus(host.port), 200);
});

test("an upgrade whose request line is not a URL is refused and cannot crash the daemon", async (t) => {
  const { host } = await lanMac(t);
  const upgrade =
    "GET http://[ HTTP/1.1\r\nHost: lan\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n";
  assert.match(await rawRequest(host.port, upgrade), /^HTTP\/1\.1 404/);
  assert.equal(await helloStatus(host.port), 200);
});

test("a phone socket that stops answering pings is terminated; one that answers stays", async (t) => {
  const { identity, url } = await lanMac(t, { pingMs: 50 });
  const { WebSocket } = require("ws");
  const silent = new WebSocket(`${url}/v1/phone?id=${identity.hostId}`, { autoPong: false });
  const live = new WebSocket(`${url}/v1/phone?id=${identity.hostId}`);
  t.after(() => {
    silent.terminate();
    live.terminate();
  });
  const silentClosed = new Promise((resolve) => silent.on("close", () => resolve(true)));
  let liveClosed = false;
  live.on("close", () => (liveClosed = true));
  assert.equal(await Promise.race([silentClosed, new Promise((resolve) => setTimeout(() => resolve(false), 3000))]), true);
  assert.equal(liveClosed, false);
});

test("a fifth socket from one address is refused while four are open", async (t) => {
  const { identity, url } = await lanMac(t);
  const { WebSocket } = require("ws");
  const open = [];
  t.after(() => open.forEach((ws) => ws.terminate()));
  const dial = () =>
    new Promise((resolve) => {
      const ws = new WebSocket(`${url}/v1/phone?id=${identity.hostId}`);
      ws.on("open", () => {
        open.push(ws);
        resolve("open");
      });
      ws.on("error", () => resolve("refused"));
    });
  for (let index = 0; index < 4; index++) assert.equal(await dial(), "open");
  assert.equal(await dial(), "refused");
  // Closing one makes room again.
  open.pop().close();
  await until(async () => (await dial()) === "open", "a free slot after a close");
});

test("closing the host with a request in flight resolves and leaves nothing running", async (t) => {
  const { identity, key, bridge, host, url } = await lanMac(t);
  const phone = connectPhone({ relayUrl: url, identity, key });
  t.after(() => phone.close());
  assert.ok((await phone.hello()).channel);
  phone.request(1, { path: "/slow" });
  await until(() => bridge.waiting() === 1, "a request in flight");
  await host.close();
  bridge.release();
});
