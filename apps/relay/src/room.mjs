import nacl from 'tweetnacl';
import { hostIdOf, b64url, fromB64url } from '@milagre/shared/relay-crypto';

export const MAX_FRAME = 1024 * 1024;
export const MAX_PHONES = 16;
const OPEN = 1, DATA = 2, CLOSE = 3;

export function frame(type, conn, payload = new Uint8Array()) {
  const out = new Uint8Array(9 + payload.length);
  out[0] = type;
  new DataView(out.buffer).setBigUint64(1, conn);
  out.set(payload, 9);
  return out;
}
export function unframe(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return { type: view[0], conn: new DataView(view.buffer, view.byteOffset).getBigUint64(1), payload: view.slice(9) };
}

const TOO_BIG = Symbol('too-big');
/** Binary payloads only, never copied: null for text and anything that is not an ArrayBuffer or a view, TOO_BIG past `max` bytes. */
function toBytes(data, max) {
  let bytes;
  if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else return null;
  return bytes.byteLength > max ? TOO_BIG : bytes;
}

/** One Mac and its phones. Knows nothing about what the frames say. */
export function createRoom({ id, nonce = () => crypto.getRandomValues(new Uint8Array(32)) }) {
  let host = null, pending = null, challenge = null, next = 0n; // host: the proven Mac; pending: a newcomer still proving its key
  const phones = new Map(); // conn -> socket
  const connOf = new Map(); // socket -> conn
  const drop = (socket, code, reason) => { try { socket.close(code, reason); } catch { /* already closed */ } };
  const proves = data => {
    try {
      if ((typeof data === 'string' ? data.length : data.byteLength) > 4096) return false;
      const proof = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
      const key = proof?.t === 'proof' ? fromB64url(String(proof.key)) : null;
      return !!key && key.length === 32 && hostIdOf(key) === id && nacl.sign.detached.verify(challenge, fromB64url(String(proof.sig)), key);
    } catch { return false; /* malformed proof */ }
  };
  const dropPhones = () => { for (const phone of phones.values()) drop(phone, 4410, 'host-gone'); phones.clear(); connOf.clear(); };
  return {
    /** A new Mac socket waits as pending: the current host and its phones are untouched until the proof verifies. */
    hostOpened(socket) {
      if (pending) drop(pending, 4409, 'replaced');
      pending = socket; challenge = nonce();
      socket.send(JSON.stringify({ t: 'challenge', nonce: b64url(challenge) }));
    },
    hostMessage(socket, data) {
      if (socket === pending) {
        if (!proves(data)) { pending = null; return drop(socket, 4403, 'bad-proof'); }
        if (host) drop(host, 4409, 'replaced');
        dropPhones();
        host = socket; pending = null;
        return socket.send(JSON.stringify({ t: 'ready' }));
      }
      if (socket !== host) return drop(socket, 4409, 'replaced');
      const bytes = toBytes(data, MAX_FRAME + 9);
      if (bytes === TOO_BIG) return drop(socket, 1009, 'too-big');
      if (!bytes || bytes.byteLength < 9) return drop(socket, 1003, 'bad-frame');
      const { type, conn, payload } = unframe(bytes);
      const phone = phones.get(conn);
      if (!phone) return;
      if (type === DATA) phone.send(payload);
      else if (type === CLOSE) { phones.delete(conn); connOf.delete(phone); drop(phone, 1000, 'closed-by-host'); }
    },
    hostClosed(socket) {
      if (socket === pending) { pending = null; return; }
      if (socket !== host) return;
      host = null;
      dropPhones();
    },
    phoneOpened(socket) {
      if (!host) { drop(socket, 4404, 'host-offline'); return null; }
      if (phones.size >= MAX_PHONES) { drop(socket, 4429, 'too-many-phones'); return null; }
      const conn = ++next;
      phones.set(conn, socket); connOf.set(socket, conn);
      host.send(frame(OPEN, conn));
      return conn;
    },
    phoneMessage(socket, data) {
      const conn = connOf.get(socket);
      if (conn === undefined || !host) return;
      const bytes = toBytes(data, MAX_FRAME);
      if (bytes === TOO_BIG) return drop(socket, 1009, 'too-big');
      if (!bytes) return drop(socket, 1003, 'binary-only');
      host.send(frame(DATA, conn, bytes));
    },
    phoneClosed(socket) {
      const conn = connOf.get(socket);
      if (conn === undefined) return;
      phones.delete(conn); connOf.delete(socket);
      host?.send(frame(CLOSE, conn));
    },
  };
}
