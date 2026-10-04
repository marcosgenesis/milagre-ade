import { test } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import { createRoom, frame, unframe } from './room.mjs';
import { hostIdOf, b64url, fromB64url } from '@milagre/shared/relay-crypto';

function fakeSocket() { const s = { sent: [], closed: null }; s.send = d => s.sent.push(d); s.close = (code, reason) => { s.closed = { code, reason }; }; return s; }
const keys = nacl.sign.keyPair();
const id = hostIdOf(keys.publicKey);
const randomNonce = () => new Uint8Array(32).fill(7);

function connectHost(room) {
  const host = fakeSocket();
  room.hostOpened(host);
  const { nonce } = JSON.parse(host.sent[0]);
  room.hostMessage(host, JSON.stringify({ t: 'proof', key: b64url(keys.publicKey), sig: b64url(nacl.sign.detached(fromB64url(nonce), keys.secretKey)) }));
  assert.deepEqual(JSON.parse(host.sent[1]), { t: 'ready' });
  return host;
}

test('host must sign the challenge with the key behind its id', () => {
  const room = createRoom({ id, nonce: randomNonce });
  const host = fakeSocket();
  room.hostOpened(host);
  const other = nacl.sign.keyPair();
  room.hostMessage(host, JSON.stringify({ t: 'proof', key: b64url(other.publicKey), sig: b64url(nacl.sign.detached(randomNonce(), other.secretKey)) }));
  assert.equal(host.closed.code, 4403);
});

test('phone frames reach the host tagged with a connection, and back', () => {
  const room = createRoom({ id, nonce: randomNonce });
  const host = connectHost(room);
  const phone = fakeSocket();
  const conn = room.phoneOpened(phone);
  assert.deepEqual(unframe(host.sent.at(-1)), { type: 1, conn, payload: new Uint8Array() });
  room.phoneMessage(phone, new Uint8Array([9, 9]));
  assert.deepEqual(unframe(host.sent.at(-1)), { type: 2, conn, payload: new Uint8Array([9, 9]) });
  room.hostMessage(host, frame(2, conn, new Uint8Array([5])));
  assert.deepEqual(phone.sent.at(-1), new Uint8Array([5]));
});

test('a phone with no host is closed as offline', () => {
  const room = createRoom({ id, nonce: randomNonce });
  const phone = fakeSocket();
  room.phoneOpened(phone);
  assert.equal(phone.closed.code, 4404);
});

test('phones are closed as host-gone when the host leaves', () => {
  const room = createRoom({ id, nonce: randomNonce });
  const host = connectHost(room);
  const phone = fakeSocket();
  room.phoneOpened(phone);
  room.hostClosed(host);
  assert.equal(phone.closed.code, 4410);
});

test('frames over 1 MiB and a 17th phone are refused', () => {
  const room = createRoom({ id, nonce: randomNonce });
  connectHost(room);
  const phones = Array.from({ length: 17 }, fakeSocket);
  phones.forEach(p => room.phoneOpened(p));
  assert.equal(phones[16].closed.code, 4429);
  room.phoneMessage(phones[0], new Uint8Array(1024 * 1024 + 1));
  assert.equal(phones[0].closed.code, 1009);
});

test('a second host replaces the first', () => {
  const room = createRoom({ id, nonce: randomNonce });
  const first = connectHost(room);
  connectHost(room);
  assert.equal(first.closed.code, 4409);
});

test('a malformed proof closes the host instead of throwing', () => {
  for (const proof of [{ t: 'proof', key: '!!', sig: 'x' }, { t: 'proof', key: b64url(keys.publicKey), sig: '***' }, { t: 'proof' }, 'not json']) {
    const room = createRoom({ id, nonce: randomNonce });
    const host = fakeSocket();
    room.hostOpened(host);
    room.hostMessage(host, typeof proof === 'string' ? proof : JSON.stringify(proof));
    assert.equal(host.closed.code, 4403);
  }
});
