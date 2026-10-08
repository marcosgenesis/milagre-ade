# Computers PR 2: Paired-Desktop Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Mac's daemon accepts a paired desktop (hello `kind: "desktop"`) over the relay and the LAN, saves it as a computer, and serves it as one more daemon client with the paired-desktop deny set, speaking `rpc` / `evt` / `part` messages inside the encrypted channel, advertised as `desktop-peer-v1`.

**Architecture:** A new shared module `peer-frames.mjs` turns one daemon frame into sealed-channel messages (whole up to 768 KiB, else 512 KiB base64 parts) and back. A new daemon module `peer-channel.cjs` binds one channel to one `acceptConnection` (from PR 1) through an `openPeer` callback that `server.cjs` builds with `peerPolicy`; `phone-channels.cjs` hands every accepted desktop hello to it instead of the HTTP bridge, and closes it whenever the channel goes (remove, relay loss, LAN close, phone access off). The relay and LAN hosts only pass `openPeer` through and report how many bytes they hold for a connection, which bounds a desktop that stops reading.

**Tech Stack:** Node 24 CommonJS daemon (`node:test`, `node:assert/strict`), ESM `.mjs` + `.d.mts` in `@milagre/shared` (required from CJS as the daemon already does for `relay-crypto`), `tweetnacl` sealed channels, `ws`, the relay room logic from `apps/relay/src/room.mjs` run locally in tests.

