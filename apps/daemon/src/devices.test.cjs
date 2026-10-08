const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createDevices, MAX_DEVICES } = require("./devices.cjs");

const tmp = (name) => fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
const saved = async (dir) => JSON.parse(await fs.readFile(path.join(dir, "devices.json"), "utf8"));
const mode = async (dir, name) => (await fs.stat(path.join(dir, name))).mode & 0o777;

test("a device is remembered with its kind, name and times, privately, across loads", async () => {
  const dir = await tmp("devices");
  let now = 1000;
  const devices = createDevices(dir, { now: () => now });
  await devices.load();
  await devices.add("phoneA", { kind: "phone", name: "Victor's iPhone" });
  now = 2000;
  await devices.add("macB", { kind: "computer", name: "studio" });
  const again = createDevices(dir);
  await again.load();
  assert.deepEqual(again.list(), [
    { key: "phoneA", kind: "phone", name: "Victor's iPhone", pairedAt: 1000, lastSeen: 1000 },
    { key: "macB", kind: "computer", name: "studio", pairedAt: 2000, lastSeen: 2000 },
  ]);
  assert.equal(again.isKnown("phoneA"), true);
  assert.equal(again.count(), 2);
  assert.equal(await mode(dir, "devices.json"), 0o600);
});

test("add with no kind or name is a nameless phone, and an unknown kind is refused", async () => {
  const dir = await tmp("devices-plain");
  const devices = createDevices(dir, { now: () => 7 });
  await devices.add("phoneA");
  assert.deepEqual(devices.list(), [{ key: "phoneA", kind: "phone", name: null, pairedAt: 7, lastSeen: 7 }]);
  await assert.rejects(devices.add("x", { kind: "tablet" }), /kind/);
});

test("the phone list counts its phones, and reset forgets them", async () => {
  const dir = await tmp("devices-count");
  const devices = createDevices(dir);
  await devices.load();
  assert.equal(devices.count(), 0);
  await devices.add("phoneA");
  await devices.add("phoneB");
  await devices.add("phoneA");
  assert.equal(devices.count(), 2);
  await devices.clear();
  assert.equal(devices.count(), 0);
  const again = createDevices(dir);
  await again.load();
  assert.equal(again.isKnown("phoneA"), false);
});

test("only the 32 newest devices are remembered", async () => {
  const dir = await tmp("devices-cap");
  const devices = createDevices(dir);
  await devices.load();
  for (let i = 0; i <= MAX_DEVICES; i++) await devices.add(`phone${i}`);
  assert.equal(MAX_DEVICES, 32);
  assert.equal(devices.isKnown("phone0"), false);
  assert.equal(devices.isKnown("phone1"), true);
  assert.equal(devices.isKnown("phone32"), true);
});

test("phones from relay-phones.json move to devices.json as nameless phones, and the old file goes", async () => {
  const dir = await tmp("devices-migrate");
  await fs.writeFile(path.join(dir, "relay-phones.json"), JSON.stringify({ phones: ["phoneA", "phoneB"] }), { mode: 0o600 });
  const devices = createDevices(dir);
  await devices.load();
  assert.deepEqual(devices.list(), [
    { key: "phoneA", kind: "phone", name: null, pairedAt: null, lastSeen: null },
    { key: "phoneB", kind: "phone", name: null, pairedAt: null, lastSeen: null },
  ]);
  assert.deepEqual(
    (await saved(dir)).devices.map((device) => device.key),
    ["phoneA", "phoneB"],
  );
  assert.equal(await mode(dir, "devices.json"), 0o600);
  await assert.rejects(fs.stat(path.join(dir, "relay-phones.json")), { code: "ENOENT" }, "a downgrade must not bring back a removed phone");
});

test("a migrated phone takes its name from its next hello", async () => {
  const dir = await tmp("devices-migrate-name");
  await fs.writeFile(path.join(dir, "relay-phones.json"), JSON.stringify({ phones: ["phoneA"] }), { mode: 0o600 });
  const devices = createDevices(dir, { now: () => 50 });
  await devices.load();
  await devices.seen("phoneA", { name: "Victor's iPhone" });
  assert.deepEqual((await saved(dir)).devices[0], { key: "phoneA", kind: "phone", name: "Victor's iPhone", pairedAt: null, lastSeen: 50 });
});

test("a store used before load still keeps the migrated phones", async () => {
  const dir = await tmp("devices-early");
  await fs.writeFile(path.join(dir, "relay-phones.json"), JSON.stringify({ phones: ["phoneA"] }), { mode: 0o600 });
  await createDevices(dir).add("phoneC");
  const again = createDevices(dir);
  await again.load();
  assert.deepEqual(
    again.list().map((device) => device.key),
    ["phoneA", "phoneC"],
  );
});

test("a relay-phones.json that is not private is not trusted, and is left for the owner to see", async () => {
  const dir = await tmp("devices-open");
  const legacy = path.join(dir, "relay-phones.json");
  await fs.writeFile(legacy, JSON.stringify({ phones: ["phoneA"] }));
  await fs.chmod(legacy, 0o644);
  const devices = createDevices(dir);
  await devices.load();
  assert.deepEqual(devices.list(), []);
  await fs.stat(legacy);
});

test("seen moves lastSeen at every hello but writes at most once a minute, and a new name at once", async () => {
  const dir = await tmp("devices-seen");
  let now = 0;
  const devices = createDevices(dir, { now: () => now });
  await devices.load();
  await devices.add("phoneA");
  now = 10_000;
  await devices.seen("phoneA");
  assert.equal(devices.list()[0].lastSeen, 10_000);
  assert.equal((await saved(dir)).devices[0].lastSeen, 0, "not written within the minute");
  now = 20_000;
  await devices.seen("phoneA", { name: "Victor's iPhone" });
  assert.deepEqual((await saved(dir)).devices[0], { key: "phoneA", kind: "phone", name: "Victor's iPhone", pairedAt: 0, lastSeen: 20_000 });
  now = 50_000;
  await devices.seen("phoneA");
  assert.equal((await saved(dir)).devices[0].lastSeen, 20_000);
  now = 80_000;
  await devices.seen("phoneA", { name: null });
  assert.equal((await saved(dir)).devices[0].lastSeen, 80_000);
  assert.equal(devices.list()[0].name, "Victor's iPhone", "a hello without a name keeps the one saved");
  await devices.seen("stranger");
  assert.equal(devices.count(), 1, "seen never adds a device");
});

test("remove forgets a device and remembers when; adding it back or a reset clears that", async () => {
  const dir = await tmp("devices-remove");
  let now = 5;
  const devices = createDevices(dir, { now: () => now });
  await devices.load();
  await devices.add("phoneA");
  await devices.add("phoneB");
  now = 9;
  assert.equal(await devices.remove("phoneA"), true);
  assert.equal(await devices.remove("phoneA"), false);
  assert.deepEqual(
    devices.list().map((device) => device.key),
    ["phoneB"],
  );
  assert.equal(devices.removedAt("phoneA"), 9);
  assert.equal(devices.removedAt("phoneB"), null);
  assert.equal(devices.removedAt("constructor"), null);
  const again = createDevices(dir, { now: () => now });
  await again.load();
  assert.equal(again.removedAt("phoneA"), 9);
  await again.add("phoneA");
  assert.equal(again.removedAt("phoneA"), null);
  await again.remove("phoneB");
  await again.clear();
  assert.equal(again.count(), 0);
  assert.equal(again.removedAt("phoneB"), null);
});
