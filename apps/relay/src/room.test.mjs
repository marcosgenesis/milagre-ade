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

function proofFor(socket, signer) {
  const { nonce } = JSON.parse(socket.sent[0]);
  return JSON.stringify({ t: 'proof', key: b64url(signer.publicKey), sig: b64url(nacl.sign.detached(fromB64url(nonce), signer.secretKey)) });
}

test('an impostor connecting while the real host is ready is refused and disturbs nothing', () => {
  const room = createRoom({ id, nonce: randomNonce });
  const host = connectHost(room);
  const phone = fakeSocket();
  const conn = room.phoneOpened(phone);
  const impostor = fakeSocket();
  room.hostOpened(impostor);
  assert.equal(host.closed, null);
  assert.equal(phone.closed, null);
  room.hostMessage(impostor, proofFor(impostor, nacl.sign.keyPair()));
  assert.equal(impostor.closed.code, 4403);
  assert.equal(host.closed, null);
  assert.equal(phone.closed, null);
  room.phoneMessage(phone, new Uint8Array([1]));
  assert.deepEqual(unframe(host.sent.at(-1)), { type: 2, conn, payload: new Uint8Array([1]) });
  room.hostMessage(host, frame(2, conn, new Uint8Array([2])));
  assert.deepEqual(phone.sent.at(-1), new Uint8Array([2]));
});

test('a proven second host closes the first host and its phones', () => {
  const room = createRoom({ id, nonce: randomNonce });
  const first = connectHost(room);
  const phone = fakeSocket();
  room.phoneOpened(phone);
  const second = connectHost(room);
  assert.deepEqual(first.closed, { code: 4409, reason: 'replaced' });
  assert.deepEqual(phone.closed, { code: 4410, reason: 'host-gone' });
  room.hostClosed(first);
  const later = fakeSocket();
  assert.notEqual(room.phoneOpened(later), null);
  assert.equal(unframe(second.sent.at(-1)).type, 1);
});

test('a pending host that never proves does not block the current host, and phones cannot use it', () => {
  const room = createRoom({ id, nonce: randomNonce });
  const host = connectHost(room);
  const idle = fakeSocket();
  room.hostOpened(idle);
  const phone = fakeSocket();
  const conn = room.phoneOpened(phone);
  assert.notEqual(conn, null);
  room.hostMessage(host, frame(2, conn, new Uint8Array([3])));
  assert.deepEqual(phone.sent.at(-1), new Uint8Array([3]));
  assert.equal(idle.sent.length, 1);
  room.hostClosed(idle);
  assert.equal(host.closed, null);
});

test('only one host can be pending: a newer one closes the older', () => {
  const room = createRoom({ id, nonce: randomNonce });
  const older = fakeSocket(), newer = fakeSocket();
  room.hostOpened(older);
  room.hostOpened(newer);
  assert.equal(older.closed.code, 4409);
  room.hostMessage(newer, proofFor(newer, keys));
  assert.deepEqual(JSON.parse(newer.sent[1]), { t: 'ready' });
  assert.equal(room.phoneOpened(fakeSocket()) !== null, true);
});

test('a pending host cannot carry phone frames before it proves', () => {
  const room = createRoom({ id, nonce: randomNonce });
  const host = connectHost(room);
  const phone = fakeSocket();
  const conn = room.phoneOpened(phone);
  const impostor = fakeSocket();
  room.hostOpened(impostor);
  room.hostMessage(impostor, frame(2, conn, new Uint8Array([6])));
  assert.equal(impostor.closed.code, 4403);
  assert.equal(phone.sent.length, 0);
});

test('with no proven host, a phone is offline even while a host is pending', () => {
  const room = createRoom({ id, nonce: randomNonce });
  room.hostOpened(fakeSocket());
  const phone = fakeSocket();
  room.phoneOpened(phone);
  assert.equal(phone.closed.code, 4404);
});

test('a phone text frame closes that phone with 1003 and forwards nothing', () => {
  const room = createRoom({ id, nonce: randomNonce });
  const host = connectHost(room);
  const phone = fakeSocket();
  room.phoneOpened(phone);
  const before = host.sent.length;
  room.phoneMessage(phone, 'hello');
  assert.equal(phone.closed.code, 1003);
  assert.equal(host.sent.length, before);
});

test('a numeric text frame from a phone is refused without allocating', () => {
  const room = createRoom({ id, nonce: randomNonce });
  const host = connectHost(room);
  const phone = fakeSocket();
  room.phoneOpened(phone);
  const before = host.sent.length;
  const buffers = process.memoryUsage().arrayBuffers;
  room.phoneMessage(phone, '200000000');
  assert.ok(process.memoryUsage().arrayBuffers - buffers < 1024 * 1024);
  assert.equal(phone.closed.code, 1003);
  assert.equal(host.sent.length, before);
  const small = fakeSocket();
  room.phoneOpened(small);
  const sentBefore = host.sent.length;
  room.phoneMessage(small, '5');
  assert.equal(small.closed.code, 1003);
  assert.equal(host.sent.length, sentBefore);
});

test('a ready host sending a frame under 9 bytes or a text frame is closed with 1003', () => {
  for (const bad of [new Uint8Array(8), new Uint8Array(), 'text', '300000000']) {
    const room = createRoom({ id, nonce: randomNonce });
    const host = connectHost(room);
    const phone = fakeSocket();
    room.phoneOpened(phone);
    assert.doesNotThrow(() => room.hostMessage(host, bad));
    assert.equal(host.closed.code, 1003);
    assert.equal(phone.sent.length, 0);
  }
});

test('ArrayBuffer frames from the socket layer are forwarded', () => {
  const room = createRoom({ id, nonce: randomNonce });
  const host = connectHost(room);
  const phone = fakeSocket();
  const conn = room.phoneOpened(phone);
  room.phoneMessage(phone, new Uint8Array([4, 2]).buffer);
  assert.deepEqual(unframe(host.sent.at(-1)), { type: 2, conn, payload: new Uint8Array([4, 2]) });
  room.hostMessage(host, frame(2, conn, new Uint8Array([8])).buffer);
  assert.deepEqual(phone.sent.at(-1), new Uint8Array([8]));
});
