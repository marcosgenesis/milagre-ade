const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { startDaemon } = require("./server.cjs");
const { peerPolicy } = require("./peer-policy.cjs");

async function waitFor(read) {
  for (let i = 0; i < 400; i++) {
    const value = await read();
    if (value) return value;
    await delay(10);
  }
  throw new Error("Timed out");
}

async function daemonFixture(t, options = {}) {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-connections-")));
  const daemon = await startDaemon({
    dataDir,
    version: "test",
    ...options,
    // No test may dial the real relay or bind the LAN port.
    phoneOptions: { localPort: 0, lanPort: null, startRelay: () => ({ close: async () => {}, status: () => "online" }) },
    runtimeOptions: {
      cwd: dataDir,
      environmentReady: Promise.resolve(),
      titleModels: {},
      agentCli: Object.assign(async () => ({ command: null }), { invalidate() {} }),
    },
  });
  t.after(async () => {
    await daemon.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return daemon;
}

/** A daemon client with no socket: every frame the daemon sends lands in `frames`, even after close. */
function virtualClient(daemon, options = {}) {
  const frames = [];
  const waiters = new Map();
  let ended = false;
  let nextId = 0;
  const connection = daemon.acceptConnection({
    send(message, json) {
      const frame = JSON.parse(json ?? JSON.stringify(message));
      frames.push(frame);
      if (frame.id != null) waiters.get(frame.id)?.(frame);
      return true;
    },
    end: () => {
      ended = true;
    },
    destroy: () => {
      ended = true;
    },
    isClosed: () => ended,
    ...options,
  });
  return {
    frames,
    events: () => frames.filter((frame) => frame.event).map((frame) => frame.event),
    call(method, args = []) {
      const id = ++nextId;
      const reply = new Promise((resolve) => waiters.set(id, resolve));
      connection.receive({ v: 1, id, method, args });
      return reply;
    },
    receive: (request) => connection.receive(request),
    close: () => connection.close(),
  };
}

test("the paired-desktop policy denies pairing, device management, push and stopping the daemon, and nothing else", () => {
  for (const method of ["phone:status", "phone:reset", "phone:open-pairing", "devices:list", "devices:remove", "push:register", "push:focus", "daemon:stop"])
    assert.equal(peerPolicy.denies(method), true, method);
  for (const method of [
    "daemon:status",
    "daemon:snapshot",
    "daemon:state-patches",
    "state:read",
    "project:open",
    "project:recent",
    "git:push",
    "chat:set-open",
  ])
    assert.equal(peerPolicy.denies(method), false, method);
});

test("a virtual connection without a policy runs any method and gets events until it closes", async (t) => {
  const daemon = await daemonFixture(t);
  const client = virtualClient(daemon);
  const status = (await client.call("daemon:status")).result;
  assert.ok(status.methods.includes("phone:set-enabled"));
  assert.equal((await client.call("phone:set-enabled", [true])).result.state, "starting");
  await waitFor(() => client.events().some((event) => event.channel === "phone:status" && event.payload.state === "on"));
  client.close();
  const before = client.frames.length;
  const other = virtualClient(daemon);
  await other.call("phone:set-enabled", [false]);
  await waitFor(() => other.events().some((event) => event.channel === "phone:status" && event.payload.state === "off"));
  assert.equal(client.frames.length, before, "a closed connection gets nothing more");
});

test("a policy refuses what it denies before it runs, and daemon:status leaves those methods out", async (t) => {
  const daemon = await daemonFixture(t);
  const peer = virtualClient(daemon, { policy: peerPolicy });
  for (const [method, args] of [
    ["phone:set-enabled", [true]],
    ["phone:reset", []],
    ["push:register", [{}]],
    ["daemon:stop", []],
  ]) {
    const reply = await peer.call(method, args);
    assert.deepEqual(reply.error, { code: "NOT_AVAILABLE_REMOTELY", message: "Not available on a remote computer" }, method);
  }
  const methods = (await peer.call("daemon:status")).result.methods;
  assert.equal(
    methods.some((method) => peerPolicy.denies(method)),
    false,
  );
  assert.ok(methods.includes("project:recent"));
  const local = virtualClient(daemon);
  assert.equal((await local.call("phone:status")).result.state, "off", "the denied phone:set-enabled never ran");
  assert.ok((await local.call("daemon:status")).result.methods.includes("phone:set-enabled"), "the socket's own view is unchanged");
});

test("a request that arrives after close is dropped, and the connection is not registered again", async (t) => {
  const daemon = await daemonFixture(t);
  const client = virtualClient(daemon);
  await client.call("daemon:status");
  client.close();
  const before = client.frames.length;
  client.receive({ v: 1, id: 99, method: "daemon:state-patches", args: [{ messages: true }] });
  client.receive({ v: 1, id: 100, method: "daemon:status", args: [] });
  await delay(50);
  const other = virtualClient(daemon);
  await other.call("phone:set-enabled", [true]);
  await waitFor(() => other.events().some((event) => event.channel === "phone:status" && event.payload.state === "on"));
  await other.call("phone:set-enabled", [false]);
  await waitFor(() => other.events().some((event) => event.channel === "phone:status" && event.payload.state === "off"));
  assert.equal(client.frames.length, before, "no reply, and no later broadcast reaches it");
});

test("a connection that must authenticate needs a daemon with an authentication token", async (t) => {
  const daemon = await daemonFixture(t, { requireAuthentication: false });
  const carrier = { send: () => true, end() {}, destroy() {}, isClosed: () => false };
  assert.throws(() => daemon.acceptConnection({ ...carrier, requireAuthentication: true }), /authentication token/);
});
