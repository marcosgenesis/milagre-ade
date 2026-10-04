# Public Relay for Phone Access: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any Milagre user pairs their phone with their Mac from any network through a public relay at `relay.milagre.cloud`, with no Cloudflare account, no `cloudflared`, and traffic the relay cannot read.

**Architecture:** A Cloudflare Worker with one Durable Object per Mac forwards opaque binary frames between the Mac's daemon (one outbound WebSocket) and each phone (one WebSocket per phone). The phone and the daemon run an authenticated X25519 handshake (tweetnacl) on top, then exchange encrypted request/response and live messages. The daemon turns each decrypted request into a call to its existing loopback HTTP bridge, so every route, limit and token check stays where it is today.

**Tech Stack:** Cloudflare Workers + Durable Objects (WebSocket hibernation, `wrangler`), tweetnacl 1.0.3 (Unlicense, pure JS) in `@milagre/shared`, `ws` in the daemon, React Native WebSocket + `expo-crypto` (already in build 20) on the phone.

**Spec:** the approved design (chat, 2026-10-04), copied into the GitHub issue that carries this plan. Paseo's relay was the reference (`/tmp/milagre-paseo-reference/packages/relay`); its code isn't reused because `@getpaseo/relay` has no license.

## Global Constraints

- Mobile ships as OTA only: the runtime fingerprint must stay `e8155ccdd1f44b1d414e9b9f353af06cb7990ce1` (build 20). No new native module. `tweetnacl` is pure JS. Randomness comes from `expo-crypto` `getRandomBytes`, already linked.
- The relay never sees plaintext, tokens or keys other than the Mac's public relay identity.
- The Mac's named Cloudflare tunnel (`cloudflare.json`) keeps working unchanged; the relay is the default only when there is no tunnel.
- Daemon state files are 0600 in `dataDir`, written atomically (temp file + rename), like `mobile.json`.
- App copy, commits and PRs in English. No Claude/Anthropic attribution anywhere.
- Every visible change gets screenshots on the `screenshots` branch (AGENTS.md).
- Frame limit through the relay: 1 MiB. Larger bodies are chunked at 256 KiB by the inner protocol.
- Node >= 24 (the daemon `require`s the shared ESM modules, as it already does for `@milagre/shared/agent-runs`).

## Review Focus

1. A phone holding an old QR after Settings → Phone → Reset: the daemon must refuse it (unknown phone key, wrong token) and the app must say "Scan the new code", not "Connection lost". Test: Task 5 step "reset forgets phones".
2. The Mac sleeps or loses Wi-Fi with the phone connected: the phone sees the host go away (relay `host-gone`) and reconnects with backoff when it returns, without a stale socket blocking requests forever. Test: Task 6 "host gone rejects pending requests".
3. A 10 MB generated image or a 7 MB attachment upload crosses the relay: chunking must reassemble exactly, and a half-received body must fail cleanly when the socket drops. Test: Task 3 "chunked body round trip" and "drop mid-body".
4. Someone who learned a `hostId` connects as the host: the relay must reject them (signature check), so they cannot take the Mac's place. Test: Task 2 "host must sign the challenge".
5. Replayed or reordered ciphertext from the relay: the channel must close instead of acting twice (a replayed `chat:send` would send twice). Test: Task 1 "replay is rejected".

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/shared/src/relay-crypto.mjs` (+ `.d.mts`, `.test.mjs`) | Key pairs, base64url, handshake messages, the encrypted channel with counter nonces |
| `packages/shared/src/relay-rpc.mjs` (+ `.d.mts`, `.test.mjs`) | Inner messages over the channel: request/response with chunked bodies, live open/signal/close, ping |
| `apps/relay/` (`package.json`, `wrangler.toml`, `src/worker.ts`, `src/room.mjs`, `src/room.test.mjs`) | The Worker, the Durable Object, and the pure routing logic (`room.mjs`) the DO delegates to |
| `apps/daemon/src/relay-identity.cjs` (+ test) | The Mac's relay identity (sign + box key pairs) and the known-phones list, both in `dataDir` |
| `apps/daemon/src/relay-host.cjs` (+ test) | Outbound socket to the relay, per-phone handshake, proxying requests and live sockets to the loopback bridge |
| `apps/daemon/src/phone.cjs` (modify) | Starts the relay host when there is no Cloudflare tunnel; relay pairing link; reset forgets phones |
| `apps/daemon/src/mobile-pairing.cjs` (modify) | `relayPairingLink` |
| `apps/mobile/src/relay-transport.ts` (+ test) | Phone side of the socket, handshake and request multiplexing |
| `apps/mobile/src/client.ts` (modify) | A transport seam: HTTP (today) or relay; media through the relay |
| `apps/mobile/src/hosts-store.ts` (modify) + `pair.tsx`, `add-computer.tsx` | Relay hosts in storage; parsing relay pairing links |
| `apps/mobile/src/phone-identity.ts` | The phone's long-term key pair in SecureStore |
| `apps/desktop/app/src/components/Settings.tsx`, `electron.d.ts`, `lib/phone.ts` (modify) | `remote: 'relay'` status copy |

---

### Task 1: Shared crypto and the encrypted channel

**Files:**
- Create: `packages/shared/src/relay-crypto.mjs`, `packages/shared/src/relay-crypto.d.mts`, `packages/shared/src/relay-crypto.test.mjs`
- Modify: `packages/shared/package.json` (export `./relay-crypto`, dependency `tweetnacl@1.0.3`)

**Interfaces:**
- Produces:
  - `b64url(bytes: Uint8Array): string`, `fromB64url(text: string): Uint8Array`
  - `boxKeyPair(random): { publicKey, secretKey }`, `signKeyPair(random): { publicKey, secretKey }` where `random(n) => Uint8Array`
  - `hostIdOf(signPublicKey: Uint8Array): string` (first 16 bytes of SHA-512 of the key, base64url, 22 chars)
  - `phoneHello({ phone, host, token, random }) => { message: Uint8Array, ephemeral }`
  - `hostAccept({ host, hello, isKnown, canPair, token, random }) => { reply: Uint8Array, channel, phoneKey: string, firstPairing: boolean }` (throws `RelayAuthError` with `code: 'unknown-phone' | 'bad-token' | 'bad-hello'`). `canPair` is true only while the Mac's pairing window is open.
  - `phoneFinish({ ephemeral, phone, host, reply }) => channel`
  - `channel.seal(obj) => Uint8Array`, `channel.open(bytes) => obj` (throws on replay, reorder or tampering)

Handshake (all keys X25519 via `nacl.box`):
1. Phone: fresh ephemeral `Ep`. Sends `[0x01][Ep.pub 32][Pp.pub 32][nonce 24][box(Pp.sec → H.pub, JSON{token, eph: b64url(Ep.pub)})]`. Proves the phone holds `Pp`, carries the pairing token encrypted, binds `Ep`.
2. Host: opens the box with `H.sec` and `Pp.pub`. Rejects when `eph` differs from the cleartext `Ep`. Accepts when the token matches (constant time) and either the phone is known, or `canPair` is true (`firstPairing: true`, the caller saves `Pp`). An unknown phone outside the pairing window gets `unknown-phone`, even with the right token, so a leaked QR stops working once the window closes. Fresh `Em`; replies `[0x02][Em.pub 32][nonce 24][box(H.sec → Pp.pub, JSON{eph: b64url(Em.pub), peer: b64url(Ep.pub)})]`.
3. Phone: opens with `Pp.sec` and the pinned `H.pub`, checks `peer === Ep.pub`.
4. Both: `k = nacl.box.before(other ephemeral, own ephemeral secret)`. Channel frames are `[0x03][counter 8 bytes BE][secretbox]`, nonce = `direction byte (0x01 phone→host, 0x02 host→phone) + 15 zero bytes + counter`. A receiver requires `counter === lastSeen + 1`.

- [ ] **Step 1: Write the failing tests**

```js
// packages/shared/src/relay-crypto.test.mjs
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
  const impostor = boxKeyPair(random);
  const { message, ephemeral } = phoneHello({ phone, host: host.publicKey, token, random });
  const forged = hostAccept({ host: { ...impostor, publicKey: host.publicKey }, hello: message, isKnown: () => true, token, random });
  assert.throws(() => phoneFinish({ ephemeral, phone, host: host.publicKey, reply: forged.reply }));
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test packages/shared/src/relay-crypto.test.mjs`
Expected: FAIL, `Cannot find module './relay-crypto.mjs'`

- [ ] **Step 3: Implement**

```js
// packages/shared/src/relay-crypto.mjs
import nacl from 'tweetnacl';

