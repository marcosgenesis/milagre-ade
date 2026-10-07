const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { readIdentity, rotateIdentity, readRetired, createPhones } = require("./relay-identity.cjs");

test("identity is created once, private, and stable", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-id-"));
  const first = await readIdentity(dir);
  const second = await readIdentity(dir);
  assert.equal(first.hostId, second.hostId);
  assert.match(first.hostId, /^[A-Za-z0-9_-]{22}$/);
  const mode = (await fs.stat(path.join(dir, "relay-identity.json"))).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("reset forgets phones", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-phones-"));
  const phones = createPhones(dir);
  await phones.load();
  await phones.add("phoneA");
  assert.equal(phones.isKnown("phoneA"), true);
  const again = createPhones(dir);
  await again.load();
  assert.equal(again.isKnown("phoneA"), true);
  await again.clear();
  assert.equal(again.isKnown("phoneA"), false);
});

test("only the 32 newest phones are remembered", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-cap-"));
  const phones = createPhones(dir);
  await phones.load();
  for (let i = 0; i < 33; i++) await phones.add(`phone${i}`);
  assert.equal(phones.isKnown("phone0"), false);
  assert.equal(phones.isKnown("phone1"), true);
  assert.equal(phones.isKnown("phone32"), true);
  const mode = (await fs.stat(path.join(dir, "relay-phones.json"))).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("rotating the identity replaces both key pairs, privately, and is what later reads return", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-rotate-"));
  const first = await readIdentity(dir);
  const rotated = await rotateIdentity(dir);
  assert.notEqual(rotated.hostId, first.hostId);
  assert.match(rotated.hostId, /^[A-Za-z0-9_-]{22}$/);
  assert.notDeepEqual(rotated.box.publicKey, first.box.publicKey);
  assert.notDeepEqual(rotated.sign.publicKey, first.sign.publicKey);
  const again = await readIdentity(dir);
  assert.equal(again.hostId, rotated.hostId);
  assert.deepEqual(again.box.publicKey, rotated.box.publicKey);
  assert.equal((await fs.stat(path.join(dir, "relay-identity.json"))).mode & 0o777, 0o600);
  assert.deepEqual(
    (await fs.readdir(dir)).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("a rotation that retires keeps the old signing key, privately, until its time is up", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-retire-"));
  const first = await readIdentity(dir);
  assert.deepEqual(await readRetired(dir, 0), []);
  const second = await rotateIdentity(dir, { retireUntil: 100, now: 0 });
  const retired = await readRetired(dir, 50);
  assert.equal(retired.length, 1);
  assert.equal(retired[0].hostId, first.hostId);
  assert.deepEqual(retired[0].sign.secretKey, first.sign.secretKey);
  assert.equal(retired[0].box, undefined, "only the signing key is kept");
  assert.equal(retired[0].until, 100);
  assert.notEqual(retired[0].hostId, second.hostId);
  assert.deepEqual(await readRetired(dir, 100), [], "gone once its time is up");
  assert.equal((await fs.stat(path.join(dir, "relay-retired.json"))).mode & 0o777, 0o600);
});

test("a plain rotation retires nothing, and only the last three retired identities are kept", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-retire-cap-"));
  await readIdentity(dir);
  await rotateIdentity(dir);
  assert.deepEqual(await readRetired(dir, 0), []);
  const ids = [];
  for (let i = 0; i < 4; i++) {
    ids.push((await readIdentity(dir)).hostId);
    await rotateIdentity(dir, { retireUntil: 1000, now: 0 });
  }
  assert.deepEqual(
    (await readRetired(dir, 0)).map((entry) => entry.hostId),
    ids.slice(1),
  );
});

test("the phone list counts its phones", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-count-"));
  const phones = createPhones(dir);
  await phones.load();
  assert.equal(phones.count(), 0);
  await phones.add("phoneA");
  await phones.add("phoneB");
  await phones.add("phoneA");
  assert.equal(phones.count(), 2);
  await phones.clear();
  assert.equal(phones.count(), 0);
});