**Spec:** `docs/superpowers/specs/2026-10-08-computers-design.md` (this plan is step 2 of its "Order of work"; PR 1's plan is `docs/superpowers/plans/2026-10-08-computers-pr1-devices.md`).

## Global Constraints

- If the worktree has no `node_modules`, run `npm install` before Task 1.
- Daemon code is CommonJS `.cjs`; tests use `node:test` and `node:assert/strict`. Shared code is ESM `.mjs` with a `.d.mts` beside it and a `"./name": { types, default }` entry in `packages/shared/package.json`.
- One unit file: `node --test <path>`. One workspace: `npm test -- --unit --workspace daemon`. All unit tests: `npm test -- --unit`.
- Hello: `kind: "desktop"` and `name` in its inner JSON; "No `kind` means phone, so existing phones keep working." The hello says `kind: "desktop"`; the store records that device as `kind: "computer"`.
- Messages after `hostAccept`, verbatim from the spec: `t: "rpc"` (one daemon request), `t: "evt"` (one pushed event) and `t: "part"` (a piece of a frame larger than 768 KiB, reassembled in order by `id` and index, capped at the daemon's 16 MiB frame limit). This plan carries every daemon frame (replies and errors too) as `evt`, and cuts frames over 768 KiB into 512 KiB pieces (a 768 KiB piece is 1 MiB in base64, past the relay's frame cap).
- Paired-desktop deny set: `phone:*`, `devices:*`, `push:*`, `daemon:stop`. A denied call answers `{ code: "NOT_AVAILABLE_REMOTELY", message: "Not available on a remote computer" }`.
- Capability string: `desktop-peer-v1`, in `daemon:status` `capabilities`.
- Pairing still happens only through the relay inside the 10-minute window; the LAN still refuses unknown keys.
- Limits: the relay caps frames at 1 MiB and rooms at 16 devices (`apps/relay/src/room.mjs:4-5`); the LAN caps a message at 4 MiB (`lan-host.cjs:16`); daemon frames go up to 16 MiB (`protocol.cjs:2`).
- The daemon socket behaves exactly as before: `apps/daemon/src/server.test.cjs` passes with no edits.
- Nothing changes for phones: no file under `apps/mobile` changes, the HTTP-over-channel protocol and the mobile bridge are untouched, no OTA and no build. `relay-crypto.mjs` gains one method the phone never calls.
- No Experimental flag: this PR is daemon-side; no screen can add a computer until PR 3. The only visible change is the macOS notification a computer's first pairing shows (Task 9).
- Commits: conventional messages, no Claude or Anthropic co-author trailer or footer. The pre-commit hook runs `oxlint` and `oxfmt --check` on staged files: run `npx oxfmt <files>` before `git add`.

## Review Focus

- A paired desktop listening to events: `phone:status` carries the pairing link, its token and the QR (`phone.cjs:103`), and `broadcast` sends every event to every client (`server.cjs:302-311`). A desktop must hear no `phone:*` event, or it could pair other devices. Pinned in Task 7 (`connections.test.cjs`) and Task 8 (end to end).
- A known device changing its kind: a paired phone's key sending `kind: "desktop"` would trade the bridge's allow-list (`mobile-bridge.cjs:22-106`) for the whole dispatcher; a computer's key without `kind` would reach the bridge. Both are refused with `reason: "kind"`. Pinned in Task 4.
- Phone access confined to one folder (`allowedRoot`, the App Review demo): a desktop would bypass the confinement entirely, so a confined Mac never hosts one. Pinned in Task 6.
- A frame whose 512 KiB piece boundary falls inside a multi-byte character (accents, emoji), and a frame of exactly 768 KiB against 768 KiB + 1 byte: reassembled byte for byte, whole versus parts at the right size. Pinned in Task 2, and through the real relay room in Tasks 4 and 8.
- A desktop that stops reading while events keep coming: its channel is dropped once the carrier holds 32 MiB for it (what `wire()` allows a socket, `protocol.cjs:75`), and a reply to a channel already gone returns `false` and sends nothing. Pinned in Task 3.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `packages/shared/src/relay-crypto.mjs`, `.d.mts`, `.test.mjs` | modify | `channel.sealEncoded(bytes)`: seal a message already JSON-encoded |
| `packages/shared/src/peer-frames.mjs`, `.d.mts`, `.test.mjs` | create | `rpc` / `evt` / `part` writer and reader, limits |
| `packages/shared/package.json` | modify | Export `./peer-frames` |
| `apps/daemon/src/peer-channel.cjs`, `peer-channel.test.cjs` | create | One desktop channel = one daemon connection; byte budget |
| `apps/daemon/src/devices.cjs`, `devices.test.cjs` | modify | `kindOf(key)` |
| `apps/daemon/src/phone-channels.cjs` | modify | Accept desktop hellos, kind lock, open and close the peer |
| `apps/daemon/src/relay-host.cjs`, `lan-host.cjs` | modify | Pass `openPeer`; `queued(conn)` |
| `apps/daemon/src/relay-test-kit.cjs` | modify | `startLocalRelay` (moved from `relay-host.test.cjs`), `connectDesktop`, `fakePeerDaemon` |
| `apps/daemon/src/relay-host.test.cjs`, `lan-host.test.cjs` | modify | Desktop tests |
| `apps/daemon/src/phone.cjs`, `phone.test.cjs` | modify | `kindOf` on the hosts' store, `openPeer` unless confined, `onPaired` kind, `peerRoutes()` |
| `apps/daemon/src/server.cjs` | modify | `openPeer` = `acceptConnection` + `peerPolicy`, event filter, `desktop-peer-v1`, `peer:routes` |
| `apps/daemon/src/connections.test.cjs` | modify | Event filter, capability, method |
| `apps/daemon/src/peer-e2e.test.cjs` | create | Throwaway daemon + local relay + LAN: desktop and phone end to end |
| `apps/desktop/electron/notifications.cjs`, `.test.cjs`, `main.cjs` | modify | "New computer paired" |

---

### Task 1: A channel seals a message already encoded

**Files:**
- Modify: `packages/shared/src/relay-crypto.mjs:77-107`
- Modify: `packages/shared/src/relay-crypto.d.mts` (the `Channel` type)
- Test: `packages/shared/src/relay-crypto.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Channel.sealEncoded(plain: Uint8Array): Uint8Array` — seals the UTF-8 bytes of one JSON message; the other side's `open()` returns the parsed value, exactly as for `seal(value)`. It shares `seal`'s counter, so the two can be mixed freely.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/relay-crypto.test.mjs`:

```js
test("sealEncoded seals JSON text already encoded, in the same counter sequence as seal", () => {
  const { host, phone } = pair();
  const { message, ephemeral } = phoneHello({ phone, host: host.publicKey, token, random, kind: "desktop" });
  const accepted = hostAccept({ host, hello: message, isKnown: () => false, canPair: true, token, random });
  const desktop = phoneFinish({ ephemeral, phone, host: host.publicKey, reply: accepted.reply });
  assert.deepEqual(desktop.open(accepted.channel.seal({ t: "pong" })), { t: "pong" });
  const encoded = new TextEncoder().encode('{"t":"evt","frame":{"v":1,"id":1,"result":"ação🙂"}}');
  assert.deepEqual(desktop.open(accepted.channel.sealEncoded(encoded)), { t: "evt", frame: { v: 1, id: 1, result: "ação🙂" } });
  assert.deepEqual(desktop.open(accepted.channel.seal({ t: "pong" })), { t: "pong" });
  assert.deepEqual(accepted.channel.open(desktop.sealEncoded(new TextEncoder().encode('{"t":"ping"}'))), { t: "ping" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/shared/src/relay-crypto.test.mjs`
Expected: FAIL with `TypeError: accepted.channel.sealEncoded is not a function`

- [ ] **Step 3: Write minimal implementation**

In `packages/shared/src/relay-crypto.mjs`, replace the `return { seal(value) { ... }, open(frame) { ... } };` of `channel()` with:

```js
  /** Seals `plain`, the UTF-8 bytes of one JSON message. */
  function sealEncoded(plain) {
    sent += 1n;
    const box = nacl.secretbox(plain, nonce(sendDirection, sent), key);
    const frame = new Uint8Array(9 + box.length);
    frame[0] = DATA;
    new DataView(frame.buffer).setBigUint64(1, sent);
    frame.set(box, 9);
    return frame;
  }
  return {
    seal: (value) => sealEncoded(json(value)),
    // A daemon frame is serialised once for every client; sealing its bytes saves a second JSON pass per desktop.
    sealEncoded,
    open(frame) {
      if (frame[0] !== DATA || frame.length < 9 + nacl.secretbox.overheadLength) throw new Error("Not a channel frame");
      const counter = new DataView(frame.buffer, frame.byteOffset).getBigUint64(1);
      if (counter !== seen + 1n) throw new Error("Out of order or replayed frame");
      const plain = nacl.secretbox.open(frame.subarray(9), nonce(receiveDirection, counter), key);
      if (!plain) throw new Error("Could not decrypt the frame");
      seen = counter;
      return parse(plain);
    },
  };
```

In `packages/shared/src/relay-crypto.d.mts`, replace the `Channel` type with:

```ts
export type Channel = {
  seal(value: unknown): Uint8Array;
  /** Seals the UTF-8 bytes of a message already encoded as JSON; the other side opens it as it opens seal()'s. */
  sealEncoded(plain: Uint8Array): Uint8Array;
  open(frame: Uint8Array): unknown;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/shared/src/relay-crypto.test.mjs`
Expected: PASS (every test in the file)

- [ ] **Step 5: Commit**

```bash
npx oxfmt packages/shared/src/relay-crypto.mjs packages/shared/src/relay-crypto.d.mts packages/shared/src/relay-crypto.test.mjs
git add packages/shared/src/relay-crypto.mjs packages/shared/src/relay-crypto.d.mts packages/shared/src/relay-crypto.test.mjs
git commit -m "feat(shared): seal a channel message already encoded as JSON"
```

---

### Task 2: Peer frames: `rpc`, `evt` and `part`

**Files:**
- Create: `packages/shared/src/peer-frames.mjs`
- Create: `packages/shared/src/peer-frames.d.mts`
- Modify: `packages/shared/package.json` (`exports`)
- Test: `packages/shared/src/peer-frames.test.mjs`

**Interfaces:**
- Consumes: nothing (Node's `Buffer`).
- Produces:
  - `PART_THRESHOLD = 786432` (768 KiB), `PIECE_BYTES = 524288` (512 KiB), `MAX_FRAME_BYTES = 16777216`, `MAX_PARTS = 32`.
  - `createFrameWriter(kind: "rpc" | "evt"): { write(json: string): Uint8Array[] }` — the UTF-8 message texts for one frame, each ready for `channel.sealEncoded`. One `{"t":kind,"frame":<json>}` when the frame's UTF-8 is at most 768 KiB; else `n` consecutive `{"t":"part","id","i","n","data"}` with `data` the base64 of 512 KiB of the frame's bytes and `id` counting split frames from 1. Throws an `Error` with `code: "FRAME_TOO_LARGE"` and `bytes` past 16 MiB.
  - `createFrameReader(kind, { maxBytes = MAX_FRAME_BYTES } = {}): { read(message): { frame: unknown } | null; pending(): boolean }` — `read` takes one opened message; returns the frame it completes, or `null` while parts are still arriving. Throws `code: "BAD_PART"` (not a frame of this direction, malformed part, out of order, repeated, cut by another message), `"FRAME_TOO_LARGE"` (`n` or the bytes past `maxBytes`) or `"INVALID_REQUEST"` (reassembled bytes are not JSON). After any throw nothing is held.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/peer-frames.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFrameReader, createFrameWriter, PART_THRESHOLD, PIECE_BYTES, MAX_FRAME_BYTES, MAX_PARTS } from "./peer-frames.mjs";

/** The messages a writer produced, opened as the other side would. */
const messages = (texts) => texts.map((text) => JSON.parse(Buffer.from(text).toString("utf8")));
/** A JSON frame of exactly `bytes` UTF-8 bytes. */
const frameOf = (bytes) => JSON.stringify("x".repeat(bytes - 2));
function readAll(reader, list) {
  const frames = [];
  for (const message of list) {
    const read = reader.read(message);
    if (read) frames.push(read.frame);
  }
  return frames;
}

test("the limits fit the relay: a whole message and a part both stay under its 1 MiB frames once sealed", () => {
  assert.equal(PART_THRESHOLD, 768 * 1024);
  assert.equal(PIECE_BYTES, 512 * 1024);
  assert.equal(MAX_FRAME_BYTES, 16 * 1024 * 1024);
  assert.equal(MAX_PARTS, 32);
  const sealed = 9 + 16; // the channel's header and the secretbox tag
  const [whole] = createFrameWriter("evt").write(frameOf(PART_THRESHOLD));
  assert.ok(whole.length + sealed <= 1024 * 1024, `whole: ${whole.length}`);
  const [part] = createFrameWriter("evt").write(frameOf(PART_THRESHOLD + 1));
  assert.ok(part.length + sealed <= 1024 * 1024, `part: ${part.length}`);
});

test("a frame of up to 768 KiB is one message; one byte more travels in 512 KiB parts", () => {
  const writer = createFrameWriter("evt");
  const at = frameOf(PART_THRESHOLD);
  const whole = messages(writer.write(at));
  assert.deepEqual(whole, [{ t: "evt", frame: JSON.parse(at) }]);
  const over = frameOf(PART_THRESHOLD + 1);
  const parts = messages(writer.write(over));
  assert.deepEqual(
    parts.map(({ t, id, i, n }) => ({ t, id, i, n })),
    [
      { t: "part", id: 1, i: 0, n: 2 },
      { t: "part", id: 1, i: 1, n: 2 },
    ],
  );
  assert.equal(Buffer.from(parts[0].data, "base64").length, PIECE_BYTES);
  assert.deepEqual(readAll(createFrameReader("evt"), parts), [JSON.parse(over)]);
  assert.equal(messages(writer.write(over))[0].id, 2, "each split frame takes the next id");
});

test("parts reassemble byte for byte when a piece boundary falls inside a character", () => {
  // "ação🙂" is 10 bytes and 512 KiB is not a multiple of 10, so the boundaries cut accented letters and emoji.
  const text = "ação🙂".repeat(300_000);
  const json = JSON.stringify({ v: 1, id: 7, result: text });
  const parts = messages(createFrameWriter("rpc").write(json));
  assert.equal(parts.length, Math.ceil(Buffer.byteLength(json) / PIECE_BYTES));
  assert.deepEqual(readAll(createFrameReader("rpc"), parts), [{ v: 1, id: 7, result: text }]);
});

test("a frame of exactly 16 MiB travels in 32 parts and reads back", () => {
  const parts = messages(createFrameWriter("evt").write(frameOf(MAX_FRAME_BYTES)));
  assert.equal(parts.length, MAX_PARTS);
  const [frame] = readAll(createFrameReader("evt"), parts);
  assert.equal(frame.length, MAX_FRAME_BYTES - 2);
});

test("a reader refuses parts out of order, repeated, cut by another message, or from two frames at once", () => {
  const parts = messages(createFrameWriter("rpc").write(frameOf(3 * PIECE_BYTES)));
  const other = parts.map((part) => ({ ...part, id: 9 }));
  const cases = {
    "starts past the first part": [parts[1]],
    "skips a part": [parts[0], parts[2]],
    "repeats a part": [parts[0], parts[0]],
    "a whole message cuts in": [parts[0], { t: "rpc", frame: { v: 1 } }],
    "another frame's part cuts in": [parts[0], other[1]],
    "changes its count": [parts[0], { ...parts[1], n: 4 }],
  };
  for (const [name, list] of Object.entries(cases)) {
    const reader = createFrameReader("rpc");
    assert.throws(() => readAll(reader, list), { code: "BAD_PART" }, name);
    assert.equal(reader.pending(), false, `${name}: nothing is held after a refusal`);
  }
});

test("malformed parts are BAD_PART, and a frame past the limit is FRAME_TOO_LARGE before it is held", () => {
  const [good] = messages(createFrameWriter("rpc").write(frameOf(PART_THRESHOLD + 1)));
  const cases = {
    "the other direction's message": { t: "evt", frame: {} },
    "an id that is not a number": { ...good, id: "1" },
    "a single part": { ...good, n: 1 },
    "data that is not base64": { ...good, data: "!!!!" },
    "data longer than a piece": { ...good, data: "A".repeat(Math.ceil(PIECE_BYTES / 3) * 4 + 4) },
    "no data": { ...good, data: undefined },
  };
  for (const [name, message] of Object.entries(cases)) assert.throws(() => createFrameReader("rpc").read(message), { code: "BAD_PART" }, name);
  assert.throws(() => createFrameReader("rpc").read({ ...good, n: MAX_PARTS + 1 }), { code: "FRAME_TOO_LARGE" });
  const small = createFrameReader("rpc", { maxBytes: PART_THRESHOLD });
  const parts = messages(createFrameWriter("rpc").write(frameOf(PART_THRESHOLD + 1)));
  assert.equal(small.read(parts[0]), null);
  assert.throws(() => small.read(parts[1]), { code: "FRAME_TOO_LARGE" });
  assert.equal(small.pending(), false);
});

test("reassembled bytes that are not JSON are INVALID_REQUEST", () => {
  const parts = messages(createFrameWriter("rpc").write("x".repeat(PART_THRESHOLD + 1)));
  const reader = createFrameReader("rpc");
  assert.equal(reader.read(parts[0]), null);
  assert.throws(() => reader.read(parts[1]), { code: "INVALID_REQUEST" });
});

test("a writer refuses a frame over 16 MiB with FRAME_TOO_LARGE and its size", () => {
  assert.throws(
    () => createFrameWriter("evt").write(frameOf(MAX_FRAME_BYTES + 1)),
    (error) => error.code === "FRAME_TOO_LARGE" && error.bytes === MAX_FRAME_BYTES + 1,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/shared/src/peer-frames.test.mjs`
Expected: FAIL with `Cannot find module '.../packages/shared/src/peer-frames.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/src/peer-frames.mjs`:

```js
// The paired-desktop protocol inside an encrypted channel (relay-crypto). A desktop sends each daemon request as an
// `rpc` message and the daemon sends each of its frames (a reply, an error or an event) as an `evt` message:
//   { t: "rpc" | "evt", frame }
// A frame whose UTF-8 JSON is over PART_THRESHOLD bytes travels instead as consecutive `part` messages, each with the
// base64 of PIECE_BYTES of it (a whole 768 KiB piece would be 1 MiB in base64, past the relay's frames):
//   { t: "part", id, i, n, data }   id: the sender's count of split frames, i: 0..n-1, n: how many parts
// A frame's parts are never interleaved with another rpc, evt or part message, and the channel delivers in order, so a
// reader holds at most one frame. Node only (the daemon and Electron main): it uses Buffer.
import { Buffer } from "node:buffer";

export const PART_THRESHOLD = 768 * 1024;
export const PIECE_BYTES = 512 * 1024;
// The daemon's frame limit (apps/daemon/src/protocol.cjs).
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;
export const MAX_PARTS = MAX_FRAME_BYTES / PIECE_BYTES;
const MAX_DATA = Math.ceil(PIECE_BYTES / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const CLOSE_BRACE = Buffer.from("}");

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const peerError = (code, message) => Object.assign(new Error(message), { code });

/** Writes frames of one direction: `kind` is "rpc" on a desktop, "evt" on the daemon. */
export function createFrameWriter(kind) {
  const head = Buffer.from(`{"t":${JSON.stringify(kind)},"frame":`);
  let lastId = 0;
  return {
    /** The UTF-8 message texts that carry one frame (`json`, its JSON text), each ready for channel.sealEncoded. */
    write(json) {
      const bytes = Buffer.from(json, "utf8");
      if (bytes.length > MAX_FRAME_BYTES)
        throw Object.assign(peerError("FRAME_TOO_LARGE", `The message is ${megabytes(bytes.length)}, over the ${megabytes(MAX_FRAME_BYTES)} frame limit`), {
          bytes: bytes.length,
        });
      if (bytes.length <= PART_THRESHOLD) return [Buffer.concat([head, bytes, CLOSE_BRACE])];
      const id = ++lastId;
      const n = Math.ceil(bytes.length / PIECE_BYTES);
      const parts = [];
      for (let i = 0; i < n; i++) {
        const data = bytes.subarray(i * PIECE_BYTES, (i + 1) * PIECE_BYTES).toString("base64");
        parts.push(Buffer.from(`{"t":"part","id":${id},"i":${i},"n":${n},"data":"${data}"}`));
      }
      return parts;
    },
  };
}

/** Reads frames of one direction: `kind` is "rpc" on the daemon, "evt" on a desktop. */
export function createFrameReader(kind, { maxBytes = MAX_FRAME_BYTES } = {}) {
  let partial = null; // { id, n, pieces, size } while a split frame arrives
  const refuse = (code, message) => {
    partial = null;
    return peerError(code, message);
  };
  return {
    /** The frame `message` completes, or null while parts are still arriving. Throws (with a code) on a broken one. */
    read(message) {
      if (message?.t === kind) {
        if (partial) throw refuse("BAD_PART", "A frame's parts were interrupted");
        return { frame: message.frame };
      }
      if (message?.t !== "part") throw refuse("BAD_PART", "Not a frame");
      const { id, i, n, data } = message;
      if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(i) || !Number.isSafeInteger(n) || n < 2 || typeof data !== "string")
        throw refuse("BAD_PART", "Malformed part");
      if (n > Math.ceil(maxBytes / PIECE_BYTES)) throw refuse("FRAME_TOO_LARGE", `A frame of ${n} parts is over the ${megabytes(maxBytes)} frame limit`);
      if (partial ? id !== partial.id || n !== partial.n || i !== partial.pieces.length : i !== 0) throw refuse("BAD_PART", "Parts arrived out of order");
      if (data.length > MAX_DATA || data.length % 4 !== 0 || !BASE64.test(data)) throw refuse("BAD_PART", "Malformed part");
      const piece = Buffer.from(data, "base64");
      partial ??= { id, n, pieces: [], size: 0 };
      partial.size += piece.length;
      if (partial.size > maxBytes) throw refuse("FRAME_TOO_LARGE", `The frame is over the ${megabytes(maxBytes)} frame limit`);
      partial.pieces.push(piece);
      if (partial.pieces.length < partial.n) return null;
      const { pieces, size } = partial;
      partial = null;
      try {
        return { frame: JSON.parse(Buffer.concat(pieces, size).toString("utf8")) };
      } catch {
        throw peerError("INVALID_REQUEST", "Expected a JSON frame");
      }
    },
    /** Whether a split frame is half received. */
    pending: () => partial !== null,
  };
}
```

Create `packages/shared/src/peer-frames.d.mts`:

```ts
export const PART_THRESHOLD: number;
export const PIECE_BYTES: number;
export const MAX_FRAME_BYTES: number;
export const MAX_PARTS: number;
export type PeerMessageKind = "rpc" | "evt";
export type PeerFrameErrorCode = "FRAME_TOO_LARGE" | "BAD_PART" | "INVALID_REQUEST";
export type FrameWriter = {
  /** The UTF-8 message texts that carry one frame, each ready for Channel.sealEncoded. Throws FRAME_TOO_LARGE past 16 MiB. */
  write(json: string): Uint8Array[];
};
export type FrameReader = {
  /** The frame a message completes, or null while parts still arrive. Throws an Error with a PeerFrameErrorCode `code`. */
  read(message: unknown): { frame: unknown } | null;
  pending(): boolean;
};
export function createFrameWriter(kind: PeerMessageKind): FrameWriter;
export function createFrameReader(kind: PeerMessageKind, options?: { maxBytes?: number }): FrameReader;
```

In `packages/shared/package.json`, add after the `"./relay-rpc"` entry of `exports`:

```json
    "./peer-frames": {
      "types": "./src/peer-frames.d.mts",
      "default": "./src/peer-frames.mjs"
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/shared/src/peer-frames.test.mjs && node -e 'require("@milagre/shared/peer-frames")' && npm run typecheck --workspace @milagre/shared`
Expected: PASS, the `require` prints nothing, typecheck clean.

- [ ] **Step 5: Commit**

```bash
npx oxfmt packages/shared/src/peer-frames.mjs packages/shared/src/peer-frames.d.mts packages/shared/src/peer-frames.test.mjs packages/shared/package.json
git add packages/shared/src/peer-frames.mjs packages/shared/src/peer-frames.d.mts packages/shared/src/peer-frames.test.mjs packages/shared/package.json
git commit -m "feat(shared): rpc, evt and part messages for paired desktops"
```

---

### Task 3: A desktop's daemon connection over a channel

**Files:**
- Create: `apps/daemon/src/peer-channel.cjs`
- Test: `apps/daemon/src/peer-channel.test.cjs`

**Interfaces:**
- Consumes: `createFrameReader`, `createFrameWriter`, `MAX_FRAME_BYTES` (Task 2); `Channel.sealEncoded` (Task 1); the carrier contract of `acceptConnection` (`server.cjs:383-392`): `{ send(message, json, bytes) -> boolean, end(), destroy(), isClosed() }` in, `{ receive(request), invalid(error), close() }` out.
- Produces: `openPeerChannel({ openPeer, channel, deliver, queued, isOpen, drop, budget? }) -> { receive(message), close() }` and `PEER_BUDGET` (32 MiB).
  - `openPeer(carrier)`: returns the daemon connection (server.cjs passes `acceptConnection` with `peerPolicy`).
  - `deliver(sealed: Uint8Array)`: hands one sealed message to the carrier for this desktop.
  - `queued(): number`: bytes the carrier holds unsent toward this desktop.
  - `isOpen(): boolean`, `drop()`: whether the channel stands; close it (the carrier then calls `close()`).
  - `receive(message)`: one opened message. `ping` gets `pong`; `rpc`/`part` go through the reader to the connection (a reader error goes to `connection.invalid`, which answers and ends); anything else throws `Error("Unknown message")` for the carrier to drop the channel.

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/src/peer-channel.test.cjs`:

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { boxKeyPair, phoneHello, hostAccept, phoneFinish } = require("@milagre/shared/relay-crypto");
const { createFrameReader, createFrameWriter, MAX_FRAME_BYTES, PART_THRESHOLD } = require("@milagre/shared/peer-frames");
const protocol = require("./protocol.cjs");
const { openPeerChannel, PEER_BUDGET } = require("./peer-channel.cjs");
const { random, TOKEN } = require("./relay-test-kit.cjs");

/** Both ends of one encrypted channel: the Mac's and the desktop's. */
function channelPair() {
  const host = boxKeyPair(random);
  const device = boxKeyPair(random);
  const { message, ephemeral } = phoneHello({ phone: device, host: host.publicKey, token: TOKEN, random, kind: "desktop" });
  const accepted = hostAccept({ host, hello: message, isKnown: () => false, canPair: true, token: TOKEN, random });
  return { mac: accepted.channel, desktop: phoneFinish({ ephemeral, phone: device, host: host.publicKey, reply: accepted.reply }) };
}

/** A desktop's messages for one request, as it would send them. */
const rpcMessages = (json) =>
  createFrameWriter("rpc")
    .write(json)
    .map((text) => JSON.parse(Buffer.from(text).toString("utf8")));

/**
 * One desktop channel on a fake carrier, with a fake daemon connection that answers invalid() as acceptConnection does.
 * `out`: what the desktop read, opened. `state.frames`: what reached the daemon.
 */
function harness({ queued = () => 0 } = {}) {
  const { mac, desktop } = channelPair();
  const out = [];
  const state = { open: true, dropped: 0, closed: 0, frames: [], invalid: [] };
  let carrier;
  const peer = openPeerChannel({
    openPeer(given) {
      carrier = given;
      return {
        receive: (frame) => state.frames.push(frame),
        invalid(error) {
          state.invalid.push(error.code);
          carrier.send({ v: 1, id: null, error: { code: error.code, message: error.message } });
          carrier.end();
        },
        close: () => state.closed++,
      };
    },
    channel: mac,
    deliver: (sealed) => out.push(desktop.open(sealed)),
    queued,
    isOpen: () => state.open,
    drop: () => {
      state.open = false;
      state.dropped++;
    },
  });
  return { peer, carrier, out, state };
}

test("an rpc message reaches the daemon connection, and its reply goes back as one evt message", () => {
  const { peer, carrier, out, state } = harness();
  peer.receive({ t: "rpc", frame: { v: 1, id: 1, method: "daemon:status", args: [] } });
  assert.deepEqual(state.frames, [{ v: 1, id: 1, method: "daemon:status", args: [] }]);
  assert.equal(carrier.send(null, '{"v":1,"id":1,"result":{"ok":true}}'), true);
  assert.equal(carrier.send({ v: 1, event: { channel: "project:state", payload: {}, seq: 1 } }), true);
  assert.deepEqual(out, [
    { t: "evt", frame: { v: 1, id: 1, result: { ok: true } } },
    { t: "evt", frame: { v: 1, event: { channel: "project:state", payload: {}, seq: 1 } } },
  ]);
});

test("a request in parts reaches the connection whole, and a reply over 768 KiB goes back in parts", () => {
  const { peer, carrier, out, state } = harness();
  const text = "ação🙂".repeat(100_000);
  for (const message of rpcMessages(JSON.stringify({ v: 1, id: 2, method: "echo", args: [text] }))) peer.receive(message);
  assert.deepEqual(state.frames, [{ v: 1, id: 2, method: "echo", args: [text] }]);
  carrier.send({ v: 1, id: 2, result: text });
  assert.ok(out.length > 1 && out.every((message) => message.t === "part"));
  const reader = createFrameReader("evt");
  assert.deepEqual(out.map((message) => reader.read(message)).at(-1), { frame: { v: 1, id: 2, result: text } });
});

test("ping gets pong, and a message outside the protocol throws for the carrier to drop the channel", () => {
  const { peer, out, state } = harness();
  peer.receive({ t: "ping" });
  assert.deepEqual(out, [{ t: "pong" }]);
  for (const message of [
    { t: "req", id: 1, method: "POST", path: "/rpc", headers: {}, chunk: "", more: false },
    { t: "live-open", id: 1, path: "/live" },
    { t: "evt", frame: {} },
    null,
  ])
    assert.throws(() => peer.receive(message), /Unknown message/);
  assert.deepEqual(state.frames, []);
});

test("a broken or oversized part answers with its error code and drops the channel", () => {
  const { peer, out, state } = harness();
  const parts = rpcMessages(JSON.stringify({ v: 1, id: 3, method: "echo", args: ["x".repeat(PART_THRESHOLD)] }));
  peer.receive(parts[1]);
  assert.deepEqual(state.invalid, ["BAD_PART"]);
  assert.equal(out.at(-1).frame.error.code, "BAD_PART");
  assert.equal(state.dropped, 1);
  const big = harness();
  big.peer.receive({ ...parts[0], n: 33 });
  assert.deepEqual(big.state.invalid, ["FRAME_TOO_LARGE"]);
  assert.equal(big.state.dropped, 1);
});

test("a reply over 16 MiB throws FRAME_TOO_LARGE, as the socket's send does, and sends nothing", () => {
  const { carrier, out } = harness();
  assert.throws(() => carrier.send(null, JSON.stringify("x".repeat(MAX_FRAME_BYTES))), { code: "FRAME_TOO_LARGE" });
  assert.deepEqual(out, []);
});

test("a desktop that falls behind by the budget is dropped instead of queued without end", () => {
  const { carrier, out, state } = harness({ queued: () => PEER_BUDGET - 100 });
  assert.equal(carrier.send({ v: 1, event: { channel: "project:state", payload: "y".repeat(200), seq: 1 } }), false);
  assert.deepEqual(out, []);
  assert.equal(state.dropped, 1);
  assert.equal(PEER_BUDGET, 2 * MAX_FRAME_BYTES);
});

test("once the channel is gone, sends return false and nothing goes out; end and destroy drop it; close closes the connection", () => {
  const { peer, carrier, out, state } = harness();
  carrier.end();
  carrier.destroy();
  assert.equal(state.dropped, 2);
  assert.equal(carrier.isClosed(), true);
  assert.equal(carrier.send({ v: 1, id: 1, result: null }), false);
  assert.deepEqual(out, []);
  peer.close();
  assert.equal(state.closed, 1);
});

test("the channel's frame limit is the daemon's", () => {
  assert.equal(MAX_FRAME_BYTES, protocol.MAX_FRAME_BYTES);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/daemon/src/peer-channel.test.cjs`
Expected: FAIL with `Cannot find module './peer-channel.cjs'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/daemon/src/peer-channel.cjs`:

```js
const { createFrameReader, createFrameWriter, MAX_FRAME_BYTES } = require("@milagre/shared/peer-frames");

// What a paired desktop may leave unsent before its channel is dropped: what wire() lets a socket queue (protocol.cjs).
const PEER_BUDGET = 2 * MAX_FRAME_BYTES;
const PONG = new TextEncoder().encode('{"t":"pong"}');

/**
 * A paired desktop on an encrypted channel: one daemon connection (`openPeer`, which is acceptConnection with the
 * paired-desktop policy) whose frames travel as rpc / evt / part messages (@milagre/shared/peer-frames).
 * `deliver(sealed)` hands one sealed message to the carrier; `queued()` is how many bytes the carrier holds unsent
 * toward this desktop; `isOpen()` says whether the channel stands; `drop()` closes the channel, after which the carrier
 * calls `close()`. `receive(message)` takes each opened message and throws on one the protocol has no place for, for
 * the carrier to drop the channel.
 */
function openPeerChannel({ openPeer, channel, deliver, queued, isOpen, drop, budget = PEER_BUDGET }) {
  const reader = createFrameReader("rpc");
  const writer = createFrameWriter("evt");
  const connection = openPeer({
    // As wire()'s send: throws FRAME_TOO_LARGE past the frame limit; false once closed, or once dropped for falling behind.
    send(message, json) {
      if (!isOpen()) return false;
      const texts = writer.write(json ?? JSON.stringify(message));
      const size = texts.reduce((total, text) => total + text.length, 0);
      if (queued() + size > budget) {
        drop();
        return false;
      }
      for (const text of texts) deliver(channel.sealEncoded(text));
      return true;
    },
    end: drop,
    destroy: drop,
    isClosed: () => !isOpen(),
  });
  return {
    receive(message) {
      if (message?.t === "ping") {
        deliver(channel.sealEncoded(PONG));
        return;
      }
      if (message?.t !== "rpc" && message?.t !== "part") throw new Error("Unknown message");
      let read;
      try {
        read = reader.read(message);
      } catch (error) {
        // As a socket's framing error: the connection answers with the code, then ends.
        connection.invalid(error);
        return;
      }
      if (read) connection.receive(read.frame);
    },
    close: () => connection.close(),
  };
}

module.exports = { openPeerChannel, PEER_BUDGET };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/daemon/src/peer-channel.test.cjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
npx oxfmt apps/daemon/src/peer-channel.cjs apps/daemon/src/peer-channel.test.cjs
git add apps/daemon/src/peer-channel.cjs apps/daemon/src/peer-channel.test.cjs
git commit -m "feat(daemon): carry a paired desktop's daemon connection over a channel"
```

---

### Task 4: The relay host accepts paired desktops

**Files:**
- Modify: `apps/daemon/src/devices.cjs:95-103` (add `kindOf`)
- Modify: `apps/daemon/src/phone-channels.cjs:1-3, 31-37, 54-99, 225-227, 262-272`
- Modify: `apps/daemon/src/relay-host.cjs:30-45, 70-71`
- Modify: `apps/daemon/src/phone.cjs:268-270` (the hosts' store gets `kindOf`)
- Modify: `apps/daemon/src/relay-test-kit.cjs` (add `startLocalRelay`, `connectDesktop`, `fakePeerDaemon`)
- Test: `apps/daemon/src/devices.test.cjs`, `apps/daemon/src/relay-host.test.cjs`

**Interfaces:**
- Consumes: `openPeerChannel` (Task 3); `createFrameReader`/`createFrameWriter` (Task 2); `sealEncoded` (Task 1).
- Produces:
  - Devices store: `kindOf(key): "phone" | "computer" | null`.
  - `createPhoneChannels({ ..., openPeer })` and `startRelayHost({ ..., openPeer })`. A carrier session may define `queued(conn): number`; the relay's is its socket's `bufferedAmount`.
  - Hello rules: `kind: "desktop"` is stored as `"computer"`; refused `{ t: "error", code: "bad-hello", reason: "kind" }` when the host has no `openPeer`, or when a known key's stored kind differs from the hello's. Once open, a desktop's messages go to its peer channel only (no `req`, no `live-open`).
  - Test kit: `startLocalRelay(t, { autoPong?, hostBehavior? }) -> { url, hostSockets }`; `connectDesktop({ relayUrl, identity, token?, key?, name? }) -> { key, ws, closed, messages, frames, error, hello(), call(method, args?, ms?), event(channel, match?, ms?), sendFrame(frame), sendMessage(message), close() }`; `fakePeerDaemon() -> { connections, openPeer }` (answers each request `{ v: 1, id, result: { echo: args } }`).

- [ ] **Step 1: Write the failing tests**

In `apps/daemon/src/devices.test.cjs`, append:

```js
test("kindOf says what a device paired as, and null for a key that isn't paired", async () => {
  const dir = await tmp("devices-kind");
  const devices = createDevices(dir, { now: () => 1 });
  await devices.add("phoneA");
  await devices.add("macB", { kind: "computer", name: "studio" });
  assert.equal(devices.kindOf("phoneA"), "phone");
  assert.equal(devices.kindOf("macB"), "computer");
  assert.equal(devices.kindOf("nobody"), null);
  await devices.remove("macB");
  assert.equal(devices.kindOf("macB"), null);
});
```

In `apps/daemon/src/relay-host.test.cjs`:

1. Delete the `startRelay` function (the block from `/** Plays the Cloudflare Worker: real sockets, the real room logic. */` to its closing `}` before `async function startMac`), delete the now-unused `const http = require("node:http");` and `const { WebSocketServer } = require("ws");`, and replace the kit import with:

```js
const {
  random,
  TOKEN,
  LIVE_ORIGIN,
  sleep,
  listen,
  until,
  startFakeBridge,
  connectPhone,
  connectDesktop,
  fakePeerDaemon,
  startLocalRelay: startRelay,
} = require("./relay-test-kit.cjs");
```

2. Give `startMac` an `openPeer` option and pass it on:

```js
async function startMac(t, { relayUrl, bridgeUrl, canPair = () => false, token = TOKEN, timing, onStatus, openPeer } = {}) {
```

and in its `startRelayHost({ ... })` call add `openPeer,` after `timing,`.

3. Append:

```js
test("a desktop pairs in the window as a computer, and its frames reach the daemon and come back, in parts past 768 KiB", async (t) => {
  const daemon = fakePeerDaemon();
  const { relay, mac } = await paired(t, { mac: { openPeer: daemon.openPeer } });
  const desktop = connectDesktop({ relayUrl: relay.url, identity: mac.identity, name: "studio" });
  t.after(() => desktop.close());
  assert.ok((await desktop.hello()).channel);
  const id = b64url(desktop.key.publicKey);
  assert.deepEqual(
    mac.phones.list().map((device) => [device.key, device.kind, device.name]),
    [[id, "computer", "studio"]],
  );
  assert.deepEqual(mac.host.connectedKeys(), [id]);
  assert.deepEqual((await desktop.call("daemon:status")).result, { echo: [] });
  // Both ways through the real room, whose frames stop at 1 MiB.
  const big = "ação🙂".repeat(150_000);
  assert.deepEqual((await desktop.call("echo", [big])).result, { echo: [big] });
  assert.ok(desktop.messages.filter((message) => message.t === "part").length >= 3, "the reply came in parts");
  desktop.sendMessage({ t: "ping" });
  await until(() => desktop.messages.some((message) => message.t === "pong"), "pong");
  assert.equal(desktop.error, null);
});

test("a desktop cannot speak HTTP-over-channel: a req closes its channel and its daemon connection", async (t) => {
  const daemon = fakePeerDaemon();
  const { relay, bridge, mac } = await paired(t, { mac: { openPeer: daemon.openPeer } });
  const desktop = connectDesktop({ relayUrl: relay.url, identity: mac.identity });
  t.after(() => desktop.close());
  assert.ok((await desktop.hello()).channel);
  desktop.sendMessage({ t: "req", id: 1, method: "POST", path: "/rpc", headers: {}, chunk: "", more: false });
  await desktop.closed;
  await until(() => daemon.connections[0].closed, "the daemon connection closed");
  assert.equal(bridge.seen.requests.length, 0, "nothing reached the bridge");
});

test("a device keeps the kind it paired as: a phone's key saying desktop, and a computer's saying phone, are turned away", async (t) => {
  const daemon = fakePeerDaemon();
  const { relay, mac, connect } = await paired(t, { mac: { openPeer: daemon.openPeer } });
  const phone = await connect();
  const asDesktop = connectDesktop({ relayUrl: relay.url, identity: mac.identity, key: phone.key });
  t.after(() => asDesktop.close());
  assert.deepEqual(await asDesktop.hello(), { error: { t: "error", code: "bad-hello", reason: "kind" } });
  assert.equal(daemon.connections.length, 0);
  const computer = boxKeyPair(random);
  await mac.phones.add(b64url(computer.publicKey), { kind: "computer", name: "studio" });
  const asPhone = connectPhone({ relayUrl: relay.url, identity: mac.identity, key: computer });
  t.after(() => asPhone.close());
  assert.deepEqual(await asPhone.hello(), { error: { t: "error", code: "bad-hello", reason: "kind" } });
  assert.deepEqual(
    mac.phones.list().map((device) => device.kind),
    ["phone", "computer"],
    "both stay as they paired",
  );
});

test("dropping a desktop's key closes its channel and its daemon connection", async (t) => {
  const daemon = fakePeerDaemon();
  const { relay, mac } = await paired(t, { mac: { openPeer: daemon.openPeer } });
  const desktop = connectDesktop({ relayUrl: relay.url, identity: mac.identity });
  t.after(() => desktop.close());
  assert.ok((await desktop.hello()).channel);
  mac.host.drop(b64url(desktop.key.publicKey));
  assert.equal((await desktop.closed).code, 1000);
  assert.equal(daemon.connections[0].closed, true);
  assert.deepEqual(mac.host.connectedKeys(), []);
});

test("losing the relay closes every desktop's daemon connection", async (t) => {
  const daemon = fakePeerDaemon();
  const { relay, mac } = await paired(t, { mac: { openPeer: daemon.openPeer } });
  const desktop = connectDesktop({ relayUrl: relay.url, identity: mac.identity });
  t.after(() => desktop.close());
  assert.ok((await desktop.hello()).channel);
  relay.hostSockets[0].terminate();
  await until(() => daemon.connections[0].closed, "closed with the relay");
});

test("a desktop outside the pairing window gets unknown-phone and is saved nowhere", async (t) => {
  const daemon = fakePeerDaemon();
  const { relay, mac } = await paired(t, { mac: { openPeer: daemon.openPeer, canPair: () => false } });
  const desktop = connectDesktop({ relayUrl: relay.url, identity: mac.identity });
  t.after(() => desktop.close());
  assert.deepEqual(await desktop.hello(), { error: { t: "error", code: "unknown-phone" } });
  assert.equal(mac.phones.count(), 0);
  assert.equal(daemon.connections.length, 0);
});
```

The existing test "a desktop's hello is turned away with reason kind and saved nowhere" stays as it is: its Mac has no `openPeer`, which is still refused.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/daemon/src/devices.test.cjs apps/daemon/src/relay-host.test.cjs`
Expected: FAIL: `devices.kindOf is not a function`, and in relay-host `startRelay is not a function` (the kit has no `startLocalRelay` yet).

- [ ] **Step 3: Write the implementation**

`apps/daemon/src/devices.cjs`, in the returned object after `removedAt`:

```js
    /** The kind a device paired as ("phone" or "computer"), or null when it isn't paired. */
    kindOf: (key) => find(key)?.kind ?? null,
```

`apps/daemon/src/phone-channels.cjs`:

Add after the `relay-rpc` require:

```js
const { openPeerChannel } = require("./peer-channel.cjs");
```

Replace the doc comment and signature of `createPhoneChannels` with:

```js
/**
 * One encrypted channel per device, whatever carries its bytes: the public relay (frames multiplexed on the Mac's
 * relay socket) or the LAN listener (one socket per device). A `session` is `{ conns, send(bytes), queued?(conn) }`;
 * `send` takes a whole frame (type, conn id, payload) and delivers it to that device, and `queued` says how many bytes
 * it holds unsent toward one. `send` must also handle CLOSE frames: the channel emits them (after a refusal, or when it
 * drops a connection) and the carrier has to close that device's socket.
 * A phone speaks HTTP-over-channel to the loopback bridge. A desktop (hello `kind: "desktop"`, saved as a "computer")
 * is one more client of the daemon instead: `openPeer(carrier)` opens its connection and peer-channel.cjs carries its
 * frames. Without `openPeer` desktops are turned away. `phones` is the devices store (`isKnown`, `kindOf`, `add`, `seen`).
 */
function createPhoneChannels({ identity, phones, token, bridgeUrl, canPair, retired = false, WebSocket, fetch: fetchBridge, random, helloMs, openPeer }) {
```

In `dropConn`, after `closeLives(record);` add:

```js
    // A desktop's daemon connection goes with its channel.
    record.peer?.close();
```

Replace `hello` with:

```js
  async function hello(current, conn, record, bytes) {
    record.state = "accepting";
    // Nothing to decrypt: whoever dials a retired room only needs to hear that the Mac was reset.
    if (retired) return refuse(current, conn, "bad-token", { reason: "reset" });
    let accepted;
    try {
      accepted = hostAccept({ host: identity.box, hello: bytes, isKnown: (id) => phones.isKnown(id), canPair: (id) => !!canPair(id), token, random });
    } catch (error) {
      if (error instanceof RelayAuthError) return refuse(current, conn, error.code);
      return refuse(current, conn, "bad-hello");
    }
    // The hello says "desktop"; the store says "computer".
    const kind = accepted.kind === "desktop" ? "computer" : "phone";
    // A desktop drives the daemon itself. A host with no daemon to hand it (a confined demo) turns it away unsaved.
    if (kind === "computer" && !openPeer) return refuse(current, conn, "bad-hello", { reason: "kind" });
    // A device keeps the kind it paired as: a phone's key saying "desktop" would trade the bridge's allow-list for the
    // whole daemon.
    const stored = accepted.firstPairing ? null : phones.kindOf(accepted.phoneKey);
    if (stored && stored !== kind) return refuse(current, conn, "bad-hello", { reason: "kind" });
    // Set before any wait, so a removal that lands meanwhile finds this channel.
    record.key = accepted.phoneKey;
    if (accepted.firstPairing) {
      try {
        await phones.add(accepted.phoneKey, { kind, name: accepted.name });
      } catch {
        return dropConn(current, conn, true);
      }
    } else {
      // When it was last here, and its name if it changed. A failed write never closes a known device's channel.
      void Promise.resolve(phones.seen?.(accepted.phoneKey, { name: accepted.name })).catch(() => {});
    }
    if (current.conns.get(conn) !== record) return;
    record.channel = accepted.channel;
    record.state = "open";
    clearTimeout(record.helloTimer);
    sendFrame(current, DATA, conn, accepted.reply);
    if (kind === "computer")
      record.peer = openPeerChannel({
        openPeer,
        channel: record.channel,
        deliver: (sealed) => sendFrame(current, DATA, conn, sealed),
        queued: () => current.queued?.(conn) ?? 0,
        isOpen: () => current.conns.get(conn) === record,
        drop: () => dropConn(current, conn, true),
      });
  }
```

At the top of `handleMessage`, after the `if (!message || typeof message !== "object")` line:

```js
    // A desktop's channel speaks peer messages only (peer-channel.cjs), never HTTP-over-channel.
    if (record.peer) return record.peer.receive(message);
```

In the `record` built for an `OPEN` frame in `onFrame`, add `peer: null,` after `key: null,`.

`apps/daemon/src/relay-host.cjs`: add `openPeer,` to the destructured options of `startRelayHost` (after `timing,`), pass it on:

```js
  const channels = createPhoneChannels({ identity, phones, token, bridgeUrl, canPair, retired, WebSocket, fetch: fetchBridge, random, helloMs, openPeer });
```

and after `current.send = (bytes) => sendRaw(current, bytes);` add:

```js
    // Every channel shares this socket, so a desktop that stops reading is measured by what it holds in all.
    current.queued = () => current.socket.bufferedAmount;
```

`apps/daemon/src/phone.cjs`, in the `phones` object built in `launch()`, add after `isKnown`:

```js
        kindOf: (id) => known.kindOf(id),
```

`apps/daemon/src/relay-test-kit.cjs`:

Add to the requires:

```js
const { createFrameReader, createFrameWriter } = require("@milagre/shared/peer-frames");
```

Add, before `module.exports` (the first function is moved verbatim from `relay-host.test.cjs`):

```js
/** Plays the Cloudflare Worker: real sockets, the real room logic. */
async function startLocalRelay(t, { autoPong = true, hostBehavior } = {}) {
  const { createRoom } = await import("../../relay/src/room.mjs");
  const rooms = new Map();
  const roomFor = (id) => {
    if (!rooms.has(id)) rooms.set(id, createRoom({ id }));
    return rooms.get(id);
  };
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true, autoPong });
  const hostSockets = [];
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, "http://relay");
    const id = url.searchParams.get("id");
    wss.handleUpgrade(request, socket, head, (ws) => {
      const room = roomFor(id);
      const payload = (data, isBinary) => (isBinary ? data : data.toString());
      if (url.pathname === "/v1/host") {
        const index = hostSockets.length;
        hostSockets.push(ws);
        if (hostBehavior?.(ws, index)) return;
        ws.on("message", (data, isBinary) => room.hostMessage(ws, payload(data, isBinary)));
        ws.on("close", () => room.hostClosed(ws));
        room.hostOpened(ws);
      } else {
        ws.on("message", (data, isBinary) => room.phoneMessage(ws, payload(data, isBinary)));
        ws.on("close", () => room.phoneClosed(ws));
        room.phoneOpened(ws);
      }
    });
  });
  const port = await listen(server);
  t.after(() => {
    for (const client of wss.clients) client.terminate();
    server.close();
  });
  return { url: `ws://127.0.0.1:${port}`, hostSockets };
}

/**
 * A paired desktop over a raw relay or LAN socket: its hello says kind "desktop", then daemon frames travel as rpc,
 * evt and part messages (@milagre/shared/peer-frames). `messages` keeps every message the Mac sent, parts included;
 * `frames` every daemon frame they carried; `error` the first message it could not read.
 */
function connectDesktop({ relayUrl, identity, token = TOKEN, key = boxKeyPair(random), name = "studio" }) {
  const ws = new WebSocket(`${relayUrl}/v1/phone?id=${identity.hostId}`);
  const reader = createFrameReader("evt");
  const writer = createFrameWriter("rpc");
  const messages = [];
  const frames = [];
  const watchers = new Set();
  const early = []; // sealed messages that came in one chunk with the hello's reply
  let channel = null;
  let onReply = null;
  let nextId = 0;
  const closed = new Promise((resolve) => ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() })));
  const opened = new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  function take(bytes) {
    try {
      const message = channel.open(bytes);
      messages.push(message);
      if (message.t === "pong") return;
      const read = reader.read(message);
      if (!read) return;
      frames.push(read.frame);
      for (const watcher of [...watchers]) watcher(read.frame);
    } catch (error) {
      desktop.error ??= error;
      ws.terminate();
    }
  }
  ws.on("message", (data) => {
    const bytes = new Uint8Array(data);
    if (channel) take(bytes);
    else if (onReply) onReply(bytes);
    else early.push(bytes);
  });
  function waitFrame(match, ms = 5000) {
    const found = frames.find(match);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      let timer;
      const watch = (frame) => {
        if (!match(frame)) return;
        clearTimeout(timer);
        watchers.delete(watch);
        resolve(frame);
      };
      timer = setTimeout(() => {
        watchers.delete(watch);
        reject(new Error("Timed out waiting for a daemon frame"));
      }, ms);
      watchers.add(watch);
    });
  }
  const desktop = {
    ws,
    key,
    closed,
    messages,
    frames,
    error: null,
    /** Resolves with the channel, or with { error } when the Mac refused the hello. */
    async hello() {
      await opened;
      const { message, ephemeral } = phoneHello({ phone: key, host: identity.box.publicKey, token, random, name, kind: "desktop" });
      const reply = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for the hello's reply")), 5000);
        onReply = (bytes) => {
          clearTimeout(timer);
          onReply = null;
          resolve(bytes);
        };
        ws.send(message);
      });
      if (reply[0] === 0x04) return { error: JSON.parse(new TextDecoder().decode(reply.subarray(1))) };
      channel = phoneFinish({ ephemeral, phone: key, host: identity.box.publicKey, reply });
      for (const bytes of early.splice(0)) take(bytes);
      return { channel };
    },
    /** Sends one daemon frame as a desktop does: whole, or in parts past 768 KiB. */
    sendFrame(frame) {
      for (const text of writer.write(JSON.stringify(frame))) ws.send(channel.sealEncoded(text));
    },
    sendMessage(message) {
      ws.send(channel.seal(message));
    },
    /** Calls a daemon method and resolves with its reply frame ({ result } or { error }). */
    call(method, args = [], ms) {
      const id = ++nextId;
      desktop.sendFrame({ v: 1, id, method, args });
      return waitFrame((frame) => frame.id === id, ms);
    },
    /** The first event on `name` whose payload `match` accepts, already received or still to come. */
    event(name, match = () => true, ms) {
      return waitFrame((frame) => frame.event?.channel === name && match(frame.event.payload), ms);
    },
    close() {
      ws.terminate();
    },
  };
  return desktop;
}