/** Raised when a hello must not open a channel; `code` says why. */
export class RelayAuthError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const HELLO = 0x01, ACCEPT = 0x02, DATA = 0x03;
const PHONE_TO_HOST = 0x01, HOST_TO_PHONE = 0x02;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function b64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '') + (i + 2 < bytes.length ? ALPHABET[n & 63] : '');
  }
  return out;
}
export function fromB64url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Not base64url');
  const bytes = [];
  let bits = 0, value = 0;
  for (const char of text) {
    value = (value << 6) | ALPHABET.indexOf(char); bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 255); }
  }
  return new Uint8Array(bytes);
}
const withRandom = random => nacl.setPRNG((out, n) => out.set(random(n)));
export function boxKeyPair(random) { withRandom(random); return nacl.box.keyPair(); }
export function signKeyPair(random) { withRandom(random); return nacl.sign.keyPair(); }
export const hostIdOf = signPublicKey => b64url(nacl.hash(signPublicKey).slice(0, 16));

const json = value => encoder.encode(JSON.stringify(value));
const parse = bytes => JSON.parse(decoder.decode(bytes));
function sameToken(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function channel(key, sendDirection) {
  let sent = 0n, seen = 0n;
  const nonce = (direction, counter) => {
    const n = new Uint8Array(24);
    n[0] = direction;
    new DataView(n.buffer).setBigUint64(16, counter);
    return n;
  };
  const receiveDirection = sendDirection === PHONE_TO_HOST ? HOST_TO_PHONE : PHONE_TO_HOST;
  return {
    seal(value) {
      sent += 1n;
      const box = nacl.secretbox(json(value), nonce(sendDirection, sent), key);
      const frame = new Uint8Array(9 + box.length);
      frame[0] = DATA;
      new DataView(frame.buffer).setBigUint64(1, sent);
      frame.set(box, 9);
      return frame;
    },
    open(frame) {
      if (frame[0] !== DATA || frame.length < 9 + nacl.secretbox.overheadLength) throw new Error('Not a channel frame');
      const counter = new DataView(frame.buffer, frame.byteOffset).getBigUint64(1);
      if (counter !== seen + 1n) throw new Error('Out of order or replayed frame');
      const plain = nacl.secretbox.open(frame.subarray(9), nonce(receiveDirection, counter), key);
      if (!plain) throw new Error('Could not decrypt the frame');
      seen = counter;
      return parse(plain);
    },
  };
}

export function phoneHello({ phone, host, token, random }) {
  withRandom(random);
  const ephemeral = nacl.box.keyPair();
  const nonce = random(24);
  const box = nacl.box(json({ token, eph: b64url(ephemeral.publicKey) }), nonce, host, phone.secretKey);
  const message = new Uint8Array(1 + 32 + 32 + 24 + box.length);
  message[0] = HELLO; message.set(ephemeral.publicKey, 1); message.set(phone.publicKey, 33); message.set(nonce, 65); message.set(box, 89);
  return { message, ephemeral };
}

export function hostAccept({ host, hello, isKnown, canPair = false, token, random }) {
  if (hello[0] !== HELLO || hello.length < 89 + nacl.box.overheadLength) throw new RelayAuthError('bad-hello', 'Not a hello');
  const eph = hello.slice(1, 33), phoneKey = hello.slice(33, 65), nonce = hello.slice(65, 89);
  const plain = nacl.box.open(hello.subarray(89), nonce, phoneKey, host.secretKey);
  if (!plain) throw new RelayAuthError('bad-hello', 'The hello was not for this computer');
  let inner;
  try { inner = parse(plain); } catch { throw new RelayAuthError('bad-hello', 'Unreadable hello'); }
  if (inner.eph !== b64url(eph)) throw new RelayAuthError('bad-hello', 'The hello was altered');
  if (!sameToken(inner.token, token)) throw new RelayAuthError('bad-token', 'This phone was paired with an older code');
  const id = b64url(phoneKey);
  const firstPairing = !isKnown(id);
  if (firstPairing && !canPair) throw new RelayAuthError('unknown-phone', 'Pairing is closed on this computer');
  withRandom(random);
  const mine = nacl.box.keyPair();
  const replyNonce = random(24);
  const box = nacl.box(json({ eph: b64url(mine.publicKey), peer: b64url(eph) }), replyNonce, phoneKey, host.secretKey);
  const reply = new Uint8Array(1 + 32 + 24 + box.length);
  reply[0] = ACCEPT; reply.set(mine.publicKey, 1); reply.set(replyNonce, 33); reply.set(box, 57);
  return { reply, phoneKey: id, firstPairing, channel: channel(nacl.box.before(eph, mine.secretKey), HOST_TO_PHONE) };
}

export function phoneFinish({ ephemeral, phone, host, reply }) {
  if (reply[0] !== ACCEPT) throw new Error('Not an accept');
  const eph = reply.slice(1, 33), nonce = reply.slice(33, 57);
  const plain = nacl.box.open(reply.subarray(57), nonce, host, phone.secretKey);
  if (!plain) throw new Error('The reply is not from the paired computer');
  const inner = parse(plain);
  if (inner.eph !== b64url(eph) || inner.peer !== b64url(ephemeral.publicKey)) throw new Error('The reply was altered');
  return channel(nacl.box.before(eph, ephemeral.secretKey), PHONE_TO_HOST);
}
```

Write `relay-crypto.d.mts` with the signatures from **Interfaces** (types: `Uint8Array`, `KeyPair = { publicKey: Uint8Array; secretKey: Uint8Array }`, `Channel = { seal(value: unknown): Uint8Array; open(frame: Uint8Array): unknown }`). Add the export to `packages/shared/package.json`:

```json
"./relay-crypto": { "types": "./src/relay-crypto.d.mts", "default": "./src/relay-crypto.mjs" }
```

and `"dependencies": { "tweetnacl": "1.0.3" }`, then `npm install` at the root.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test packages/shared/src/relay-crypto.test.mjs`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/shared package-lock.json
git commit -m "feat(shared): relay crypto with an authenticated handshake and counter nonces"
```

---

### Task 2: The relay Worker

**Files:**
- Create: `apps/relay/package.json`, `apps/relay/wrangler.toml`, `apps/relay/tsconfig.json`, `apps/relay/src/room.mjs`, `apps/relay/src/room.test.mjs`, `apps/relay/src/worker.ts`

**Interfaces:**
- Consumes: `hostIdOf` (Task 1), `nacl.sign.detached.verify`
- Produces, the wire protocol both ends use:
  - Host: `wss://relay.milagre.cloud/v1/host?id=<hostId>`. The relay sends text `{"t":"challenge","nonce":"<b64url 32>"}`. The host answers text `{"t":"proof","key":"<b64url sign pub>","sig":"<b64url detached sig of nonce>"}`. On success the relay sends `{"t":"ready"}`. Then binary frames `[type 1][conn 8][payload]` with `type` 1 = open, 2 = data, 3 = close.
  - Phone: `wss://relay.milagre.cloud/v1/phone?id=<hostId>`. Binary payload frames only. If no host is connected the relay closes with code 4404 `host-offline`. When the host disconnects, every phone socket closes with 4410 `host-gone`.
  - Limits: frames up to 1 MiB (else close 1009), 16 phones per host (else 4429), ids must match `^[A-Za-z0-9_-]{22}$` (else HTTP 400).

`room.mjs` holds all the logic as plain JS over fake sockets, so it's tested in Node. `worker.ts` only adapts Cloudflare's `WebSocketPair`, hibernation (`state.acceptWebSocket`, `webSocketMessage`, `webSocketClose`) and tags (`host`, `phone:<conn>`).

- [ ] **Step 1: Write the failing tests**

```js
// apps/relay/src/room.test.mjs
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test apps/relay/src/room.test.mjs`
Expected: FAIL, `Cannot find module './room.mjs'`

- [ ] **Step 3: Implement `room.mjs`**

```js
// apps/relay/src/room.mjs
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
        let proof;
        try { proof = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)); } catch { return drop(socket, 4403, 'bad-proof'); }
        const key = proof?.t === 'proof' ? fromB64url(String(proof.key)) : null;
        if (!key || key.length !== 32 || hostIdOf(key) !== id || !nacl.sign.detached.verify(challenge, fromB64url(String(proof.sig)), key)) return drop(socket, 4403, 'bad-proof');
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test apps/relay/src/room.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: The Worker and Durable Object**

```ts
// apps/relay/src/worker.ts
import { createRoom } from './room.mjs';

export interface Env { ROOMS: DurableObjectNamespace }
const ID = /^[A-Za-z0-9_-]{22}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    const role = url.pathname === '/v1/host' ? 'host' : url.pathname === '/v1/phone' ? 'phone' : null;
    const id = url.searchParams.get('id') ?? '';
    if (!role || !ID.test(id)) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(request);
  },
};

