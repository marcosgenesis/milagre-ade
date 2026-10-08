const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { b64url } = require("@milagre/shared/relay-crypto");
const { createComputerKeys } = require("./computer-keys.cjs");

const random = (n) => new Uint8Array(randomBytes(n));
/** Stands in for Electron's safeStorage: reversible, and never the plain text. */
const keychain = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (text) => Buffer.from(text, "utf8").map((byte) => byte ^ 0x5a),
  decryptString: (bytes) =>
    Buffer.from(bytes)
      .map((byte) => byte ^ 0x5a)
      .toString("utf8"),
});

async function file(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "computer-keys-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, "computer-keys.json");
}

test("this Mac's key pair is made once, and each computer's key and token stay sealed", async (t) => {
  const where = await file(t);
  const keys = createComputerKeys({ file: where, safeStorage: keychain(), random });
  const [one, two] = await Promise.all([keys.identity(), keys.identity()]);
  assert.equal(b64url(one.publicKey), b64url(two.publicKey), "two callers, one key pair");
  const token = "f".repeat(64);
  const hostKey = "K".repeat(43);
  await keys.save("c1", { hostKey, token });
  const raw = await fs.readFile(where, "utf8");
  assert.equal(raw.includes(token), false);
  assert.equal(raw.includes(hostKey), false);
  assert.equal(raw.includes(b64url(one.secretKey)), false);
  assert.equal((await fs.stat(where)).mode & 0o777, 0o600);
  const reopened = createComputerKeys({ file: where, safeStorage: keychain(), random });
  assert.equal(b64url((await reopened.identity()).publicKey), b64url(one.publicKey));
  assert.deepEqual(await reopened.secretsOf("c1"), { hostKey, token });
  await reopened.forget("c1");
  assert.equal(await reopened.secretsOf("c1"), null);
  assert.equal(await reopened.secretsOf("nope"), null);
});

test("without a keychain, or with keys sealed by another, nothing is made or read", async (t) => {
  const where = await file(t);
  await assert.rejects(createComputerKeys({ file: where, safeStorage: keychain(false), random }).identity(), /keychain/);
  await fs.writeFile(where, JSON.stringify({ v: 1, sealed: Buffer.from("not sealed by this keychain").toString("base64") }));
  await assert.rejects(createComputerKeys({ file: where, safeStorage: keychain(), random }).identity(), /can't be read/);
});

test("keychain failures carry the code keys, whether it is missing, can't open the file, or can't seal", async (t) => {
  const where = await file(t);
  await assert.rejects(createComputerKeys({ file: where, safeStorage: keychain(false), random }).identity(), { code: "keys" });
  await fs.writeFile(where, "not json");
  await assert.rejects(createComputerKeys({ file: where, safeStorage: keychain(), random }).identity(), { code: "keys" });
  await fs.rm(where);
  const failing = {
    ...keychain(),
    encryptString: () => {
      throw new Error("locked");
    },
  };
  const keys = createComputerKeys({ file: where, safeStorage: failing, random });
  await assert.rejects(keys.identity(), { code: "keys" });
  await assert.rejects(fs.stat(where), { code: "ENOENT" }, "nothing written in plain text");
});
