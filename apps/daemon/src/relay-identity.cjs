const { preparePrivateDirectory, assertPrivate, windowsAcl } = require("@milagre/core/private-files");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { boxKeyPair, signKeyPair, hostIdOf, b64url, fromB64url } = require("@milagre/shared/relay-crypto");

const random = (n) => new Uint8Array(randomBytes(n));
// Each retired identity holds one more relay socket while the phone is on, so only the last few are kept.
const MAX_RETIRED = 3;

async function writePrivate(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  if (process.platform === "win32") preparePrivateDirectory(path.dirname(file));
  const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
    if (process.platform === "win32") windowsAcl(temporary, { mode: "protect" });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

const identityFile = (dataDir) => path.join(dataDir, "relay-identity.json");

/** The Mac's relay identity: a signing key the relay checks, and a box key the phone pins from the QR. */
async function readIdentity(dataDir) {
  try {
    assertPrivate(identityFile(dataDir));
    const value = JSON.parse(await fs.readFile(identityFile(dataDir), "utf8"));
    const sign = decode(value.sign),
      box = decode(value.box);
    return { hostId: hostIdOf(sign.publicKey), sign, box };
  } catch (error) {
    if (/** @type {any} */ (error).code !== "ENOENT") throw error;
  }
  return rotateIdentity(dataDir);
}

const encode = (pair) => ({ publicKey: b64url(pair.publicKey), secretKey: b64url(pair.secretKey) });
const decode = (pair) => ({ publicKey: fromB64url(pair.publicKey), secretKey: fromB64url(pair.secretKey) });

/**
 * New sign and box key pairs, replacing any saved ones. Reset calls it, so a host id that leaked with an old link
 * no longer names this Mac on the relay. `retireUntil` (ms epoch) keeps the old signing key until then, so the old
 * room can still tell the phones that dial it that this Mac was reset (see readRetired).
 * @param {string} dataDir
 * @param {{ retireUntil?: number; now?: number }} [options]
 */
async function rotateIdentity(dataDir, { retireUntil, now = Date.now() } = {}) {
  if (retireUntil) {
    let old;
    try {
      old = JSON.parse(await fs.readFile(identityFile(dataDir), "utf8")).sign;
    } catch {
      /* nothing saved, or unreadable: nothing to retire */
    }
    if (old) {
      const kept = (await readRetiredRaw(dataDir)).filter((entry) => entry.until > now && entry.sign.publicKey !== old.publicKey);
      await writePrivate(retiredFile(dataDir), { retired: [...kept, { sign: old, until: retireUntil }].slice(-MAX_RETIRED) });
    }
  }
  const sign = signKeyPair(random),
    box = boxKeyPair(random);
  await writePrivate(identityFile(dataDir), { sign: encode(sign), box: encode(box) });
  return { hostId: hostIdOf(sign.publicKey), sign, box };
}

const retiredFile = (dataDir) => path.join(dataDir, "relay-retired.json");
async function readRetiredRaw(dataDir) {
  try {
    const value = JSON.parse(await fs.readFile(retiredFile(dataDir), "utf8")).retired;
    return Array.isArray(value)
      ? value.filter((entry) => typeof entry?.sign?.publicKey === "string" && typeof entry.sign.secretKey === "string" && Number.isFinite(entry.until))
      : [];
  } catch {
    return [];
  }
}

/**
 * Identities that Reset replaced and that still answer their old room until `until`: phones paired with them hear
 * "this Mac was reset" there instead of finding nobody. Only the signing key is kept; the room needs nothing else.
 */
async function readRetired(dataDir, now = Date.now()) {
  const out = [];
  for (const entry of await readRetiredRaw(dataDir)) {
    if (entry.until <= now) continue;
    try {
      const sign = decode(entry.sign);
      out.push({ hostId: hostIdOf(sign.publicKey), sign, until: entry.until });
    } catch {
      /* a damaged entry is skipped */
    }
  }
  return out;
}

module.exports = { readIdentity, rotateIdentity, readRetired, writePrivate };