/** One Mac's room. Rebuilt from tags after hibernation: the host socket is tagged 'host', phones 'phone'. */
export class Room implements DurableObject {
  private room?: ReturnType<typeof createRoom>;
  constructor(private state: DurableObjectState) {}
  private ensure(id: string) { return this.room ??= createRoom({ id }); }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const id = url.searchParams.get('id')!;
    const role = url.pathname === '/v1/host' ? 'host' : 'phone';
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server, [role, `id:${id}`]);
    const room = this.ensure(id);
    if (role === 'host') room.hostOpened(server); else room.phoneOpened(server);
    return new Response(null, { status: 101, webSocket: client });
  }
  private idOf(ws: WebSocket) { return this.state.getTags(ws).find(tag => tag.startsWith('id:'))!.slice(3); }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const room = this.ensure(this.idOf(ws));
    if (this.state.getTags(ws).includes('host')) room.hostMessage(ws, message); else room.phoneMessage(ws, message);
  }
  async webSocketClose(ws: WebSocket) {
    const room = this.ensure(this.idOf(ws));
    if (this.state.getTags(ws).includes('host')) room.hostClosed(ws); else room.phoneClosed(ws);
  }
}
```

Hibernation: in-memory `room` state is lost when the DO is evicted while sockets live on. To stay correct, **do not use hibernation in v1**. Use `server.accept()` and `addEventListener('message' | 'close')` instead of `state.acceptWebSocket`, so the DO stays in memory while any socket is open. Write `fetch` that way:

```ts
    server.accept();
    server.addEventListener('message', event => role === 'host' ? room.hostMessage(server, event.data) : room.phoneMessage(server, event.data));
    server.addEventListener('close', () => role === 'host' ? room.hostClosed(server) : room.phoneClosed(server));
