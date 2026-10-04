import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { boxKeyPair, signKeyPair, hostIdOf, phoneHello, hostAccept, phoneFinish, b64url, fromB64url } from './relay-crypto.mjs';

const random = n => new Uint8Array(randomBytes(n));
const token = 'a'.repeat(64);
function pair() {
  const host = boxKeyPair(random), phone = boxKeyPair(random);
  return { host, phone };
}

test('base64url round trips and hostIdOf is stable and 22 chars', () => {
  const bytes = random(40);
  assert.deepEqual(fromB64url(b64url(bytes)), bytes);
  const sign = signKeyPair(random);
  assert.equal(hostIdOf(sign.publicKey), hostIdOf(sign.publicKey));
  assert.match(hostIdOf(sign.publicKey), /^[A-Za-z0-9_-]{22}$/);
});

test('first pairing with the token opens a channel both ways', () => {
  const { host, phone } = pair();
  const { message, ephemeral } = phoneHello({ phone, host: host.publicKey, token, random });
  const accepted = hostAccept({ host, hello: message, isKnown: () => false, canPair: true, token, random });
  assert.equal(accepted.firstPairing, true);
  assert.equal(accepted.phoneKey, b64url(phone.publicKey));
  const phoneSide = phoneFinish({ ephemeral, phone, host: host.publicKey, reply: accepted.reply });
  assert.deepEqual(accepted.channel.open(phoneSide.seal({ t: 'ping' })), { t: 'ping' });
  assert.deepEqual(phoneSide.open(accepted.channel.seal({ t: 'pong' })), { t: 'pong' });
});

test('an unknown phone outside the pairing window is refused, even with the token', () => {
  const { host, phone } = pair();
  const { message } = phoneHello({ phone, host: host.publicKey, token, random });
  assert.throws(() => hostAccept({ host, hello: message, isKnown: () => false, canPair: false, token, random }), { code: 'unknown-phone' });
});

test('a wrong token is refused', () => {
  const { host, phone } = pair();
  const { message } = phoneHello({ phone, host: host.publicKey, token: 'b'.repeat(64), random });
  assert.throws(() => hostAccept({ host, hello: message, isKnown: () => true, token, random }), { code: 'bad-token' });
});

test('a hello for another host is refused', () => {
  const { host, phone } = pair();
  const other = boxKeyPair(random);
  const { message } = phoneHello({ phone, host: other.publicKey, token, random });
  assert.throws(() => hostAccept({ host, hello: message, isKnown: () => true, token, random }), { code: 'bad-hello' });
});

test('a swapped ephemeral key is refused', () => {
  const { host, phone } = pair();
  const { message } = phoneHello({ phone, host: host.publicKey, token, random });
  message.set(random(32), 1); // replace Ep in the clear
  assert.throws(() => hostAccept({ host, hello: message, isKnown: () => true, token, random }), { code: 'bad-hello' });
});

test('the phone refuses a reply that is not from the pinned host', () => {
  const { host, phone } = pair();
  const other = boxKeyPair(random);
  const { message, ephemeral } = phoneHello({ phone, host: host.publicKey, token, random });
  const accepted = hostAccept({ host, hello: message, isKnown: () => true, token, random });
  assert.throws(() => phoneFinish({ ephemeral, phone, host: other.publicKey, reply: accepted.reply }));
});

test('replay is rejected', () => {
  const { host, phone } = pair();
  const { message, ephemeral } = phoneHello({ phone, host: host.publicKey, token, random });
  const accepted = hostAccept({ host, hello: message, isKnown: () => true, token, random });
  const phoneSide = phoneFinish({ ephemeral, phone, host: host.publicKey, reply: accepted.reply });
  const frame = phoneSide.seal({ t: 'req', id: 1 });
  accepted.channel.open(frame);
  assert.throws(() => accepted.channel.open(frame), /replay|order/);
});

test('tampering is rejected', () => {
  const { host, phone } = pair();
  const { message, ephemeral } = phoneHello({ phone, host: host.publicKey, token, random });
  const accepted = hostAccept({ host, hello: message, isKnown: () => true, token, random });
  const phoneSide = phoneFinish({ ephemeral, phone, host: host.publicKey, reply: accepted.reply });
  const frame = phoneSide.seal({ t: 'req', id: 1 });
  frame[frame.length - 1] ^= 1;
  assert.throws(() => accepted.channel.open(frame), /decrypt/);
});
