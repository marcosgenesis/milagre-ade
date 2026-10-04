const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { boxKeyPair, signKeyPair, hostIdOf, b64url, fromB64url } = require('@milagre/shared/relay-crypto');

const random = n => new Uint8Array(randomBytes(n));
const MAX_PHONES = 32;

async function writePrivate(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

/** The Mac's relay identity: a signing key the relay checks, and a box key the phone pins from the QR. */
async function readIdentity(dataDir) {
  const file = path.join(dataDir, 'relay-identity.json');
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    const sign = { publicKey: fromB64url(value.sign.publicKey), secretKey: fromB64url(value.sign.secretKey) };
    const box = { publicKey: fromB64url(value.box.publicKey), secretKey: fromB64url(value.box.secretKey) };
    return { hostId: hostIdOf(sign.publicKey), sign, box };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const sign = signKeyPair(random), box = boxKeyPair(random);
  const encode = pair => ({ publicKey: b64url(pair.publicKey), secretKey: b64url(pair.secretKey) });
  await writePrivate(file, { sign: encode(sign), box: encode(box) });
  return { hostId: hostIdOf(sign.publicKey), sign, box };
}

/** Phones that paired with the current token. Reset clears it, so an old phone must scan again. */
function createPhones(dataDir) {
  const file = path.join(dataDir, 'relay-phones.json');
  let known = [];
  return {
    async load() { try { known = JSON.parse(await fs.readFile(file, 'utf8')).phones ?? []; } catch { known = []; } },
    isKnown: id => known.includes(id),
    async add(id) { known = [...known.filter(item => item !== id), id].slice(-MAX_PHONES); await writePrivate(file, { phones: known }); },
    async clear() { known = []; await writePrivate(file, { phones: known }); },
  };
}

module.exports = { readIdentity, createPhones };