```

and drop the `webSocketMessage` and `webSocketClose` methods. The host pings every 20 s (Task 4), so the room never idles out while a Mac is connected.

```toml
# apps/relay/wrangler.toml
name = "milagre-relay"
main = "src/worker.ts"
compatibility_date = "2026-09-01"
routes = [{ pattern = "relay.milagre.cloud", custom_domain = true }]

[[durable_objects.bindings]]
name = "ROOMS"
class_name = "Room"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Room"]
```

`apps/relay/package.json`: name `@milagre/relay`, private, `"type": "module"`, scripts `"test": "node --test src/*.test.mjs"`, `"deploy": "wrangler deploy"`, dependencies `tweetnacl` and `@milagre/shared` (workspace), devDependencies `wrangler`, `@cloudflare/workers-types`, `typescript`.

- [ ] **Step 6: Check it builds**

Run: `cd apps/relay && npx wrangler deploy --dry-run --outdir /tmp/milagre-relay-dry`
Expected: `--dry-run: exiting now.` with no type or bundling error.

- [ ] **Step 7: Commit**

```bash
git add apps/relay package.json package-lock.json
git commit -m "feat(relay): Cloudflare Worker that forwards phone and Mac frames per room"
```

---

### Task 3: Inner protocol (requests, chunked bodies, live)

**Files:**
- Create: `packages/shared/src/relay-rpc.mjs`, `packages/shared/src/relay-rpc.d.mts`, `packages/shared/src/relay-rpc.test.mjs`
- Modify: `packages/shared/package.json` (export `./relay-rpc`)

**Interfaces:**
- Produces (messages are the objects passed to `channel.seal`):
  - Request: `{ t: 'req', id: number, method: 'GET' | 'POST', path: string, headers: Record<string,string>, body?: string }` (body is the UTF-8 JSON text; uploads are already JSON with base64 inside)
  - Response parts: `{ t: 'res', id, status, headers, chunk: string, more: boolean }`. `chunk` is base64. The receiver concatenates the chunks until `more: false`.
  - Live: `{ t: 'live-open', id, path }`, `{ t: 'live', id, data: string }`, `{ t: 'live-close', id, code? }`
  - Keepalive: `{ t: 'ping' }` and `{ t: 'pong' }`
  - `splitBody(bytes: Uint8Array, size = 256 * 1024): string[]` (base64 chunks, at least one, possibly `''`)
  - `createAssembler()` with `.add(part) => { done: boolean, status?, headers?, body?: Uint8Array }` and `.drop(id)`
  - `toBase64(bytes)` and `fromBase64(text)`

- [ ] **Step 1: Write the failing tests**

```js
// packages/shared/src/relay-rpc.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { splitBody, createAssembler, toBase64, fromBase64 } from './relay-rpc.mjs';

test('base64 round trips', () => {
  const bytes = new Uint8Array(randomBytes(1001));
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
});