/** Stands in for the daemon behind a desktop's channel: answers every request with its args, and records each connection. */
function fakePeerDaemon() {
  const connections = [];
  return {
    connections,
    openPeer(carrier) {
      const connection = { carrier, frames: [], closed: false };
      connections.push(connection);
      return {
        receive(frame) {
          connection.frames.push(frame);
          carrier.send({ v: 1, id: frame.id, result: { echo: frame.args } });
        },
        invalid(error) {
          carrier.send({ v: 1, id: null, error: { code: error.code, message: error.message } });
          carrier.end();
        },
        close() {
          connection.closed = true;
        },
      };
    },
  };
}
```

and replace the kit's `module.exports` with:

```js
module.exports = {
  random,
  TOKEN,
  LIVE_ORIGIN,
  sleep,
  listen,
  until,
  startFakeBridge,
  connectPhone,
  startLocalRelay,
  connectDesktop,
  fakePeerDaemon,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/daemon/src/devices.test.cjs apps/daemon/src/relay-host.test.cjs apps/daemon/src/phone.test.cjs`
Expected: PASS (every test, the old relay-host ones included).

- [ ] **Step 5: Commit**

```bash
npx oxfmt apps/daemon/src/devices.cjs apps/daemon/src/devices.test.cjs apps/daemon/src/phone-channels.cjs apps/daemon/src/relay-host.cjs apps/daemon/src/phone.cjs apps/daemon/src/relay-test-kit.cjs apps/daemon/src/relay-host.test.cjs
git add apps/daemon/src/devices.cjs apps/daemon/src/devices.test.cjs apps/daemon/src/phone-channels.cjs apps/daemon/src/relay-host.cjs apps/daemon/src/phone.cjs apps/daemon/src/relay-test-kit.cjs apps/daemon/src/relay-host.test.cjs
git commit -m "feat(daemon): accept paired desktops through the relay"
```

---

### Task 5: The LAN host carries known desktops

**Files:**
- Modify: `apps/daemon/src/lan-host.cjs:43-77`
- Test: `apps/daemon/src/lan-host.test.cjs`

**Interfaces:**
- Consumes: `createPhoneChannels({ ..., openPeer })` and the session's `queued(conn)` (Task 4); `connectDesktop`, `fakePeerDaemon` (Task 4's kit).
- Produces: `startLanHost({ ..., openPeer })`. Its session's `queued(conn)` is that device's socket `bufferedAmount`. The LAN still never pairs: an unknown desktop is `unknown-phone`.

- [ ] **Step 1: Write the failing tests**

In `apps/daemon/src/lan-host.test.cjs`, change the kit import to:

```js
const { random, startFakeBridge, connectPhone, connectDesktop, fakePeerDaemon, until } = require("./relay-test-kit.cjs");
```

change `lanMac` to take the known device's kind:

```js
async function lanMac(t, { knownPhone = true, knownKind = "phone", ...hostOptions } = {}) {
```

and inside it:

```js
  if (knownPhone) await phones.add(b64url(key.publicKey), { kind: knownKind });
```

Append:

```js
test("a known computer speaks rpc over the LAN, in parts past 768 KiB, and closing the host closes its daemon connection", async (t) => {
  const daemon = fakePeerDaemon();
  const { identity, key, host, url } = await lanMac(t, { knownKind: "computer", openPeer: daemon.openPeer });
  const desktop = connectDesktop({ relayUrl: url, identity, key });
  t.after(() => desktop.close());
  assert.ok((await desktop.hello()).channel);
  assert.deepEqual(host.connectedKeys(), [b64url(key.publicKey)]);
  const big = "ação🙂".repeat(150_000);
  assert.deepEqual((await desktop.call("echo", [big])).result, { echo: [big] });
  await host.close();
  await desktop.closed;
  assert.equal(daemon.connections[0].closed, true);
});

test("an unknown desktop is refused on the LAN, which never pairs", async (t) => {
  const daemon = fakePeerDaemon();
  const { identity, url } = await lanMac(t, { knownPhone: false, openPeer: daemon.openPeer });
  const desktop = connectDesktop({ relayUrl: url, identity });
  t.after(() => desktop.close());
  assert.deepEqual((await desktop.hello()).error, { t: "error", code: "unknown-phone" });
  assert.equal(daemon.connections.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/daemon/src/lan-host.test.cjs`
Expected: FAIL in the computer test with `{ error: { t: "error", code: "bad-hello", reason: "kind" } }` (the LAN host does not pass `openPeer` yet).

- [ ] **Step 3: Write the implementation**

In `apps/daemon/src/lan-host.cjs`, add `openPeer,` to the destructured options of `startLanHost` (after `idleMs = IDLE_MS,`), and pass it on:

```js
  const channels = createPhoneChannels({ identity, phones, token, bridgeUrl, canPair: () => false, WebSocket, fetch, random, helloMs, openPeer });
```

In the `session` object, after `send(bytes) { ... },` add:

```js
    /** What this device's socket holds unsent: bounds a desktop that stopped reading (peer-channel.cjs). */
    queued: (conn) => sockets.get(conn)?.bufferedAmount ?? 0,
```

Update the doc comment's first sentence to say "Phone and paired-desktop access on the local network".

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/daemon/src/lan-host.test.cjs apps/daemon/src/lan-e2e.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npx oxfmt apps/daemon/src/lan-host.cjs apps/daemon/src/lan-host.test.cjs
git add apps/daemon/src/lan-host.cjs apps/daemon/src/lan-host.test.cjs
git commit -m "feat(daemon): carry known desktops on the LAN"
```

---

### Task 6: Phone access hands desktops to its hosts

**Files:**
- Modify: `apps/daemon/src/phone.cjs:29-63` (doc, options), `:209-237` (`startLanFor`, `routes`), `:268-282` (`phones.add`), `:288-300` (`startRelay`), `:356-360` (returned API)
- Test: `apps/daemon/src/phone.test.cjs`

**Interfaces:**
- Consumes: `startRelayHost({ openPeer })`, `startLanHost({ openPeer })` (Tasks 4-5).
- Produces:
  - `createPhone({ ..., openPeer })`: passed to the relay and LAN hosts, never when `allowedRoot` is set.
  - `onPaired({ pairedPhones, kind })` with `kind` `"phone"` or `"computer"` (server.cjs forwards it as the `phone:paired` event).
  - `phone.peerRoutes(): { hostId: string, key: string, lan: string[] }` — the relay identity and the `ws://<ip>:<port>` LAN routes; throws `"Phone access is starting. Try again."` while phone access is not running.

- [ ] **Step 1: Write the failing tests**

In `apps/daemon/src/phone.test.cjs`:

Add requires after the existing ones:

```js
const { b64url } = require("@milagre/shared/relay-crypto");
const { readIdentity } = require("./relay-identity.cjs");
```

Give `fixture` a `phoneOptions` option: add `phoneOptions = {},` to its destructured options, and `...phoneOptions,` as the last entry of the `createPhone({ ... })` call inside `create`.

In the test "status counts the paired phones, and a first pairing is announced once", change the two `paired` assertions to:

```js
  assert.deepEqual(paired, [{ pairedPhones: 1, kind: "phone" }]);
```

```js
  assert.deepEqual(paired, [
    { pairedPhones: 1, kind: "phone" },
    { pairedPhones: 2, kind: "phone" },
  ]);
```

Append:

```js
test("a computer's first pairing is announced with its kind", async (t) => {
  const { phone, relays, paired } = await fixture(t);
  await phone.setEnabled(true);
  await phone.settled();
  await relays[0].options.phones.add("deskA", { kind: "computer", name: "studio" });
  assert.deepEqual(paired, [{ pairedPhones: 1, kind: "computer" }]);
  assert.equal(relays[0].options.phones.kindOf("deskA"), "computer");
});

test("the relay and LAN hosts get openPeer, and a confined phone never hosts a desktop", async (t) => {
  const openPeer = () => ({ receive() {}, invalid() {}, close() {} });
  const open = await fixture(t, { phoneOptions: { openPeer } });
  await open.phone.setEnabled(true);
  await open.phone.settled();
  assert.equal(open.relays[0].options.openPeer, openPeer);
  assert.equal(open.lans[0].options.openPeer, openPeer);
  const confined = await fixture(t, { phoneOptions: { openPeer, allowedRoot: "/tmp/milagre-demo" } });
  await confined.phone.setEnabled(true);
  await confined.phone.settled();
  assert.equal(confined.relays[0].options.openPeer, undefined);
  assert.equal(confined.lans.length, 0);
});

test("peerRoutes names this Mac's relay identity and LAN routes, and refuses while phone access is off", async (t) => {
  const { phone, dataDir } = await fixture(t);
  assert.throws(() => phone.peerRoutes(), /starting/);
  await phone.setEnabled(true);
  await phone.settled();
  const identity = await readIdentity(dataDir);
  assert.deepEqual(phone.peerRoutes(), { hostId: identity.hostId, key: b64url(identity.box.publicKey), lan: ["ws://192.168.1.20:8798"] });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/daemon/src/phone.test.cjs`
Expected: FAIL: `paired` lacks `kind`; `options.openPeer` is `undefined`; `phone.peerRoutes is not a function`.

- [ ] **Step 3: Write the implementation**

In `apps/daemon/src/phone.cjs`:

Add to the doc comment of `createPhone`, after the `allowedRoot` sentence:

```js
 * `openPeer` (server.cjs) opens a paired desktop's daemon connection; the relay and LAN hosts get it unless phone access
 * is confined, since a desktop drives the daemon directly, past the bridge's confinement. `peerRoutes()` tells a paired
 * desktop where to reach this Mac.
```

Add `openPeer,` to the destructured options (after `addresses = lanAddresses,`), and right after `const lanAllowed = ...;`:

```js
  // What the relay and LAN hosts get to serve paired desktops: nothing on a confined phone.
  const peer = openPeer && allowedRoot === undefined ? { openPeer } : {};
```

In `startLanFor`, add `...peer,` as the last entry of the `startLan({ ... })` call. In `launch`, add `...peer,` after `canPair: (key) => mayPair(key),` in the `startRelay({ ... })` call.

In the `phones` object's `add`, replace `onPaired({ pairedPhones: known.count() });` with:

```js
            onPaired({ pairedPhones: known.count(), kind: info?.kind ?? "phone" });
```

Replace `routes` with:

```js
  async function routes(phoneKey) {
    if (typeof phoneKey !== "string" || !PHONE_KEY.test(phoneKey)) throw Object.assign(new Error("Expected this phone's key"), { status: 400 });
    const current = live;
    if (!current) throw Object.assign(new Error("Phone access is starting. Try again."), { status: 409 });
    if (!current.phones.isKnown(phoneKey) && relayPhones.removedAt(phoneKey) === null) await relayPhones.add(phoneKey);
    return routesOf(current);
  }

  /** Where a device finds this Mac: its relay identity and, while the LAN listener runs, its addresses. */
  function routesOf(current) {
    const port = current.lan?.port;
    return { hostId: current.identity.hostId, key: b64url(current.identity.box.publicKey), lan: port ? addresses().map((ip) => `ws://${ip}:${port}`) : [] };
  }
```

In the returned object, after `routes,`:

```js
    /** Asked by a paired desktop over its channel: it has no phone:routes, which the bridge answers. */
    peerRoutes() {
      if (!live) throw Object.assign(new Error("Phone access is starting. Try again."), { status: 409 });
      return routesOf(live);
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/daemon/src/phone.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npx oxfmt apps/daemon/src/phone.cjs apps/daemon/src/phone.test.cjs
git add apps/daemon/src/phone.cjs apps/daemon/src/phone.test.cjs
git commit -m "feat(daemon): hand paired desktops to the relay and LAN hosts, never on a confined phone"
```

---

### Task 7: The daemon serves paired desktops

**Files:**
- Modify: `apps/daemon/src/server.cjs:13-33` (requires, constants), `:302-311` (`broadcast`), `:377-382` (`createPhone`), `:411` (`connection`), `:500-508` (`daemon:status`), `:527-528` (dispatch)
- Test: `apps/daemon/src/connections.test.cjs`

**Interfaces:**
- Consumes: `peerPolicy` (`peer-policy.cjs`, PR 1); `createPhone({ openPeer })`, `phone.peerRoutes()` (Task 6).
- Produces: `daemon:status` `capabilities` include `"desktop-peer-v1"` and `methods` include `"peer:routes"`; `peer:routes` answers `phone.peerRoutes()`; a connection with a policy gets no event whose channel the policy denies (`phone:status`, `phone:paired`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/daemon/src/connections.test.cjs`:

```js
test("a paired desktop hears no phone:* event, which carries the pairing link and its token, and still hears the rest", async (t) => {
  const daemon = await daemonFixture(t);
  const peer = virtualClient(daemon, { policy: peerPolicy });
  const local = virtualClient(daemon);
  await local.call("phone:set-enabled", [true]);
  await waitFor(() => local.events().some((event) => event.channel === "phone:status" && event.payload.state === "on"));
  await daemon.close();
  assert.ok(
    peer.events().some((event) => event.channel === "daemon:stopping"),
    "other events still reach it",
  );
  assert.deepEqual(
    peer.events().filter((event) => event.channel.startsWith("phone:")),
    [],
  );
});

test("daemon:status advertises desktop-peer-v1 and peer:routes, which a paired desktop may call", async (t) => {
  const daemon = await daemonFixture(t);
  const status = (await virtualClient(daemon, { policy: peerPolicy }).call("daemon:status")).result;
  assert.ok(status.capabilities.includes("desktop-peer-v1"));
  assert.ok(status.methods.includes("peer:routes"));
  assert.equal(peerPolicy.denies("peer:routes"), false);
  const reply = await virtualClient(daemon, { policy: peerPolicy }).call("peer:routes");
  assert.deepEqual(reply.error, { code: "COMMAND_FAILED", message: "Phone access is starting. Try again." }, "phone access is off here");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/daemon/src/connections.test.cjs`
Expected: FAIL: the peer's events include `phone:status`; `capabilities` lacks `desktop-peer-v1`.

- [ ] **Step 3: Write the implementation**

In `apps/daemon/src/server.cjs`:

After `const { createExpoPush } = require("./expo-push.cjs");` add:

```js
const { peerPolicy } = require("./peer-policy.cjs");
```

After the `DEVICE_METHODS` constant add:

```js
// A paired desktop's own channel (peer-channel.cjs): rpc / evt / part messages over the relay or the LAN.
const DESKTOP_PEER = "desktop-peer-v1";
// Asked by a paired desktop, which has no phone:* methods: where it can reach this Mac (relay identity, LAN routes).
const PEER_METHODS = Object.freeze(["peer:routes"]);
```

In `broadcast`, as the first statement inside `for (const [key, connection] of clients) {`:

```js
      // A paired desktop hears nothing on a channel it may not call: phone:status carries the pairing link and its token.
      if (connection.policy?.denies(channel)) continue;
```

Replace the `createPhone({ ... })` call with:

```js
  const phone = createPhone({
    dataDir,
    onChange: (status) => broadcast("phone:status", status),
    onPaired: (info) => broadcast("phone:paired", info),
    // Each paired desktop is one more client of this daemon, with the paired-desktop deny set.
    openPeer: (carrier) => acceptConnection({ ...carrier, policy: peerPolicy }),
    ...phoneOptions,
  });
```

In `acceptConnection`, replace `const connection = { send };` with:

```js
    const connection = { send, policy };
```

In `daemon:status`, replace the `capabilities` and `methods` lines with:

```js
            capabilities: ["desktop-v1", "snapshot-pages-v1", "result-pages-v1", "mobile-push-v1", STATE_PATCHES, CHAT_PAGES, SUBAGENT_TAILS, DESKTOP_PEER],
            methods: [...runtime.methods, ...PHONE_METHODS, ...DEVICE_METHODS, ...PUSH_METHODS, ...STATE_METHODS, ...PEER_METHODS].filter(
              (method) => !policy?.denies(method),
            ),
```

After `else if (request.method === "devices:remove") result = await phone.removeDevice(request.args[0]);` add:

```js
        else if (request.method === "peer:routes") result = phone.peerRoutes();
```

Update the `acceptConnection` doc comment's first line to "One client of the daemon, whatever carries its frames: the Unix socket below, and a paired desktop's channel (peer-channel.cjs)."

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/daemon/src/connections.test.cjs apps/daemon/src/server.test.cjs apps/daemon/src/server-devices.test.cjs apps/daemon/src/confine.test.cjs`
Expected: PASS, with `server.test.cjs` unedited.

- [ ] **Step 5: Commit**

```bash
npx oxfmt apps/daemon/src/server.cjs apps/daemon/src/connections.test.cjs
git add apps/daemon/src/server.cjs apps/daemon/src/connections.test.cjs
git commit -m "feat(daemon): serve paired desktops as daemon clients, advertised as desktop-peer-v1"
```

---

### Task 8: End to end: a desktop and a phone, a throwaway daemon and a local relay

**Files:**
- Create: `apps/daemon/src/peer-e2e.test.cjs`

**Interfaces:**
- Consumes: `startDaemon` with `phoneOptions` (`relayUrl`, `localPort`, `lanPort`, `lanHostname`, `addresses`, `now`) and `runtimeOptions.readPullRequests` (`packages/core/src/runtime.cjs:666-668`, echoes the refs it is given); `connect` (`client.cjs`); `readIdentity`; kit `startLocalRelay`, `connectDesktop`, `connectPhone`, `until`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the test**

Create `apps/daemon/src/peer-e2e.test.cjs`:

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { b64url } = require("@milagre/shared/relay-crypto");
const { startDaemon } = require("./server.cjs");
const { connect } = require("./client.cjs");
const { readIdentity } = require("./relay-identity.cjs");
const { startLocalRelay, connectDesktop, connectPhone, until } = require("./relay-test-kit.cjs");

/**
 * A throwaway Mac: its own data folder, a local relay in place of relay.milagre.cloud, the LAN on a port the OS picks
 * on 127.0.0.1, and a clock the test moves (pairing windows). Never Victor's data folder, 8797 or 8798.
 */
async function macWithRelay(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "peer-e2e-")));
  const dataDir = path.join(directory, "profile");
  const project = path.join(directory, "project");
  await fs.mkdir(project);
  const clock = { now: 1_000_000 };
  const sockets = [];
  let daemon;
  let client;
  // Registered before the relay's own hook, so the daemon closes while the relay still answers; the folder goes last.
  t.after(async () => {
    for (const socket of sockets) socket.close();
    client?.close();
    try {
      await daemon?.close();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  const relay = await startLocalRelay(t);
  daemon = await startDaemon({
    dataDir,
    version: "9.8.7",
    runtimeOptions: { cwd: project, environmentReady: Promise.resolve(), titleModels: {}, readPullRequests: async (_worktree, refs) => refs },
    phoneOptions: { relayUrl: relay.url, localPort: 0, lanPort: 0, lanHostname: "127.0.0.1", addresses: () => ["127.0.0.1"], now: () => clock.now },
  });
  client = await connect({ dataDir });
  // Turning phone access on opens the pairing window, as showing the QR in Settings › Devices does.
  await client.call("phone:set-enabled", [true]);
  await until(async () => {
    const status = await client.call("phone:status");
    return status.state === "on" && status.relay === "online";
  }, "phone access on and the relay online");
  const identity = await readIdentity(dataDir);
  const token = JSON.parse(await fs.readFile(path.join(dataDir, "mobile.json"), "utf8")).token;
  /** Dials this Mac with `connectTo` (connectDesktop or connectPhone), through the relay unless `relayUrl` says otherwise. */
  const dial = (connectTo, options = {}) => {
    const socket = connectTo({ relayUrl: relay.url, identity, token, ...options });
    sockets.push(socket);
    return socket;
  };
  return { clock, client, project, identity, dial };
}

test("a desktop pairs through the relay in the pairing window and drives this Mac's daemon, except pairing and devices", async (t) => {
  const mac = await macWithRelay(t);
  const desktop = mac.dial(connectDesktop, { name: "studio" });
  assert.ok((await desktop.hello()).channel);
  const key = b64url(desktop.key.publicKey);
  // Settings › Devices lists it under Computers.
  assert.deepEqual(
    (await mac.client.call("devices:list")).map((device) => [device.key, device.kind, device.name, device.route]),
    [[key, "computer", "studio", "relay"]],
  );

  const status = (await desktop.call("daemon:status")).result;
  assert.equal(status.version, "9.8.7");
  assert.ok(status.capabilities.includes("desktop-peer-v1"));
  assert.ok(status.methods.includes("project:recent"));
  assert.ok(status.methods.includes("peer:routes"));
  for (const denied of ["devices:list", "devices:remove", "phone:status", "phone:open-pairing", "push:register", "daemon:stop"])
    assert.equal(status.methods.includes(denied), false, denied);
  assert.deepEqual((await desktop.call("devices:remove", [key])).error, { code: "NOT_AVAILABLE_REMOTELY", message: "Not available on a remote computer" });
  assert.equal((await mac.client.call("devices:list")).length, 1, "the refused call removed nothing");

  // A change made in this Mac's window reaches the desktop as an event.
  const opened = await mac.client.call("project:open", [mac.project]);
  const chatId = Object.values(opened.state.sessions)[0].id;
  await mac.client.call("chat:patch", [mac.project, chatId, { title: "Set on this Mac" }]);
  await desktop.event("project:state", (payload) => payload.path === mac.project && payload.state?.sessions?.[chatId]?.title === "Set on this Mac");

  // A request and its reply over 768 KiB travel in parts through the relay, and piece boundaries cut characters.
  const big = "ação🙂".repeat(150_000);
  const before = desktop.messages.filter((message) => message.t === "part").length;
  assert.deepEqual((await desktop.call("worktree:pull-requests", [mac.project, [big]])).result, [big]);
  assert.ok(desktop.messages.filter((message) => message.t === "part").length - before >= 3, "the reply came in parts");

  // Opening the pairing window again broadcasts phone:status, with the link and its token: none of it reaches the desktop.
  await mac.client.call("phone:open-pairing");
  await desktop.call("daemon:status");
  assert.deepEqual(
    desktop.frames.filter((frame) => frame.event?.channel?.startsWith("phone:")),
    [],
  );
  assert.equal(desktop.error, null);
});

test("a paired desktop finds the LAN route over the relay and makes a round trip on it", async (t) => {
  const mac = await macWithRelay(t);
  const desktop = mac.dial(connectDesktop);
  assert.ok((await desktop.hello()).channel);
  const routes = (await desktop.call("peer:routes")).result;
  assert.equal(routes.hostId, mac.identity.hostId);
  assert.equal(routes.key, b64url(mac.identity.box.publicKey));
  assert.equal(routes.lan.length, 1);
  assert.match(routes.lan[0], /^ws:\/\/127\.0\.0\.1:\d+$/);
  const lan = mac.dial(connectDesktop, { relayUrl: routes.lan[0], key: desktop.key });
  assert.ok((await lan.hello()).channel);
  assert.equal((await lan.call("daemon:status")).result.version, "9.8.7");
  await until(async () => (await mac.client.call("devices:list"))[0]?.route === "lan", "the device shows on the LAN");
});

test("removing a desktop closes it on the relay and the LAN, and it pairs again only in a window opened later", async (t) => {
  const mac = await macWithRelay(t);
  const desktop = mac.dial(connectDesktop, { name: "studio" });
  assert.ok((await desktop.hello()).channel);
  const lanUrl = (await desktop.call("peer:routes")).result.lan[0];
  const lan = mac.dial(connectDesktop, { relayUrl: lanUrl, key: desktop.key });
  assert.ok((await lan.hello()).channel);
  const key = b64url(desktop.key.publicKey);

  await mac.client.call("devices:remove", [key]);
  assert.equal((await desktop.closed).code, 1000);
  assert.equal((await lan.closed).code, 1000);
  assert.deepEqual(await mac.client.call("devices:list"), []);
  // The window it was removed in is still open; its redial is refused on both routes.
  assert.deepEqual((await mac.dial(connectDesktop, { key: desktop.key }).hello()).error, { t: "error", code: "unknown-phone" });
  assert.deepEqual((await mac.dial(connectDesktop, { relayUrl: lanUrl, key: desktop.key }).hello()).error, { t: "error", code: "unknown-phone" });

  mac.clock.now += 1000;
  await mac.client.call("phone:open-pairing");
  const again = mac.dial(connectDesktop, { key: desktop.key, name: "studio" });
  assert.ok((await again.hello()).channel);
  assert.deepEqual(
    (await mac.client.call("devices:list")).map((device) => [device.key, device.kind]),
    [[key, "computer"]],
  );
});

test("a phone removed while the pairing window is open stays out until a later window, with the real relay host", async (t) => {
  const mac = await macWithRelay(t);
  const phone = mac.dial(connectPhone, { name: "Victor's iPhone" });
  assert.ok((await phone.hello()).channel);
  const key = b64url(phone.key.publicKey);
  assert.deepEqual(
    (await mac.client.call("devices:list")).map((device) => [device.key, device.kind, device.name]),
    [[key, "phone", "Victor's iPhone"]],
  );
  await mac.client.call("devices:remove", [key]);
  assert.equal((await phone.closed).code, 1000);
  // Settings › Devices still shows the QR, so the window is open: the phone redials at once and is refused.
  assert.deepEqual((await mac.dial(connectPhone, { key: phone.key }).hello()).error, { t: "error", code: "unknown-phone" });
  mac.clock.now += 1000;
  await mac.client.call("phone:open-pairing");
  assert.ok((await mac.dial(connectPhone, { key: phone.key, name: "Victor's iPhone" }).hello()).channel);
  assert.equal((await mac.client.call("devices:list")).length, 1);
});
```

- [ ] **Step 2: Run the test**

Run: `node --test apps/daemon/src/peer-e2e.test.cjs`
Expected: PASS (4 tests). Tasks 1-7 built everything it uses, so this test is green from the start; it proves the pieces together over real sockets (the relay room's 1 MiB frames, the LAN listener, the daemon's dispatcher). A failure here is a real integration bug: read it with `superpowers:systematic-debugging` before changing any test. Run it three times (`for i in 1 2 3; do node --test apps/daemon/src/peer-e2e.test.cjs || break; done`) to rule out a timing flake.

- [ ] **Step 3: Commit**

```bash
npx oxfmt apps/daemon/src/peer-e2e.test.cjs
git add apps/daemon/src/peer-e2e.test.cjs
git commit -m "test(daemon): a paired desktop and a phone end to end through a local relay and the LAN"
```

---

### Task 9: A computer's first pairing says so

**Files:**
- Modify: `apps/desktop/electron/notifications.cjs:125-138`
- Modify: `apps/desktop/electron/main.cjs:187`
- Test: `apps/desktop/electron/notifications.test.cjs:155-168`

**Interfaces:**
- Consumes: the `phone:paired` event payload `{ pairedPhones, kind }` (Task 6).
- Produces: `AttentionNotifier.notifyDevicePaired(kind = "phone"): true` (replaces `notifyPhonePaired()`).

- [ ] **Step 1: Write the failing test**

In `apps/desktop/electron/notifications.test.cjs`, in the test "a first phone pairing is announced even while Milagre has focus, and its click opens Settings › Devices", replace both `notifier.notifyPhonePaired()` calls with `notifier.notifyDevicePaired()`. Append:

```js
test("a computer's first pairing says another Mac can now drive this one, and its click opens Settings › Devices", () => {
  const { notifier, shown, opened } = setup();
  assert.equal(notifier.notifyDevicePaired("computer"), true);
  assert.equal(shown[0].options.title, "New computer paired");
  assert.equal(shown[0].options.body, "Another Mac can now drive your agents on this Mac. If it wasn't you, remove it in Settings → Devices.");
  shown[0].emit("click");
  assert.deepEqual(opened, ["settings:phone"]);
  // One pairing notice at a time, whatever paired.
  notifier.notifyDevicePaired("phone");
  assert.equal(shown[0].closed, true);
  assert.equal(shown[1].options.title, "New phone paired");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/desktop/electron/notifications.test.cjs`
Expected: FAIL with `notifier.notifyDevicePaired is not a function`

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/electron/notifications.cjs`, replace the comment and `notifyPhonePaired()` with:

```js
  // A device paired with this Mac for the first time: a phone, or ("computer") another Mac that can now drive this one.
  // Shown even while Milagre has focus: it is about who can reach the agents, and the pairing window opens just by
  // looking at Settings → Devices. Clicking it opens that page.
  notifyDevicePaired(kind = "phone") {
    const computer = kind === "computer";
    const notification = this.createNotification({
      title: computer ? "New computer paired" : "New phone paired",
      subtitle: "",
      body: computer
        ? "Another Mac can now drive your agents on this Mac. If it wasn't you, remove it in Settings → Devices."
        : "A phone can now reach your agents on this Mac. If it wasn't you, remove it in Settings → Devices.",
    });
    this.phonePaired?.close();
    this.phonePaired = notification;
    notification.on("click", () => this.openPhoneSettings());
    notification.show();
    return true;
  }
```

In `apps/desktop/electron/main.cjs:187`:

```js
        if (channel === "phone:paired" && Notification.isSupported()) notifier.notifyDevicePaired(payload?.kind);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/desktop/electron/notifications.test.cjs && grep -rn "notifyPhonePaired" apps packages --include='*.cjs' --include='*.ts' --include='*.tsx'`
Expected: PASS, and the grep prints nothing.

- [ ] **Step 5: Commit**

```bash
npx oxfmt apps/desktop/electron/notifications.cjs apps/desktop/electron/notifications.test.cjs apps/desktop/electron/main.cjs
git add apps/desktop/electron/notifications.cjs apps/desktop/electron/notifications.test.cjs apps/desktop/electron/main.cjs
git commit -m "feat(desktop): a computer's first pairing says another Mac can drive this one"
```

---

### Task 10: Checks before the PR

**Files:** none changed.

**Interfaces:** none.

- [ ] **Step 1: Run every check AGENTS.md asks for**

Run: `npm run typecheck && npm run typecheck:mobile && npm run lint && npm test -- --unit`
Expected: typecheck clean (mobile too: it imports `relay-crypto.d.mts`, whose `Channel` gained a method), no lint errors, every unit test passes.

- [ ] **Step 2: Confirm the phone is untouched and the socket tests are unedited**

Run: `git diff --stat origin/main -- apps/mobile apps/daemon/src/server.test.cjs apps/daemon/src/mobile-bridge.cjs`
Expected: no output. No fingerprint check or OTA is needed: nothing under `apps/mobile` changed.

- [ ] **Step 3: Write the PR description notes**

The PR body (written when the PR is opened, not committed) says: the channel protocol (`rpc` / `evt` / `part`, whole up to 768 KiB, 512 KiB parts, 16 MiB cap, 32 MiB unsent budget), the deny set and the `phone:*` event filter, the kind lock, that confined phone access never hosts a desktop, `peer:routes`, and that nothing can add a computer from a window until PR 3. Its only visible change is the macOS notification "New computer paired" (Task 9); no window changes, so there are no screenshots: say so in the body. No `Co-Authored-By` trailer and no generated-with footer.

---

## Self-Review

1. **Spec coverage (PR 2 scope).** Hello `kind: "desktop"` accepted, stored as "computer", pairing only inside the relay window: Task 4 (relay), Task 5 (LAN refuses unknown), Task 8. `rpc`/`evt`/`part`, order, gaps, 16 MiB cap: Tasks 2-3. Virtual connection via `acceptConnection` with `peerPolicy`, closed with the channel (remove, relay loss, LAN close, phone off): Tasks 3-4-5-7, end to end in Task 8. Deny set answered with `NOT_AVAILABLE_REMOTELY`: Task 7 relies on PR 1's `policy` check, proven over a real channel in Task 8. `desktop-peer-v1`: Task 7. End-to-end test with a throwaway daemon and a local relay: Task 8 (the spec's "two throwaway daemons" needs PR 3's desktop client; here one daemon and the kit's raw desktop stand in, and "sends a message, gets the reply" is a `chat:patch` reaching the desktop as `project:state` plus an echoed 1.5 MB request, since `chat:send` needs an agent CLI). The carried test (remove a phone while the window is open, redial refused, later window re-pairs, real relay host and `phone.cjs`): Task 8. Computers list shows a paired desktop: asserted through `devices:list` in Task 8 (PR 1's Settings already groups by kind).
2. **Placeholders.** None: every code step has its code, every run step its command and expected result.
3. **Type consistency.** `openPeer(carrier)` returns `{ receive, invalid, close }` everywhere (Tasks 3, 4, 6, 7); `openPeerChannel({ openPeer, channel, deliver, queued, isOpen, drop })` matches its call in `phone-channels.cjs`; `kindOf` is on the store (Task 4) and the hosts' store wrapper in `phone.cjs` (Task 4, so no task leaves a known device's hello throwing); `peerRoutes()` (Task 6) is what `peer:routes` calls (Task 7); `notifyDevicePaired(kind)` (Task 9) reads `onPaired`'s `kind` (Task 6).
4. **Review Focus.** Each line has its test: event filter (Tasks 7, 8), kind lock (Task 4), confined phone (Task 6), UTF-8 boundaries and the 768 KiB edge (Task 2, through the real room in Tasks 4, 5 and 8), stalled desktop and closed channel (Task 3).
