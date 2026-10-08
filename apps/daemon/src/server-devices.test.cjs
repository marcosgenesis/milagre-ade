const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { startDaemon } = require("./server.cjs");
const { connect } = require("./client.cjs");

async function waitFor(read) {
  for (let i = 0; i < 400; i++) {
    const value = await read();
    if (value) return value;
    await delay(10);
  }
  throw new Error("Timed out");
}

test("devices:list and devices:remove are desktop methods over the saved devices, and never reach the phone's bridge", async (t) => {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-devices-")));
  const relays = [];
  const daemon = await startDaemon({
    dataDir,
    version: "test",
    phoneOptions: {
      localPort: 0,
      lanPort: null,
      startRelay: (options) => {
        relays.push(options);
        return { close: async () => {}, status: () => "online" };
      },
    },
    runtimeOptions: {
      cwd: dataDir,
      environmentReady: Promise.resolve(),
      titleModels: {},
      agentCli: Object.assign(async () => ({ command: null }), { invalidate() {} }),
    },
  });
  const desktop = await connect({ dataDir });
  t.after(async () => {
    desktop.close();
    await daemon.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const methods = (await desktop.call("daemon:status")).methods;
  for (const method of ["devices:list", "devices:remove"]) assert.ok(methods.includes(method), method);
  assert.deepEqual(await desktop.call("devices:list"), []);

  await desktop.call("phone:set-enabled", [true]);
  const on = await waitFor(async () => {
    const status = await desktop.call("phone:status");
    return status.state === "on" && status;
  });
  const key = "k".repeat(43);
  await relays[0].phones.add(key, { kind: "phone", name: "Victor's iPhone" });
  const [device] = await desktop.call("devices:list");
  assert.deepEqual(
    { ...device, pairedAt: typeof device.pairedAt, lastSeen: typeof device.lastSeen },
    { key, kind: "phone", name: "Victor's iPhone", pairedAt: "number", lastSeen: "number", route: null },
  );

  // The phone's own bridge never manages devices, its own or another's.
  const token = new URL(on.pairingLink).searchParams.get("token");
  for (const [method, args] of [
    ["devices:list", []],
    ["devices:remove", [key]],
  ]) {
    const response = await fetch(on.localUrl + "/rpc", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ v: 1, method, args }),
    });
    assert.equal(response.status, 403, method);
  }
  assert.equal((await desktop.call("devices:list")).length, 1);

  assert.deepEqual(await desktop.call("devices:remove", [key]), []);
  assert.deepEqual(await desktop.call("devices:list"), []);
  await assert.rejects(desktop.call("devices:remove", ["nope"]), /device key/);
});