test('chunked body round trip (10 MB)', () => {
  const body = new Uint8Array(randomBytes(10 * 1024 * 1024));
  const chunks = splitBody(body);
  assert.ok(chunks.length > 1);
  const assembler = createAssembler();
  let result;
  chunks.forEach((chunk, i) => { result = assembler.add({ t: 'res', id: 7, status: 200, headers: { 'content-type': 'image/png' }, chunk, more: i < chunks.length - 1 }); });
  assert.equal(result.done, true);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, body);
});

test('an empty body is one empty chunk', () => {
  assert.deepEqual(splitBody(new Uint8Array()), ['']);
});

test('drop mid-body forgets the partial response', () => {
  const assembler = createAssembler();
  assert.equal(assembler.add({ t: 'res', id: 1, status: 200, headers: {}, chunk: toBase64(new Uint8Array([1])), more: true }).done, false);
  assembler.drop(1);
  const result = assembler.add({ t: 'res', id: 1, status: 200, headers: {}, chunk: toBase64(new Uint8Array([2])), more: false });
  assert.deepEqual(result.body, new Uint8Array([2]));
});

test('more than 32 MiB for one response is refused', () => {
  const assembler = createAssembler();
  const big = toBase64(new Uint8Array(1024 * 1024));
  assert.throws(() => { for (let i = 0; i < 40; i++) assembler.add({ t: 'res', id: 3, status: 200, headers: {}, chunk: big, more: true }); }, /too large/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test packages/shared/src/relay-rpc.test.mjs`
Expected: FAIL, module not found

- [ ] **Step 3: Implement**

```js
// packages/shared/src/relay-rpc.mjs
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export const CHUNK = 256 * 1024;
export const MAX_RESPONSE = 32 * 1024 * 1024;

export function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63] + (i + 1 < bytes.length ? CHARS[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? CHARS[n & 63] : '=');
  }
  return out;
}
export function fromBase64(text) {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let bits = 0, value = 0, j = 0;
  for (const char of clean) {
    const index = CHARS.indexOf(char);
    if (index < 0) throw new Error('Not base64');
    value = (value << 6) | index; bits += 6;
    if (bits >= 8) { bits -= 8; out[j++] = (value >> bits) & 255; }
  }
  return out;
}
export function splitBody(bytes, size = CHUNK) {
  if (!bytes.length) return [''];
  const chunks = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(toBase64(bytes.subarray(i, i + size)));
  return chunks;
}
/** Collects a response's chunks by id; a dropped connection calls drop() for every pending id. */
export function createAssembler() {
  const pending = new Map();
  return {
    add(part) {
      const entry = pending.get(part.id) ?? { parts: [], size: 0, status: part.status, headers: part.headers };
      const bytes = fromBase64(part.chunk);
      entry.size += bytes.length;
      if (entry.size > MAX_RESPONSE) { pending.delete(part.id); throw new Error('Response too large'); }
      entry.parts.push(bytes);
      if (part.more) { pending.set(part.id, entry); return { done: false }; }
      pending.delete(part.id);
      const body = new Uint8Array(entry.size);
      let offset = 0;
      for (const piece of entry.parts) { body.set(piece, offset); offset += piece.length; }
      return { done: true, status: entry.status, headers: entry.headers, body };
    },
    drop(id) { pending.delete(id); },
  };
}
```

Add the `.d.mts` and the export in `packages/shared/package.json`:

```json
"./relay-rpc": { "types": "./src/relay-rpc.d.mts", "default": "./src/relay-rpc.mjs" }
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test packages/shared/src/relay-rpc.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): relay request, chunked response and live messages"
```

---

### Task 4: Daemon relay host

**Files:**
- Create: `apps/daemon/src/relay-identity.cjs`, `apps/daemon/src/relay-identity.test.cjs`, `apps/daemon/src/relay-host.cjs`, `apps/daemon/src/relay-host.test.cjs`

**Interfaces:**
- Consumes: Task 1 (`hostAccept`, `signKeyPair`, `boxKeyPair`, `hostIdOf`, `b64url`, `fromB64url`), Task 3 (`splitBody`, `toBase64`), the bridge from `startMobileBridge` (`{ url, close, lost }`) and its `LIVE_ORIGIN = 'milagre-app://phone'`
- Produces:
  - `readIdentity(dataDir) => Promise<{ hostId, sign: KeyPair, box: KeyPair }>` (creates `relay-identity.json` 0600 on first call)
  - `createPhones(dataDir) => { isKnown(id): boolean, add(id): Promise<void>, clear(): Promise<void>, load(): Promise<void> }` over `relay-phones.json` 0600, at most 32 phones (oldest dropped)
  - `startRelayHost({ relayUrl, identity, phones, token, bridgeUrl, canPair: () => boolean, WebSocket?, random?, onStatus? }) => { close(): Promise<void>, status(): 'connecting' | 'online' | 'offline' }`

Behavior of `startRelayHost`:
1. Opens `${relayUrl}/v1/host?id=${hostId}`, answers the challenge with `nacl.sign.detached(nonce, identity.sign.secretKey)`, then sets `online`.
2. On an open frame, it creates a connection record. The first data frame is the hello: `hostAccept({ host: identity.box, hello, isKnown: phones.isKnown, canPair: canPair(), token, random })`. On `firstPairing` it calls `phones.add`. On `RelayAuthError` it sends `{t:'error', code}` in clear as a one-off text-encoded payload starting with byte `0x04`, then a close frame. Otherwise it sends the reply.
3. Later data frames go through `channel.open`. A decrypt error sends a close frame.
   - `req`: `fetch(bridgeUrl + path, { method, headers: { ...headers, Authorization: 'Bearer ' + token }, body })`. The response body bytes go back as `res` parts from `splitBody`. Only `content-type` and `etag` headers are forwarded.
   - `live-open`: opens `new WebSocket(bridgeUrl.replace('http', 'ws') + path, { headers: { Authorization: 'Bearer ' + token, Origin: 'milagre-app://phone' } })` and forwards messages as `live`.
   - `live-close` closes it.
   - `ping` answers `pong`.
4. Pings the relay every 20 s. When nothing is heard for 45 s, or the socket closes, it reconnects with backoff of 1, 2, 5, 10, then 30 s (±20% jitter) and closes every live socket of the dropped connections.

- [ ] **Step 1: Write the failing identity tests**

```js
// apps/daemon/src/relay-identity.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readIdentity, createPhones } = require('./relay-identity.cjs');

