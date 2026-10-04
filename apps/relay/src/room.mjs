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

/** One Mac and its phones. Knows nothing about what the frames say. */
export function createRoom({ id, nonce = () => crypto.getRandomValues(new Uint8Array(32)) }) {
  let host = null, challenge = null, ready = false, next = 0n;
  const phones = new Map(); // conn -> socket
  const connOf = new Map(); // socket -> conn
  const drop = (socket, code, reason) => { try { socket.close(code, reason); } catch { /* already closed */ } };
  return {
    hostOpened(socket) {
      if (host) drop(host, 4409, 'replaced');
      for (const phone of phones.values()) drop(phone, 4410, 'host-gone');
      phones.clear(); connOf.clear();
      host = socket; ready = false; challenge = nonce();
      socket.send(JSON.stringify({ t: 'challenge', nonce: b64url(challenge) }));
    },
    hostMessage(socket, data) {
      if (socket !== host) return drop(socket, 4409, 'replaced');
      if (!ready) {
        let valid = false;
        try {
          const proof = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
          const key = proof?.t === 'proof' ? fromB64url(String(proof.key)) : null;
          valid = !!key && key.length === 32 && hostIdOf(key) === id && nacl.sign.detached.verify(challenge, fromB64url(String(proof.sig)), key);
        } catch { /* malformed proof */ }
        if (!valid) return drop(socket, 4403, 'bad-proof');
        ready = true;
        return socket.send(JSON.stringify({ t: 'ready' }));
      }
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      if (bytes.length > MAX_FRAME + 9) return drop(socket, 1009, 'too-big');
      const { type, conn, payload } = unframe(bytes);
      const phone = phones.get(conn);
      if (!phone) return;
      if (type === DATA) phone.send(payload);
      else if (type === CLOSE) { phones.delete(conn); connOf.delete(phone); drop(phone, 1000, 'closed-by-host'); }
    },
    hostClosed(socket) {
      if (socket !== host) return;
      host = null; ready = false;
      for (const phone of phones.values()) drop(phone, 4410, 'host-gone');
      phones.clear(); connOf.clear();
    },
    phoneOpened(socket) {
      if (!host || !ready) { drop(socket, 4404, 'host-offline'); return null; }
      if (phones.size >= MAX_PHONES) { drop(socket, 4429, 'too-many-phones'); return null; }
      const conn = ++next;
      phones.set(conn, socket); connOf.set(socket, conn);
      host.send(frame(OPEN, conn));
      return conn;
    },
    phoneMessage(socket, data) {
      const conn = connOf.get(socket);
      if (conn === undefined || !host) return;
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      if (bytes.length > MAX_FRAME) return drop(socket, 1009, 'too-big');
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
