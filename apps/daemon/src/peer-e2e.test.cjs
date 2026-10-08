const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { b64url } = require("@milagre/shared/relay-crypto");
const { startDaemon } = require("./server.cjs");
const { connect } = require("./client.cjs");
const { readIdentity } = require("./relay-identity.cjs");
const { startLocalRelay, connectDesktop, connectPhone, until } = require("./relay-test-kit.cjs");

/**
 * A throwaway Mac: its own data folder, a local relay in place of relay.milagre.cloud, the LAN on a port the OS picks
 * on 127.0.0.1, and a clock the test moves (pairing windows). Never Victor's data folder, 8797 or 8798.
 */
async function macWithRelay(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "peer-e2e-")));
  const dataDir = path.join(directory, "profile");
  const project = path.join(directory, "project");
  await fs.mkdir(project);
  execFileSync("git", ["init", "-b", "main", project], { stdio: "ignore" });
  const clock = { now: 1_000_000 };
  const sockets = [];
  let daemon;
  let client;
  // Registered before the relay's own hook, so the daemon closes while the relay still answers; the folder goes last.
  t.after(async () => {
    for (const socket of sockets) socket.close();
    client?.close();
    try {
      await daemon?.close();
    } finally {
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
  const relay = await startLocalRelay(t);
  daemon = await startDaemon({
    dataDir,
    version: "9.8.7",
    runtimeOptions: { cwd: project, environmentReady: Promise.resolve(), titleModels: {}, readPullRequests: async (_worktree, refs) => refs },
    phoneOptions: { relayUrl: relay.url, localPort: 0, lanPort: 0, lanHostname: "127.0.0.1", addresses: () => ["127.0.0.1"], now: () => clock.now },
  });
  client = await connect({ dataDir });
  // Turning phone access on opens the pairing window, as showing the QR in Settings › Devices does.
  await client.call("phone:set-enabled", [true]);
  await until(async () => {
    const status = await client.call("phone:status");
    return status.state === "on" && status.relay === "online";
  }, "phone access on and the relay online");
  const identity = await readIdentity(dataDir);
  const token = JSON.parse(await fs.readFile(path.join(dataDir, "mobile.json"), "utf8")).token;
  /** Dials this Mac with `connectTo` (connectDesktop or connectPhone), through the relay unless `relayUrl` says otherwise. */
  const dial = (connectTo, options = {}) => {
    const socket = connectTo({ relayUrl: relay.url, identity, token, ...options });
    sockets.push(socket);
    return socket;
  };
  return { clock, client, project, identity, token, dial };
}

test("a desktop pairs through the relay in the pairing window and drives this Mac's daemon, except pairing and devices", async (t) => {
  const mac = await macWithRelay(t);
  const desktop = mac.dial(connectDesktop, { name: "studio" });
  assert.ok((await desktop.hello()).channel);
  const key = b64url(desktop.key.publicKey);
  // Settings › Devices lists it under Computers.
  assert.deepEqual(
    (await mac.client.call("devices:list")).map((device) => [device.key, device.kind, device.name, device.route]),
    [[key, "computer", "studio", "relay"]],
  );

  const status = (await desktop.call("daemon:status")).result;
  assert.equal(status.version, "9.8.7");
  assert.ok(status.capabilities.includes("desktop-peer-v1"));
  assert.ok(status.methods.includes("project:recent"));
  assert.ok(status.methods.includes("peer:routes"));
  for (const denied of ["devices:list", "devices:remove", "phone:status", "phone:open-pairing", "push:register", "daemon:stop"])
    assert.equal(status.methods.includes(denied), false, denied);
  assert.deepEqual((await desktop.call("devices:remove", [key])).error, { code: "NOT_AVAILABLE_REMOTELY", message: "Not available on a remote computer" });
  assert.equal((await mac.client.call("devices:list")).length, 1, "the refused call removed nothing");

  // A change made in this Mac's window reaches the desktop as an event.
  const opened = await mac.client.call("project:open", [mac.project]);
  const chatId = Object.values(opened.state.sessions)[0].id;
  await mac.client.call("chat:patch", [mac.project, chatId, { title: "Set on this Mac" }]);
  await desktop.event("project:state", (payload) => payload.path === mac.project && payload.state?.sessions?.[chatId]?.title === "Set on this Mac");

  // A request and its reply over 768 KiB travel in parts through the relay, and piece boundaries cut characters.
  const big = "ação🙂".repeat(150_000);
  const before = desktop.messages.filter((message) => message.t === "part").length;
  assert.deepEqual((await desktop.call("worktree:pull-requests", [mac.project, [big]])).result, [big]);
  assert.ok(desktop.messages.filter((message) => message.t === "part").length - before >= 3, "the reply came in parts");

  // Phone status changes broadcast phone:status, with the link and its token: none of it reaches the desktop, while an
  // allowed event sent after them does (events arrive in order, so the earlier ones had their chance).
  await mac.client.call("phone:open-pairing");
  await mac.client.call("phone:set-lan", [false]);
  await mac.client.call("phone:set-lan", [true]);
  await mac.client.call("phone:open-pairing");
  await mac.client.call("chat:patch", [mac.project, chatId, { title: "Set after the phone changes" }]);
  await desktop.event("project:state", (payload) => payload.state?.sessions?.[chatId]?.title === "Set after the phone changes");
  await desktop.call("daemon:status");
  assert.deepEqual(
    desktop.frames.filter((frame) => frame.event?.channel?.startsWith("phone:")),
    [],
  );
  assert.equal(desktop.error, null);
});

test("a paired desktop finds the LAN route over the relay and makes a round trip on it", async (t) => {
  const mac = await macWithRelay(t);
  const desktop = mac.dial(connectDesktop);
  assert.ok((await desktop.hello()).channel);
  const reply = await desktop.call("peer:routes");
  const routes = reply.result;
  assert.deepEqual(Object.keys(routes).toSorted(), ["hostId", "key", "lan"]);
  assert.ok(Array.isArray(routes.lan) && routes.lan.every((url) => typeof url === "string" && url.startsWith("ws://")));
  // Field names, not substrings: the key is random base64 and may spell "qr" by chance.
  const names = [];
  JSON.stringify(reply, (name, value) => (names.push(name), value));
  for (const secret of ["token", "link", "qr"])
    assert.equal(
      names.some((name) => name.toLowerCase().includes(secret)),
      false,
      secret,
    );
  const text = JSON.stringify(reply);
  assert.equal(text.includes(mac.token), false, "the pairing token");
  assert.equal(routes.hostId, mac.identity.hostId);
  assert.equal(routes.key, b64url(mac.identity.box.publicKey));
  assert.equal(routes.lan.length, 1);
  assert.match(routes.lan[0], /^ws:\/\/127\.0\.0\.1:\d+$/);
  const lan = mac.dial(connectDesktop, { relayUrl: routes.lan[0], key: desktop.key });
  assert.ok((await lan.hello()).channel);
  assert.equal((await lan.call("daemon:status")).result.version, "9.8.7");
  await until(async () => (await mac.client.call("devices:list"))[0]?.route === "lan", "the device shows on the LAN");
});

test("removing a desktop closes it on the relay and the LAN, and it pairs again only in a window opened later", async (t) => {
  const mac = await macWithRelay(t);
  const desktop = mac.dial(connectDesktop, { name: "studio" });
  assert.ok((await desktop.hello()).channel);
  const lanUrl = (await desktop.call("peer:routes")).result.lan[0];
  const lan = mac.dial(connectDesktop, { relayUrl: lanUrl, key: desktop.key });
  assert.ok((await lan.hello()).channel);
  const key = b64url(desktop.key.publicKey);

  await mac.client.call("devices:remove", [key]);
  assert.equal((await desktop.closed).code, 1000);
  assert.equal((await lan.closed).code, 1000);
  assert.deepEqual(await mac.client.call("devices:list"), []);
  // The window it was removed in is still open; its redial is refused on both routes.
  assert.deepEqual((await mac.dial(connectDesktop, { key: desktop.key }).hello()).error, { t: "error", code: "unknown-phone" });
  assert.deepEqual((await mac.dial(connectDesktop, { relayUrl: lanUrl, key: desktop.key }).hello()).error, { t: "error", code: "unknown-phone" });

  mac.clock.now += 1000;
  await mac.client.call("phone:open-pairing");
  const again = mac.dial(connectDesktop, { key: desktop.key, name: "studio" });
  assert.ok((await again.hello()).channel);
  assert.deepEqual(
    (await mac.client.call("devices:list")).map((device) => [device.key, device.kind]),
    [[key, "computer"]],
  );
});

test("a phone removed while the pairing window is open stays out until a later window, with the real relay host", async (t) => {
  const mac = await macWithRelay(t);
  const phone = mac.dial(connectPhone, { name: "Victor's iPhone" });
  assert.ok((await phone.hello()).channel);
  const key = b64url(phone.key.publicKey);
  assert.deepEqual(
    (await mac.client.call("devices:list")).map((device) => [device.key, device.kind, device.name]),
    [[key, "phone", "Victor's iPhone"]],
  );
  await mac.client.call("devices:remove", [key]);
  assert.equal((await phone.closed).code, 1000);
  // Settings › Devices still shows the QR, so the window is open: the phone redials at once and is refused.
  assert.deepEqual((await mac.dial(connectPhone, { key: phone.key }).hello()).error, { t: "error", code: "unknown-phone" });
  mac.clock.now += 1000;
  await mac.client.call("phone:open-pairing");
  assert.ok((await mac.dial(connectPhone, { key: phone.key, name: "Victor's iPhone" }).hello()).channel);
  assert.equal((await mac.client.call("devices:list")).length, 1);
});