test('identity is created once, private, and stable', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-id-'));
  const first = await readIdentity(dir);
  const second = await readIdentity(dir);
  assert.equal(first.hostId, second.hostId);
  assert.match(first.hostId, /^[A-Za-z0-9_-]{22}$/);
  const mode = (await fs.stat(path.join(dir, 'relay-identity.json'))).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('reset forgets phones', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-phones-'));
  const phones = createPhones(dir);
  await phones.load();
  await phones.add('phoneA');
  assert.equal(phones.isKnown('phoneA'), true);
  const again = createPhones(dir);
  await again.load();
  assert.equal(again.isKnown('phoneA'), true);
  await again.clear();
  assert.equal(again.isKnown('phoneA'), false);
});
```

- [ ] **Step 2: Run to verify they fail, implement `relay-identity.cjs`, run to pass**

Run: `node --test apps/daemon/src/relay-identity.test.cjs` (FAIL, then PASS after the implementation below)

```js
// apps/daemon/src/relay-identity.cjs
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
```

- [ ] **Step 3: Write the failing relay-host tests**

The test spins up a local `ws` server playing the relay (using `createRoom` from `apps/relay/src/room.mjs` over real sockets), a fake bridge (`http.createServer` answering `/rpc` with `{v:1,result:'pong'}` after checking the bearer token, and a 600 KB `/media`), and drives a phone with Task 1's `phoneHello`/`phoneFinish`.

```js
// apps/daemon/src/relay-host.test.cjs (shape; write it fully)
test('a paired phone calls /rpc through the relay', async () => { /* expect res {status:200, body:'{"v":1,"result":"pong"}'} */ });
test('a 600 KB media response arrives in 3 chunks and reassembles', async () => {});
test('an unknown phone with a stale token gets {t:"error",code:"bad-token"} and a close', async () => {});
test('a new phone outside the pairing window gets unknown-phone; inside it, it pairs and is remembered', async () => {});
test('the host reconnects after the relay drops it and phones can connect again', async () => {});
test('live-open forwards the bridge live socket messages', async () => {});
```

- [ ] **Step 4: Implement `relay-host.cjs`** following the behavior list above. Inject `WebSocket` (default `require('ws')`), `fetch` (default global) and `timers` for tests. Keep connections in a `Map<bigint, { channel?, assembler, lives: Map<number, WebSocket> }>`.

- [ ] **Step 5: Run the daemon suite**

Run: `npm run test:daemon`
Expected: all pass, the new five included.

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/relay-identity.cjs apps/daemon/src/relay-identity.test.cjs apps/daemon/src/relay-host.cjs apps/daemon/src/relay-host.test.cjs
git commit -m "feat(daemon): relay host that pairs phones and proxies them to the bridge"
```

---

### Task 5: Phone setting uses the relay

**Files:**
- Modify: `apps/daemon/src/phone.cjs` (launch, reset, status), `apps/daemon/src/mobile-pairing.cjs` (`relayPairingLink`), their tests
- Modify: `apps/desktop/app/src/electron.d.ts` (`remote: 'cloudflare' | 'relay' | 'none'`), `apps/desktop/app/src/lib/phone.ts` + test, `apps/desktop/app/src/components/Settings.tsx`

**Interfaces:**
- Consumes: Task 4 (`readIdentity`, `createPhones`, `startRelayHost`)
- Produces:
  - `relayPairingLink({ relay, hostId, key, token, name }) => 'milagre://pair?relay=<enc origin>&host=<hostId>&key=<b64url box pub>&token=<64 hex>&name=<enc>'`
  - `createPhone({ ..., relayUrl = 'wss://relay.milagre.cloud', startRelay = startRelayHost })`. Without `cloudflare.json`, `remote` becomes `'relay'`, the link is the relay link, and `status()` adds `relay: 'connecting' | 'online' | 'offline'`.
  - `reset()` also calls `phones.clear()`.
  - Pairing window: `openPairing()` sets `pairingUntil = now + 10 min`. It runs on enable, on reset, and from a new daemon method `phone:open-pairing`, which the desktop calls whenever Settings → Phone shows the QR. `canPair = () => now() < pairingUntil` goes to `startRelayHost`. `status()` adds `pairingUntil` (ms epoch) so Settings can say "New phones can pair for 9 more minutes" and offer "Allow pairing again".

- [ ] **Step 1: Failing tests** in `apps/daemon/src/phone.test.cjs`:

