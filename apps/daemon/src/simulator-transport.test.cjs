const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { startDaemon } = require("./server.cjs");
const { connect } = require("./client.cjs");
const { execFileSync } = require("node:child_process");
const { startMobileBridge } = require("./mobile-bridge.cjs");

async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "milagre-simulator-rpc-"));
  const opens = [],
    disconnected = [];
  const simulators = {
    async list() {
      return { devices: [{ id: "test-device", name: "Test iPhone", platform: "ios", version: "iOS 27" }], supported: true };
    },
    async open(request, owner) {
      opens.push({ request, owner });
      return { viewerId: "private-viewer" };
    },
    async closeViewer() {
      return null;
    },
    async disconnect(owner) {
      disconnected.push(owner);
    },
    async close() {},
  };
  const daemon = await startDaemon({ dataDir, version: "test", runtimeOptions: { environmentReady: Promise.resolve(), simulators } });
  const clients = [],
    bridges = [];
  t.after(async () => {
    for (const bridge of bridges) await bridge.close();
    for (const client of clients) client.close();
    await daemon.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const project = path.join(dataDir, "project");
  await fs.mkdir(project);
  execFileSync("git", ["init", "-q", project]);
  const setup = await connect({ dataDir });
  clients.push(setup);
  const openedProject = await setup.call("project:open", [project]);
  const chatId = `${openedProject.path}#${Object.values(openedProject.state.sessions)[0].id}`;
  return {
    dataDir,
    opens,
    disconnected,
    chatId,
    async client() {
      const client = await connect({ dataDir });
      clients.push(client);
      return client;
    },
    async bridge(confined = false) {
      const bridge = await startMobileBridge({ dataDir, port: 0, token: "a".repeat(64), ...(confined ? { allowedRoot: dataDir } : {}) });
      bridges.push(bridge);
      return (method, args = [], authorized = true) =>
        fetch(bridge.url + "/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(authorized ? { Authorization: "Bearer " + "a".repeat(64) } : {}) },
          body: JSON.stringify({ v: 1, method, args }),
        });
    },
  };
}

test("simulator commands receive distinct server identities and disconnect releases their viewers", async (t) => {
  const f = await fixture(t);
  const a = await f.client(),
    b = await f.client();
  assert.equal((await a.call("simulator:list", [{ chatId: f.chatId }])).devices.length, 0);
  await a.call("simulator:attach", [{ chatId: f.chatId, deviceId: "test-device" }]);
  await a.call("simulator:open", [{ chatId: f.chatId, deviceId: "test-device", owner: "forged" }]);
  await b.call("simulator:open", [{ chatId: f.chatId, deviceId: "test-device" }]);
  assert.equal(typeof f.opens[0].owner, "string");
  assert.ok(f.opens[0].owner.length >= 16);
  assert.notEqual(f.opens[0].owner, "forged");
  assert.notEqual(f.opens[0].owner, f.opens[1].owner);
  a.close();
  for (let i = 0; i < 100 && !f.disconnected.includes(f.opens[0].owner); i++) await delay(10);
  assert.ok(f.disconnected.includes(f.opens[0].owner));
});

test("paired mobile reaches the same simulator service; unauthenticated and confined clients are refused", async (t) => {
  const f = await fixture(t);
  const paired = await f.bridge();
  const listed = await paired("simulator:list", [{ chatId: f.chatId }]);
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).result.available[0].name, "Test iPhone");
  assert.equal((await paired("simulator:attach", [{ chatId: f.chatId, deviceId: "test-device" }])).status, 200);
  assert.equal((await paired("simulator:open", [{ chatId: f.chatId, deviceId: "test-device" }])).status, 200);
  assert.equal(typeof f.opens[0].owner, "string");
  assert.equal((await paired("simulator:list", [], false)).status, 401);
  const confined = await f.bridge(true);
  for (const method of ["list", "attach", "detach", "open", "offer", "status", "control", "input", "close"]) {
    assert.equal((await confined(`simulator:${method}`, [{ viewerId: "private-viewer" }])).status, 403, method);
  }
});
