const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { startTestMac, until } = require("../../daemon/src/relay-test-kit.cjs");
const { createComputers } = require("./computers.cjs");

const keychain = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(text, "utf8").map((byte) => byte ^ 0x5a),
  decryptString: (bytes) =>
    Buffer.from(bytes)
      .map((byte) => byte ^ 0x5a)
      .toString("utf8"),
};

/**
 * This Mac's side: computers.cjs in a folder of its own (never Victor's userData), turned on, dialing with Node's
 * WebSocket. Every test calls it before startTestMac: node:test runs t.after in the order registered, so this Mac stops
 * dialing first, then the daemon closes, then its relay and its folder.
 */
async function desk(t, options = {}) {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "computers-e2e-")));
  const sockets = [];
  const events = [];
  const computers = createComputers({
    dataDir,
    safeStorage: keychain,
    name: () => "desk",
    allowLocalRelay: true,
    reconnectMs: 50,
    networkMs: 60_000,
    createSocket: (url) => {
      sockets.push(url);
      return new WebSocket(url);
    },
    emit: (id, channel, payload) => events.push({ id, channel, payload }),
    ...options,
  });
  t.after(async () => {
    await computers.close();
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await computers.setEnabled(true);
  return { computers, sockets, events, dataDir };
}
const linkOf = async (mac) => (await mac.client.call("phone:status")).pairingLink;
/** Every request list this Mac's window heard (devices:pending), newest last. */
function pendingHeard(mac) {
  const heard = [];
  mac.client.on("event", ({ channel, payload }) => {
    if (channel === "devices:pending") heard.push(payload.requests);
  });
  return heard;
}
const first = (computers) => computers.list()[0];
/** A promise that must settle soon: a pairing that never answers fails the test instead of hanging it. */
const within = (promise, label, ms = 10_000) =>
  Promise.race([promise, delay(ms, undefined, { ref: false }).then(() => Promise.reject(new Error(`Timed out waiting for ${label}`)))]);
const DISCONNECTED = "Milagre host is disconnected. Your command was not sent.";
/**
 * daemon:status through the computer. Right after it comes online, peer:routes moves its runtime to the LAN, and a call
 * that lands in that few-millisecond switch is refused with DISCONNECTED (the view still reads online / lan while the
 * runtime reconnects). Only that refusal is retried; any other error fails the test.
 */
const statusOf = (computers, id) =>
  until(
    () =>
      computers.invoke(id, "daemon:status").catch((error) => {
        if (error.message !== DISCONNECTED) throw error;
        return null;
      }),
    "daemon:status to answer",
  );

test("a new computer waits for Allow, then drives the Mac over the relay and moves to its LAN", async (t) => {
  const { computers, events, dataDir } = await desk(t);
  const mac = await startTestMac(t, { autoAllow: false });
  const heard = pendingHeard(mac);
  const link = await linkOf(mac);
  assert.deepEqual(Object.keys(await computers.preview(link)).toSorted(), ["hostId", "name", "relayHost"]);
  let told = 0;
  const adding = computers.add(link, { name: "studio" }, { onPending: () => told++ });
  const [request] = await until(() => heard.at(-1)?.length && heard.at(-1), "the Mac's window to hear the request");
  assert.equal(request.name, "desk");
  await until(() => told === 1, "this Mac to hear it waits");
  assert.deepEqual(await mac.client.call("devices:list"), [], "nothing saved before Allow");
  await within(mac.client.call("devices:allow", [request.key]), "devices:allow");
  const added = await within(adding, "the computer to be added");
  assert.equal(added.name, "studio");
  await until(() => first(computers)?.state === "online", "online");
  assert.equal((await statusOf(computers, added.id)).version, "9.8.7");

  // peer:routes taught it the Mac's LAN address; the supervisor moves the runtime there.
  await until(() => first(computers).route === "lan", "the LAN route");
  assert.equal(first(computers).lan, true);
  assert.equal((await statusOf(computers, added.id)).version, "9.8.7");
  await until(async () => (await mac.client.call("devices:list"))[0]?.route === "lan", "the Mac to see it on the LAN");

  // A change made on the Mac reaches this desktop's runtime as an event.
  const opened = await mac.client.call("project:open", [mac.project]);
  const chatId = Object.values(opened.state.sessions)[0].id;
  await mac.client.call("chat:patch", [mac.project, chatId, { title: "Set on the Mac" }]);
  await until(
    () => events.some((event) => event.id === added.id && event.channel === "project:state" && event.payload?.path === mac.project),
    "the state event",
  );

  // The token and the Mac's key are sealed in computer-keys.json; computers.json has neither.
  const saved = await fs.readFile(path.join(dataDir, "computers.json"), "utf8");
  assert.deepEqual(
    JSON.parse(saved).map((computer) => [computer.name, computer.hostId]),
    [["studio", mac.identity.hostId]],
  );
  for (const file of ["computers.json", "computer-keys.json"])
    assert.equal((await fs.readFile(path.join(dataDir, file), "utf8")).includes(mac.token), false, file);
});

test("Deny, and a link whose window closed, turn the computer away and save nothing on either Mac", async (t) => {
  const { computers } = await desk(t);
  const mac = await startTestMac(t, { autoAllow: false });
  const heard = pendingHeard(mac);
  const link = await linkOf(mac);
  const { name } = await within(computers.preview(link), "the preview");
  const adding = computers.add(link, { name: "studio" });
  const [request] = await until(() => heard.at(-1)?.length && heard.at(-1), "the request");
  await mac.client.call("devices:deny", [request.key]);
  await assert.rejects(within(adding, "Deny to turn the computer away"), { message: `${name} didn't allow this Mac.` });
  assert.deepEqual(computers.list(), []);
  assert.deepEqual(await mac.client.call("devices:list"), []);
  mac.clock.now += 11 * 60_000;
  await assert.rejects(within(computers.add(link, { name: "studio" }), "the expired link to be refused"), {
    message: `This link expired. Copy a new one on ${name}.`,
  });
  assert.deepEqual(computers.list(), []);
});

test("a computer removed on the Mac it drives stops dialing and says so", async (t) => {
  const { computers, sockets } = await desk(t);
  const mac = await startTestMac(t, { lan: false });
  const added = await within(computers.add(await linkOf(mac), { name: "studio" }), "the computer to be added");
  await until(() => first(computers)?.state === "online", "online");
  const [device] = await mac.client.call("devices:list");
  await mac.client.call("devices:remove", [device.key]);
  await until(() => first(computers)?.state === "refused", "refused");
  assert.equal(first(computers).message, "Removed on studio. Pair again with a new link.");
  const dialed = sockets.length;
  await delay(500);
  assert.equal(sockets.length, dialed, "no more hellos");
  await assert.rejects(within(computers.invoke(added.id, "daemon:status"), "the refused computer to answer"), /studio is offline/);
});

test("a computer whose relay drops reads Reconnecting, comes back by itself and reads the Mac's state again", async (t) => {
  const states = [];
  const { computers, events } = await desk(t, { onChange: (list) => states.push(list[0]?.state) });
  const mac = await startTestMac(t, { lan: false });
  await within(computers.add(await linkOf(mac), { name: "studio" }), "the computer to be added");
  await until(() => first(computers)?.state === "online", "online");
  mac.relay.hostSockets.at(-1).terminate();
  await until(() => states.includes("reconnecting"), "reconnecting");
  await until(
    () => first(computers).state === "online" && events.some((event) => event.channel === "runtime:snapshot"),
    "back online with a fresh snapshot",
    10_000,
  );
  assert.equal(first(computers).route, "relay");
});