```js
test('without a tunnel the phone pairs through the relay', async () => {
  const relays = [];
  const phone = createPhone({ dataDir, startBridge: fakeBridge, startRelay: options => { relays.push(options); return { close: async () => {}, status: () => 'online' }; } });
  await phone.setEnabled(true); await phone.settled();
  const status = phone.status();
  assert.equal(status.remote, 'relay');
  assert.match(status.pairingLink, /^milagre:\/\/pair\?relay=wss%3A%2F%2Frelay\.milagre\.cloud&host=[A-Za-z0-9_-]{22}&key=[A-Za-z0-9_-]{43}&token=[a-f0-9]{64}&name=/);
  assert.equal(relays[0].bridgeUrl, 'http://127.0.0.1:8797');
});

test('the pairing window closes after 10 minutes and opens again on phone:open-pairing', async () => {
  // inject now(); enable at t=0 -> canPair true; t=10m+1 -> false; openPairing() -> true
});

test('reset forgets relay phones', async () => {
  // pair phoneA via createPhones(dataDir).add('phoneA'); phone.reset(); expect createPhones(dataDir) after load() not to know phoneA
});

test('with cloudflare.json the relay is not started', async () => { /* write a cloudflare.json fixture as existing tests do; expect remote 'cloudflare' and relays.length === 0 */ });
```

- [ ] **Step 2: Run to fail**, then **Step 3: implement**. In `launch()`, when `cloudflare` is null: `identity = await readIdentity(dataDir)`, `phones = createPhones(dataDir); await phones.load()`, `relay = startRelay({ relayUrl, identity, phones, token: config.token, bridgeUrl: bridge.url, canPair: () => now() < pairingUntil, onStatus: () => onChange(status()) })`. Register `phone:open-pairing` next to `phone:status` in the daemon's method table and expose it to the desktop preload like `phone:reset`., `link = relayPairingLink({ relay: relayUrl, hostId: identity.hostId, key: b64url(identity.box.publicKey), token: config.token, name: name() })`. Teardown closes `relay` before the bridge. `reset` clears phones inside the same `enqueue`.

- [ ] **Step 4: Desktop copy.** `phoneStatusLine` returns `"On, reachable from any network"` for `remote: 'relay'` with `relay: 'online'`, and `"On, connecting to the relay…"` while connecting. The yellow loopback-only warning in `Settings.tsx` (line ~301, `remote === "none"`) stays only for `"none"`. Add the matching cases to `lib/phone.test.ts`.

- [ ] **Step 5: Run** `npm run test:daemon && npm run test --workspace milagre` (desktop unit tests), expected all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/daemon apps/desktop/app/src
git commit -m "feat(phone): pair through relay.milagre.cloud when there is no tunnel"
```

---

### Task 6: Phone relay transport

**Files:**
- Create: `apps/mobile/src/phone-identity.ts`, `apps/mobile/src/relay-transport.ts`, `apps/mobile/src/relay-transport.test.ts`
- Modify: `apps/mobile/package.json` (dependency `tweetnacl` 1.0.3, needed by `@milagre/shared`)

**Interfaces:**
- Consumes: Task 1 (`phoneHello`, `phoneFinish`, `boxKeyPair`, `b64url`, `fromB64url`), Task 3
- Produces:
  - `phoneIdentity(): Promise<KeyPair>` (SecureStore key `milagre.phone-key.v1`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; created with `expo-crypto` `getRandomBytes`)
  - `createRelayTransport({ relay, hostId, key, token, identity, create?, random?, timers? }) => { request(method, path, headers, body?): Promise<{ status, headers, body: Uint8Array }>, live(path, onData, onStatus): { close() }, close() }`
  - Errors with copy the user reads:
    - 4404 `host-offline` → `"Your Mac isn't reachable. Open Milagre on it and check Settings → Phone."`
    - `bad-token` → `"This phone was paired with an older code. Scan the new one in Settings → Phone."`
    - `unknown-phone` → `"Pairing is closed on your Mac. Open Settings → Phone on it and scan the code again."`
    - 4410 `host-gone` and drops → reconnect with backoff 1, 2, 5, 10, 30 s, and reject pending requests with `"Connection lost. Reconnect to your computer. Check the Chat before sending again."`

- [ ] **Step 1: Failing tests** with a fake socket pair that runs `hostAccept` on the other end, as in Task 1:

```ts
test('request round trip over the relay', async () => { /* res 200 body '{"v":1,"result":"pong"}' */ });
test('host gone rejects pending requests', async () => { /* fake relay closes with 4410 mid-request; expect the Connection lost message; next request reconnects */ });
test('a stale pairing says to scan again', async () => { /* host replies 0x04 {t:'error',code:'bad-token'}; expect the "older code" message and no reconnect loop */ });
test('host offline says to open Milagre', async () => { /* close 4404 before hello */ });
test('one socket serves concurrent requests and a live stream', async () => {});
```

- [ ] **Step 2: Run** `cd apps/mobile && node --test src/relay-transport.test.ts` (FAIL), **Step 3: implement**, **Step 4: run** (PASS).

Implementation notes:
- One WebSocket per paired host, opened lazily on the first request and kept open while the app is in the foreground. `binaryType = 'arraybuffer'`. The handshake runs before any request.
- Request ids increment per socket. Pending requests live in a map and are rejected when the socket drops.
- Keepalive: `ping` every 20 s. Nothing heard for 45 s means the socket is dead (the same silence rule as `live.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/phone-identity.ts apps/mobile/src/relay-transport.ts apps/mobile/src/relay-transport.test.ts apps/mobile/package.json package-lock.json
git commit -m "feat(mobile): relay transport with the paired Mac's pinned key"
```

---

### Task 7: The app talks through the relay

**Files:**
- Modify: `apps/mobile/src/hosts-store.ts` (+ test): `SavedHost` gains `relay?: { url: string; hostId: string; key: string }`. For relay hosts, `address` is `relay://<hostId>`; `id` is the same. `parsePairing` accepts `relay`, `host`, `key` and rejects a link with both `address` and `relay`.
- Modify: `apps/mobile/src/client.ts` (+ test): `createClient(host, ...)` picks the HTTP fetcher or the relay transport. `request()` keeps its 304/ETag cache, the `v: 1` check and its error copy. `live()` over the relay uses `transport.live` with the same `onSignal`/`onStatus`. `media()` is HTTP-only. Add `mediaFile(projectPath, path): Promise<string>`, which fetches through the relay and writes into `FileSystem.cacheDirectory + 'relay-media/<sha1 of path>'`.
- Modify: `apps/mobile/src/chat-reply.tsx`: `MediaSource` becomes `(path: string) => ImageSourcePropType | Promise<ImageSourcePropType>`, plus a small `useMedia(source, path)` hook that resolves a promise into state (shows the existing placeholder while it loads).
- Modify: `apps/mobile/src/app/pair.tsx`, `apps/mobile/src/app/add-computer.tsx`: pass the new params (`relay`, `host`, `key`) through to `parsePairing`.
- Modify: `apps/mobile/src/session.tsx`: build the client from the saved host (`createClient(host)`), not from `address`/`token`.
- Modify: `scripts/mobile-ui.test.cjs`: stubs for `./relay-transport` and `./phone-identity` where `client.ts` is loaded.

**Interfaces:**
- Consumes: Task 6 (`createRelayTransport`, `phoneIdentity`), Task 5's link format
- Produces: `createClient(host: SavedHost, fetcher?, timeoutMs?)`, keeping every existing method name (`call`, `snapshot`, `runs`, `message`, `upload`, `live`, `media`) and adding `mediaFile`

- [ ] **Step 1: Failing tests**:
  - `hosts-store.test.ts`: a relay link round trips into a saved host. A link with a bad `key` length throws `"Scan the code again"`. Address and relay links coexist.
  - `client.test.ts`: with a fake relay transport, `call('daemon:status')` returns the result. A 304 reuses the cache. A `bad-token` error surfaces the "older code" message.
- [ ] **Step 2: Run** `npm run test:mobile` (FAIL), **Step 3: implement**, **Step 4: run** (PASS), then `cd apps/mobile && npx tsc --noEmit && npx eslint src`.
- [ ] **Step 5: Fingerprint**: `cd apps/mobile && npx expo-updates fingerprint:generate --platform ios` prints `e8155ccdd1f44b1d414e9b9f353af06cb7990ce1`. If not, stop and ask (AGENTS.md).
- [ ] **Step 6: Commit**

```bash
git add apps/mobile scripts/mobile-ui.test.cjs
git commit -m "feat(mobile): pair and talk to a Mac through the relay"
```

---

### Task 8: Deploy and verify end to end

- [ ] **Step 1: Cloudflare token check.** Run `curl -s -H "Authorization: Bearer $(grep '^CLOUDFLARE_API_TOKEN=' ~/.private_keys/cloudflare.env | cut -d= -f2)" https://api.cloudflare.com/client/v4/user/tokens/verify` and list the token's policies. It needs **Workers Scripts: Edit**, **Workers Routes: Edit** and **Zone DNS: Edit** on `milagre.cloud`. If any is missing, stop and ask Victor to add them; keys are his to change.
- [ ] **Step 2: Deploy.** `cd apps/relay && CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx wrangler deploy`. Then `curl https://relay.milagre.cloud/health` prints `ok`.
- [ ] **Step 3: Simulator, own profile.** Run a separate daemon with `--data-dir $TMPDIR/relay-e2e` and no `cloudflare.json`, enable the phone, scan its link in the Release simulator build. Check: the project list loads, a chat opens, a live update arrives, a generated image renders, a message sends, an attachment uploads.
- [ ] **Step 4: Failure paths.**
  - Stop the e2e daemon: the app says "Your Mac isn't reachable…". Start it again: the app reconnects by itself.
  - Reset in Settings → Phone: the app says "This phone was paired with an older code…".
- [ ] **Step 5: Screenshots** on the `screenshots` branch (`public-relay/`): Settings → Phone with the relay on, pairing, the project list over the relay, and the "older code" error.
- [ ] **Step 6: Ship.** One PR per task, or one per group: shared + relay, daemon + desktop, mobile. After merge, publish the OTA (`npm run update:testflight`) and tell Victor that users need the new desktop version for the daemon side.

---

## Self-Review

- **Spec coverage:**
  - Relay on milagre.cloud: Tasks 2 and 8.
  - E2EE: Task 1.
  - Pinned Mac key, registered phones and the 10-minute pairing window: Tasks 1, 4 and 5.
  - Reset revokes: Tasks 4 and 5.
  - Mac connects out with no cloudflared: Tasks 4 and 5.
  - Named tunnel unchanged: Task 5, third test.
  - OTA only: Global Constraints and Task 7, step 5.
  - Desktop update needed: Task 8, step 6.
- **Placeholders:** Task 4's relay-host tests and Task 6's transport tests list their cases with expected results but leave the harness to the implementer. Both name exactly what each test asserts and which fakes to use (`createRoom` over `ws`, `hostAccept` on the far end).
- **Type consistency:**
  - `hostIdOf`, `b64url`, `fromB64url`, `phoneHello`, `hostAccept`, `phoneFinish` and `RelayAuthError` codes (`bad-hello`, `bad-token`, `unknown-phone`) are the same in Tasks 1, 4, 6 and 7.
  - Frame types 1, 2, 3 are the same in Tasks 2 and 4.
  - Message `t` values are the same in Tasks 3, 4 and 6.
- **Review Focus:** each of the five lines has a named test: Task 5 reset, Task 6 host gone, Task 3 chunked and drop, Task 2 signature, Task 1 replay.
