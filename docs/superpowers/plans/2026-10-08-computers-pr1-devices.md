# Computers PR 1: Devices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Mac remembers each paired device with a kind, a name and when it was last seen, Settings › Phone becomes Settings › Devices with a Phones list (and a Computers list once one exists) where any device can be removed, the phone sends its name in the hello, and the daemon's socket handler becomes a reusable `acceptConnection` with a deny-set `policy` hook for the paired-desktop channel in PR 2.

**Architecture:** A new `devices.cjs` store replaces `createPhones` (`relay-phones.json` migrates into `devices.json`). The encrypted hello (`relay-crypto.mjs`) gains optional `name` and `kind`; `phone-channels.cjs` records which device owns each channel so the relay and LAN hosts can report and drop a device's channels. `phone.cjs` exposes `devices()` and `removeDevice(key)`, served by the daemon as `devices:list` and `devices:remove` on its own socket only. `server.cjs` moves its per-socket handler into `acceptConnection`, unchanged in behavior for the socket.

**Tech Stack:** Node 24 CommonJS daemon (`node:test`, `node:assert/strict`), `tweetnacl` crypto in `@milagre/shared`, React + Tailwind renderer in Electron, Expo SDK 57 phone app (`expo-device`, already linked).

**Spec:** `docs/superpowers/specs/2026-10-08-computers-design.md` (this plan is step 1 of its "Order of work").

## Global Constraints

- Before Task 1: run `npm install` in the worktree (it has no `node_modules` yet).
- Daemon code is CommonJS `.cjs`; tests use `node:test` and `node:assert/strict`. Renderer and mobile tests are `.ts` run by `node --test`, importing siblings with the `.ts` extension.
- One unit file: `node --test <path>`. One workspace: `npm test -- --unit --workspace daemon`. All unit tests: `npm test -- --unit`. One Electron check: `npm test -- --only <name>`.
- The daemon socket behaves exactly as before: `apps/daemon/src/server.test.cjs` passes with no edits.
- `devices.json`: `{ devices: [{ key, kind: "phone" | "computer", name, pairedAt, lastSeen }], removed: [{ key, removedAt }] }`, mode 0600 through `writePrivate`/`assertPrivate`, at most 32 devices (`MAX_DEVICES`). Times are ms since the epoch or `null`.
- Hello inner JSON: optional `name` (control and bidi characters removed, trimmed, at most 64 characters, blank is none) and optional `kind` (`"phone"` or `"desktop"`). No `kind` means phone. Old phones and old daemons keep working both ways.
- `devices:list` and `devices:remove` run only for this Mac's own window: never in `mobile-bridge.cjs` `METHODS`, refused by `confine.cjs` (no `PATHS` entry), and in the paired-desktop deny set.
- Paired-desktop deny set: `phone:*`, `devices:*`, `push:*`, `daemon:stop`. A denied call answers `{ code: "NOT_AVAILABLE_REMOTELY", message: "Not available on a remote computer" }`.
- Copy, verbatim: "Devices", "Computers", "Phones", fallback names "Phone" and "Computer", "Connected now, same network", "Connected now, relay", "Last seen 5 min ago" (via `ago()`), "Not seen yet", "No phones yet", "Remove", confirm line "Remove <name>? It can pair again with a new link.", switch "Allow devices to connect", card "Pair a device", button "Copy link".
- Settings › Devices replaces Settings › Phone for everyone, no flag. It keeps every Phone control: the enable switch, the LAN switch, the QR with Copy link and the countdown, Allow pairing again, Reset access.
- UI goes through the shared primitives in `docs/agents/ui.md`; this PR adds no scroller, menu or slider.
- Desktop and mobile stay in sync. The phone has no device-management screen (it never manages pairing, `apps/mobile/src/app/` has no such route); its counterpart here is sending its name and saying "Settings → Devices" in its copy.
- Mobile ships OTA only. This PR changes JS only; the fingerprint must match the latest TestFlight build (Task 9). Do not run `eas build`, `eas update` or `npm run update:testflight`; publishing is a separate, approved step after merge.
- Commits: conventional messages, no Claude or Anthropic co-author trailer or footer. The pre-commit hook runs `oxlint` and `oxfmt --check` on staged files: run `npx oxfmt <files>` before `git add`.

## Review Focus

- Removing a phone while Settings › Devices is open: the pairing window is open (showing the QR opens it) and the phone redials within seconds; it must stay removed until a pairing window opened after the removal. Pinned in Task 1 (per-device `canPair`), Task 3 (relay host) and Task 4 (`phone.cjs`).
- Upgrading a Mac with `relay-phones.json`: every paired phone keeps working, shows as "Phone", takes its name from its next hello, and the old file is gone so a downgrade can't resurrect a removed phone; a non-private old file is not trusted; a store used before `load()` keeps the migrated phones. Pinned in Task 2.
- A desktop newer than its running daemon (no `devices:list` handler registered yet): Settings › Devices still shows the switch and pairing controls, with "Couldn't read paired devices: …" in place of the lists. Pinned in Task 8's Electron check.
- Hostile or odd names in a hello (blank, whitespace, 1 KB, control characters, a right-to-left override, emoji with joiners): stored as `null` or a clean name of at most 64 characters. Pinned in Task 1.
- A hello from a pre-OTA phone (no name, no kind) still pairs and shows "Phone"; a `kind: "desktop"` hello is refused with `reason: "kind"` and saved nowhere; an unknown kind is `bad-hello`. Pinned in Tasks 1 and 3.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `packages/shared/src/relay-crypto.mjs`, `.d.mts`, `.test.mjs` | modify | Hello carries `name`/`kind`; `helloName`; per-device `canPair` |
| `apps/daemon/src/devices.cjs`, `devices.test.cjs` | create | The devices store, migration from `relay-phones.json` |
| `apps/daemon/src/relay-identity.cjs`, `.test.cjs` | modify | Drop `createPhones`, export `writePrivate` |
| `apps/daemon/src/phone-channels.cjs` | modify | Channel knows its device; `keysOf`, `dropKey`; name and seen on hello |
| `apps/daemon/src/relay-host.cjs`, `lan-host.cjs` (+ tests), `relay-test-kit.cjs` | modify | `connectedKeys()`, `drop(key)`; test phone sends name/kind |
| `apps/daemon/src/phone.cjs`, `phone.test.cjs` | modify | `devices()`, `removeDevice(key)`, removal blocks re-pairing in the same window |
| `apps/daemon/src/server.cjs` | modify | `acceptConnection`, `policy`, `devices:*` methods |
| `apps/daemon/src/peer-policy.cjs`, `connections.test.cjs`, `server-devices.test.cjs` | create | Deny set; virtual-connection and devices method tests |
| `apps/daemon/src/confine.test.cjs` | modify | `devices:*` refused for a phone |
| `apps/desktop/electron/preload.cjs`, `app/src/electron.d.ts` | modify | `listDevices`, `removeDevice`, `PairedDevice` |
| `packages/shared/src/main-sync.ts` | modify | Export `ago` |
| `apps/desktop/app/src/lib/devices.ts`, `devices.test.ts` | create | Names, seen line, confirm line, grouping |
| `apps/desktop/app/src/lib/phone.ts`, `phone.test.ts` | modify | Drop `pairedPhonesLine` (the Phones list replaces the count) |
| `apps/desktop/app/src/components/Settings.tsx`, `App.tsx` | modify | Settings › Devices |
| `scripts/test-phone.cjs` → `scripts/test-settings-devices.cjs` | rename + modify | Electron check for the section |
| `apps/mobile/src/phone-name.ts`, `phone-name.test.ts`, `phone-name-native.ts` | create | The name the phone sends |
| `apps/mobile/src/relay-transport.ts`, `relay-native.ts`, `routes-native.ts` (+ tests) | modify | Hello carries the name |
| Copy files listed in Task 10, `GLOSSARY.md` | modify | "Settings → Devices"; Computer and Device terms |

---

### Task 1: The hello names its device

**Files:**
- Modify: `packages/shared/src/relay-crypto.mjs:98-141`
- Modify: `packages/shared/src/relay-crypto.d.mts:19-27`
- Test: `packages/shared/src/relay-crypto.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `phoneHello({ phone, host, token, random, name?: string, kind?: "phone" | "desktop" })` → `{ message, ephemeral }`.
  - `hostAccept({ host, hello, isKnown, canPair?: boolean | ((phoneKey: string) => boolean), token, random })` → `{ reply, channel, phoneKey, firstPairing, kind: "phone" | "desktop", name: string | null }`.
  - `helloName(value: unknown): string | null`.

- [ ] **Step 1: Write the failing tests**

Change the import at the top of `packages/shared/src/relay-crypto.test.mjs` to:

```js
import { boxKeyPair, signKeyPair, hostIdOf, phoneHello, hostAccept, phoneFinish, b64url, fromB64url, helloName } from "./relay-crypto.mjs";
```

Append:

```js
test("a hello may name the device and say what kind it is; without a kind it is a phone", () => {
  const { host, phone } = pair();
  const plain = hostAccept({ host, hello: phoneHello({ phone, host: host.publicKey, token, random }).message, isKnown: () => true, token, random });
  assert.equal(plain.kind, "phone");
  assert.equal(plain.name, null);
  const named = hostAccept({
    host,
    hello: phoneHello({ phone, host: host.publicKey, token, random, name: "  Victor's iPhone ", kind: "desktop" }).message,
    isKnown: () => true,
    token,
    random,
  });
  assert.equal(named.kind, "desktop");
  assert.equal(named.name, "Victor's iPhone");
});

test("a hello's name is cleaned: control and bidi characters go, 64 characters at most, blank is none", () => {
  assert.equal(helloName("a\u0000b‮c\n"), "abc");
  assert.equal(helloName("é".repeat(80)), "é".repeat(64));
  assert.equal(helloName("x".repeat(1024)), "x".repeat(64));
  assert.equal(helloName("👩‍💻 laptop"), "👩‍💻 laptop");
  assert.equal(helloName("   "), null);
  assert.equal(helloName(42), null);
  assert.equal(helloName(undefined), null);
});

test("a hello with an unknown kind is refused as bad-hello", () => {
  const { host, phone } = pair();
  const { message } = phoneHello({ phone, host: host.publicKey, token, random, kind: "toaster" });
  assert.throws(() => hostAccept({ host, hello: message, isKnown: () => true, token, random }), { code: "bad-hello" });
});

test("canPair may decide per device: one new phone is turned away while another pairs", () => {
  const { host, phone } = pair();
  const blocked = b64url(phone.publicKey);
  const canPair = (key) => key !== blocked;
  const { message } = phoneHello({ phone, host: host.publicKey, token, random });
  assert.throws(() => hostAccept({ host, hello: message, isKnown: () => false, canPair, token, random }), { code: "unknown-phone" });
  const other = boxKeyPair(random);
  const accepted = hostAccept({ host, hello: phoneHello({ phone: other, host: host.publicKey, token, random }).message, isKnown: () => false, canPair, token, random });
  assert.equal(accepted.firstPairing, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test packages/shared/src/relay-crypto.test.mjs`
Expected: FAIL, `helloName` is not exported (SyntaxError on the import).

- [ ] **Step 3: Implement**

In `packages/shared/src/relay-crypto.mjs`, after the `ALPHABET` constant (line 17), add:

```js
const KINDS = new Set(["phone", "desktop"]);
const MAX_NAME = 64;
// Control characters and bidirectional overrides: a name must not hide or reorder the text around it in a list.
const UNSAFE = /[\p{Cc}‪-‮⁦-⁩]/gu;

/** A device's name from its hello: unsafe characters removed, trimmed, at most 64 characters; null when there is none. */
export function helloName(value) {
  if (typeof value !== "string") return null;
  const name = Array.from(value.replace(UNSAFE, "").trim()).slice(0, MAX_NAME).join("").trim();
  return name || null;
}
```

Replace `phoneHello` (lines 98-110) with:

```js
/** `name` says what the device is called and `kind` what it is ("phone" when left out); Macs from before both ignore them. */
export function phoneHello({ phone, host, token, random, name, kind }) {
  withRandom(random);
  const ephemeral = nacl.box.keyPair();
  const nonce = random(24);
  const inner = { token, eph: b64url(ephemeral.publicKey) };
  if (typeof name === "string" && name) inner.name = name;
  if (kind) inner.kind = kind;
  const box = nacl.box(json(inner), nonce, host, phone.secretKey);
  const message = new Uint8Array(1 + 32 + 32 + 24 + box.length);
  message[0] = HELLO;
  message.set(ephemeral.publicKey, 1);
  message.set(phone.publicKey, 33);
  message.set(nonce, 65);
  message.set(box, 89);
  return { message, ephemeral };
}
```

In `hostAccept`, replace lines 127-130 (from the token check through the `unknown-phone` throw) with:

```js
  if (!sameToken(inner.token, token)) throw new RelayAuthError("bad-token", "This phone was paired with an older code");
  if (inner.kind !== undefined && !KINDS.has(inner.kind)) throw new RelayAuthError("bad-hello", "Unknown kind of device");
  const id = b64url(phoneKey);
  const firstPairing = !isKnown(id);
  // A function decides per device: a device removed while the window was open stays out until it opens again.
  const pairable = typeof canPair === "function" ? canPair(id) : canPair;
  if (firstPairing && !pairable) throw new RelayAuthError("unknown-phone", "Pairing is closed on this computer");
```

and its `return` (line 140) with:

```js
  return {
    reply,
    phoneKey: id,
    firstPairing,
    kind: inner.kind ?? "phone",
    name: helloName(inner.name),
    channel: channel(nacl.box.before(eph, mine.secretKey), HOST_TO_PHONE),
  };
```

In `packages/shared/src/relay-crypto.d.mts`, replace lines 19-27 with:

```ts
export type DeviceKind = "phone" | "desktop";
export function helloName(value: unknown): string | null;
export function phoneHello(args: { phone: KeyPair; host: Uint8Array; token: string; random: Random; name?: string | null; kind?: DeviceKind }): {
  message: Uint8Array;
  ephemeral: KeyPair;
};
export function hostAccept(args: {
  host: KeyPair;
  hello: Uint8Array;
  isKnown: (phoneKey: string) => boolean;
  canPair?: boolean | ((phoneKey: string) => boolean);
  token: string;
  random: Random;
}): { reply: Uint8Array; channel: Channel; phoneKey: string; firstPairing: boolean; kind: DeviceKind; name: string | null };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/shared/src/relay-crypto.test.mjs && npm run typecheck --workspace @milagre/shared`
Expected: PASS, every test including the four new ones; typecheck clean.

- [ ] **Step 5: Commit**

```bash
npx oxfmt packages/shared/src/relay-crypto.mjs packages/shared/src/relay-crypto.d.mts packages/shared/src/relay-crypto.test.mjs
git add packages/shared/src/relay-crypto.mjs packages/shared/src/relay-crypto.d.mts packages/shared/src/relay-crypto.test.mjs
git commit -m "feat: the pairing hello can carry the device's name and kind"
```

---

### Task 2: The devices store

**Files:**
- Create: `apps/daemon/src/devices.cjs`
- Create: `apps/daemon/src/devices.test.cjs`
- Modify: `apps/daemon/src/relay-identity.cjs:8,98-132` (remove `createPhones` and `MAX_PHONES`, export `writePrivate`)
- Modify: `apps/daemon/src/relay-identity.test.cjs:6,18-41,93-104` (its phone tests move to `devices.test.cjs`)
- Modify: `apps/daemon/src/phone.cjs:10,242,359` (import rename only; behavior comes in Task 4)
- Modify (import rename): `apps/daemon/src/phone.test.cjs`, `relay-host.test.cjs`, `lan-host.test.cjs`, `apps/mobile/src/lan-interop.test.ts`

**Interfaces:**
- Consumes: `writePrivate(file, value)` from `relay-identity.cjs` (exported here), `assertPrivate` from `@milagre/core/private-files`.
- Produces: `createDevices(dataDir, { now = Date.now } = {})` → store with
  - `load(): Promise<void>` (re-reads the file; migrates `relay-phones.json` when `devices.json` is missing)
  - `isKnown(key): boolean`, `count(): number`
  - `list(): Array<{ key, kind: "phone" | "computer", name: string | null, pairedAt: number | null, lastSeen: number | null }>` (copies, oldest first)
  - `removedAt(key): number | null`
  - `add(key, { kind = "phone", name = null } = {}): Promise<void>`
  - `seen(key, { name = null } = {}): Promise<void>`
  - `remove(key): Promise<boolean>`
  - `clear(): Promise<void>`
  - `MAX_DEVICES = 32`.

- [ ] **Step 1: Write the failing tests**

Create `apps/daemon/src/devices.test.cjs`:

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createDevices, MAX_DEVICES } = require("./devices.cjs");

const tmp = (name) => fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
const saved = async (dir) => JSON.parse(await fs.readFile(path.join(dir, "devices.json"), "utf8"));
const mode = async (dir, name) => (await fs.stat(path.join(dir, name))).mode & 0o777;

test("a device is remembered with its kind, name and times, privately, across loads", async () => {
  const dir = await tmp("devices");
  let now = 1000;
  const devices = createDevices(dir, { now: () => now });
  await devices.load();
  await devices.add("phoneA", { kind: "phone", name: "Victor's iPhone" });
  now = 2000;
  await devices.add("macB", { kind: "computer", name: "studio" });
  const again = createDevices(dir);
  await again.load();
  assert.deepEqual(again.list(), [
    { key: "phoneA", kind: "phone", name: "Victor's iPhone", pairedAt: 1000, lastSeen: 1000 },
    { key: "macB", kind: "computer", name: "studio", pairedAt: 2000, lastSeen: 2000 },
  ]);
  assert.equal(again.isKnown("phoneA"), true);
  assert.equal(again.count(), 2);
  assert.equal(await mode(dir, "devices.json"), 0o600);
});

test("add with no kind or name is a nameless phone, and an unknown kind is refused", async () => {
  const dir = await tmp("devices-plain");
  const devices = createDevices(dir, { now: () => 7 });
  await devices.add("phoneA");
  assert.deepEqual(devices.list(), [{ key: "phoneA", kind: "phone", name: null, pairedAt: 7, lastSeen: 7 }]);
  await assert.rejects(devices.add("x", { kind: "tablet" }), /kind/);
});

test("the phone list counts its phones, and reset forgets them", async () => {
  const dir = await tmp("devices-count");
  const devices = createDevices(dir);
  await devices.load();
  assert.equal(devices.count(), 0);
  await devices.add("phoneA");
  await devices.add("phoneB");
  await devices.add("phoneA");
  assert.equal(devices.count(), 2);
  await devices.clear();
  assert.equal(devices.count(), 0);
  const again = createDevices(dir);
  await again.load();
  assert.equal(again.isKnown("phoneA"), false);
});

test("only the 32 newest devices are remembered", async () => {
  const dir = await tmp("devices-cap");
  const devices = createDevices(dir);
  await devices.load();
  for (let i = 0; i <= MAX_DEVICES; i++) await devices.add(`phone${i}`);
  assert.equal(MAX_DEVICES, 32);
  assert.equal(devices.isKnown("phone0"), false);
  assert.equal(devices.isKnown("phone1"), true);
  assert.equal(devices.isKnown("phone32"), true);
});

test("phones from relay-phones.json move to devices.json as nameless phones, and the old file goes", async () => {
  const dir = await tmp("devices-migrate");
  await fs.writeFile(path.join(dir, "relay-phones.json"), JSON.stringify({ phones: ["phoneA", "phoneB"] }), { mode: 0o600 });
  const devices = createDevices(dir);
  await devices.load();
  assert.deepEqual(devices.list(), [
    { key: "phoneA", kind: "phone", name: null, pairedAt: null, lastSeen: null },
    { key: "phoneB", kind: "phone", name: null, pairedAt: null, lastSeen: null },
  ]);
  assert.deepEqual(
    (await saved(dir)).devices.map((device) => device.key),
    ["phoneA", "phoneB"],
  );
  assert.equal(await mode(dir, "devices.json"), 0o600);
  await assert.rejects(fs.stat(path.join(dir, "relay-phones.json")), { code: "ENOENT" }, "a downgrade must not bring back a removed phone");
});

test("a migrated phone takes its name from its next hello", async () => {
  const dir = await tmp("devices-migrate-name");
  await fs.writeFile(path.join(dir, "relay-phones.json"), JSON.stringify({ phones: ["phoneA"] }), { mode: 0o600 });
  const devices = createDevices(dir, { now: () => 50 });
  await devices.load();
  await devices.seen("phoneA", { name: "Victor's iPhone" });
  assert.deepEqual((await saved(dir)).devices[0], { key: "phoneA", kind: "phone", name: "Victor's iPhone", pairedAt: null, lastSeen: 50 });
});

test("a store used before load still keeps the migrated phones", async () => {
  const dir = await tmp("devices-early");
  await fs.writeFile(path.join(dir, "relay-phones.json"), JSON.stringify({ phones: ["phoneA"] }), { mode: 0o600 });
  await createDevices(dir).add("phoneC");
  const again = createDevices(dir);
  await again.load();
  assert.deepEqual(
    again.list().map((device) => device.key),
    ["phoneA", "phoneC"],
  );
});

test("a relay-phones.json that is not private is not trusted, and is left for the owner to see", async () => {
  const dir = await tmp("devices-open");
  const legacy = path.join(dir, "relay-phones.json");
  await fs.writeFile(legacy, JSON.stringify({ phones: ["phoneA"] }));
  await fs.chmod(legacy, 0o644);
  const devices = createDevices(dir);
  await devices.load();
  assert.deepEqual(devices.list(), []);
  await fs.stat(legacy);
});

test("seen moves lastSeen at every hello but writes at most once a minute, and a new name at once", async () => {
  const dir = await tmp("devices-seen");
  let now = 0;
  const devices = createDevices(dir, { now: () => now });
  await devices.load();
  await devices.add("phoneA");
  now = 10_000;
  await devices.seen("phoneA");
  assert.equal(devices.list()[0].lastSeen, 10_000);
  assert.equal((await saved(dir)).devices[0].lastSeen, 0, "not written within the minute");
  now = 20_000;
  await devices.seen("phoneA", { name: "Victor's iPhone" });
  assert.deepEqual((await saved(dir)).devices[0], { key: "phoneA", kind: "phone", name: "Victor's iPhone", pairedAt: 0, lastSeen: 20_000 });
  now = 50_000;
  await devices.seen("phoneA");
  assert.equal((await saved(dir)).devices[0].lastSeen, 20_000);
  now = 80_000;
  await devices.seen("phoneA", { name: null });
  assert.equal((await saved(dir)).devices[0].lastSeen, 80_000);
  assert.equal(devices.list()[0].name, "Victor's iPhone", "a hello without a name keeps the one saved");
  await devices.seen("stranger");
  assert.equal(devices.count(), 1, "seen never adds a device");
});

test("remove forgets a device and remembers when; adding it back or a reset clears that", async () => {
  const dir = await tmp("devices-remove");
  let now = 5;
  const devices = createDevices(dir, { now: () => now });
  await devices.load();
  await devices.add("phoneA");
  await devices.add("phoneB");
  now = 9;
  assert.equal(await devices.remove("phoneA"), true);
  assert.equal(await devices.remove("phoneA"), false);
  assert.deepEqual(
    devices.list().map((device) => device.key),
    ["phoneB"],
  );
  assert.equal(devices.removedAt("phoneA"), 9);
  assert.equal(devices.removedAt("phoneB"), null);
  assert.equal(devices.removedAt("constructor"), null);
  const again = createDevices(dir, { now: () => now });
  await again.load();
  assert.equal(again.removedAt("phoneA"), 9);
  await again.add("phoneA");
  assert.equal(again.removedAt("phoneA"), null);
  await again.remove("phoneB");
  await again.clear();
  assert.equal(again.count(), 0);
  assert.equal(again.removedAt("phoneB"), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test apps/daemon/src/devices.test.cjs`
Expected: FAIL with "Cannot find module './devices.cjs'".

- [ ] **Step 3: Implement the store**

Create `apps/daemon/src/devices.cjs`:

```js
const { assertPrivate } = require("@milagre/core/private-files");
const fs = require("node:fs/promises");
const path = require("node:path");
const { writePrivate } = require("./relay-identity.cjs");

const MAX_DEVICES = 32;
const KINDS = new Set(["phone", "computer"]);
// lastSeen changes at every hello; the file follows at most this often. A new name is written at once.
const SEEN_WRITE_MS = 60_000;
const time = (value) => (Number.isFinite(value) ? value : null);

function readDevice(value) {
  if (!value || typeof value.key !== "string" || !KINDS.has(value.kind)) return null;
  return {
    key: value.key,
    kind: value.kind,
    name: typeof value.name === "string" && value.name ? value.name : null,
    pairedAt: time(value.pairedAt),
    lastSeen: time(value.lastSeen),
  };
}

/**
 * The phones and computers paired to this Mac, oldest first, in `<dataDir>/devices.json` ({ devices, removed }, 0600).
 * `removed` keeps when each forgotten device was removed, so phone.cjs can keep it from pairing again in the window it
 * was removed in. Reset clears both. When devices.json is missing, the bare key list from before devices had names
 * (relay-phones.json) moves in as nameless phones and is deleted. Writes land in call order, so a clear is never
 * overwritten by an add that started before it. Any method may run before load(): the first one reads the file.
 */
function createDevices(dataDir, { now = Date.now } = {}) {
  const file = path.join(dataDir, "devices.json");
  const legacyFile = path.join(dataDir, "relay-phones.json");
  let devices = [];
  let removed = new Map(); // key -> when it was removed
  let loaded = null;
  let writtenAt = -Infinity;
  let writes = Promise.resolve();
  const write = () => {
    const value = {
      devices: devices.map((device) => ({ ...device })),
      removed: [...removed].map(([key, removedAt]) => ({ key, removedAt })),
    };
    const next = writes.then(() => writePrivate(file, value));
    writes = next.catch(() => {});
    return next;
  };

  async function migrate() {
    let phones;
    try {
      assertPrivate(legacyFile);
      phones = JSON.parse(await fs.readFile(legacyFile, "utf8")).phones;
    } catch {
      return;
    }
    if (!Array.isArray(phones)) return;
    devices = phones
      .filter((key) => typeof key === "string")
      .slice(-MAX_DEVICES)
      .map((key) => ({ key, kind: "phone", name: null, pairedAt: null, lastSeen: null }));
    try {
      await write();
      // Gone once copied: a downgraded daemon must not bring back a phone removed here.
      await fs.rm(legacyFile, { force: true });
    } catch {
      /* kept in memory; the next change writes it */
    }
  }

  async function read() {
    await writes;
    devices = [];
    removed = new Map();
    let value;
    try {
      assertPrivate(file);
      value = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      // Missing: maybe an older list to take over. Unreadable or not private: nothing is known, as before.
      if (error.code === "ENOENT") await migrate();
      return;
    }
    devices = (Array.isArray(value?.devices) ? value.devices : []).map(readDevice).filter(Boolean).slice(-MAX_DEVICES);
    for (const entry of Array.isArray(value?.removed) ? value.removed : [])
      if (typeof entry?.key === "string" && Number.isFinite(entry.removedAt)) removed.set(entry.key, entry.removedAt);
  }
  const ready = () => (loaded ??= read());
  const find = (key) => devices.find((device) => device.key === key);

  return {
    load() {
      loaded = read();
      return loaded;
    },
    isKnown: (key) => devices.some((device) => device.key === key),
    count: () => devices.length,
    list: () => devices.map((device) => ({ ...device })),
    removedAt: (key) => removed.get(key) ?? null,
    async add(key, { kind = "phone", name = null } = {}) {
      if (!KINDS.has(kind)) throw new Error(`Unknown device kind: ${kind}`);
      await ready();
      const at = now();
      const previous = find(key);
      const device = { key, kind, name: name ?? previous?.name ?? null, pairedAt: previous?.pairedAt ?? at, lastSeen: at };
      devices = [...devices.filter((item) => item.key !== key), device].slice(-MAX_DEVICES);
      removed.delete(key);
      writtenAt = at;
      await write();
    },
    /** A known device said hello: when, and its name when it sent a new one. Unknown keys are ignored. */
    async seen(key, { name = null } = {}) {
      await ready();
      const device = find(key);
      if (!device) return;
      const at = now();
      const renamed = name !== null && name !== device.name;
      device.lastSeen = at;
      if (renamed) device.name = name;
      if (!renamed && at - writtenAt < SEEN_WRITE_MS) return;
      writtenAt = at;
      await write();
    },
    /** Forgets a device; false when it wasn't paired. */
    async remove(key) {
      await ready();
      if (!find(key)) return false;
      devices = devices.filter((device) => device.key !== key);
      removed.delete(key);
      removed.set(key, now());
      while (removed.size > MAX_DEVICES) removed.delete(removed.keys().next().value);
      await write();
      return true;
    },
    async clear() {
      await ready();
      devices = [];
      removed = new Map();
      await write();
    },
  };
}

module.exports = { createDevices, MAX_DEVICES };
```

- [ ] **Step 4: Retire `createPhones` and point its users at the store**

In `apps/daemon/src/relay-identity.cjs`: delete line 8 (`const MAX_PHONES = 32;`), delete lines 98-130 (the `createPhones` doc comment and function), and change line 132 to:

```js
module.exports = { readIdentity, rotateIdentity, readRetired, writePrivate };
```

In `apps/daemon/src/relay-identity.test.cjs`: change line 6 to `const { readIdentity, rotateIdentity, readRetired } = require("./relay-identity.cjs");` and delete the three phone-list tests ("reset forgets phones", "only the 32 newest phones are remembered", "the phone list counts its phones"); `devices.test.cjs` covers them.

Rename the remaining users mechanically:

```bash
sed -i '' 's/const { readIdentity, rotateIdentity, readRetired, createPhones } = require(".\/relay-identity.cjs");/const { readIdentity, rotateIdentity, readRetired } = require(".\/relay-identity.cjs");\nconst { createDevices } = require(".\/devices.cjs");/' apps/daemon/src/phone.cjs
sed -i '' 's/createPhones(dataDir)/createDevices(dataDir, { now })/g' apps/daemon/src/phone.cjs
sed -i '' 's/const { createPhones } = require(".\/relay-identity.cjs");/const { createDevices } = require(".\/devices.cjs");/' apps/daemon/src/phone.test.cjs
sed -i '' 's/const { readIdentity, createPhones } = require(".\/relay-identity.cjs");/const { readIdentity } = require(".\/relay-identity.cjs");\nconst { createDevices } = require(".\/devices.cjs");/' apps/daemon/src/relay-host.test.cjs apps/daemon/src/lan-host.test.cjs
sed -i '' 's/const { readIdentity, createPhones } = require("..\/..\/daemon\/src\/relay-identity.cjs");/const { readIdentity } = require("..\/..\/daemon\/src\/relay-identity.cjs");\nconst { createDevices } = require("..\/..\/daemon\/src\/devices.cjs");/' apps/mobile/src/lan-interop.test.ts
sed -i '' 's/createPhones(/createDevices(/g' apps/daemon/src/phone.test.cjs apps/daemon/src/relay-host.test.cjs apps/daemon/src/lan-host.test.cjs apps/mobile/src/lan-interop.test.ts
sed -i '' 's/relay-phones\.json/devices.json/g' apps/daemon/src/phone.test.cjs apps/daemon/src/relay-host.test.cjs
```

The last line points the two "a directory where the phone list lives" tests (`phone.test.cjs:258`, `:391`) and the saved-key check (`relay-host.test.cjs:182`) at the new file. Check: `grep -rn "createPhones\|relay-phones" apps packages scripts --include='*.cjs' --include='*.mjs' --include='*.ts'` prints only `apps/daemon/src/devices.cjs` and `devices.test.cjs`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test apps/daemon/src/devices.test.cjs apps/daemon/src/relay-identity.test.cjs apps/daemon/src/phone.test.cjs apps/daemon/src/relay-host.test.cjs apps/daemon/src/lan-host.test.cjs apps/daemon/src/server.test.cjs && node --test apps/mobile/src/lan-interop.test.ts`
Expected: PASS everywhere, `server.test.cjs` untouched.

- [ ] **Step 6: Commit**

```bash
npx oxfmt apps/daemon/src apps/mobile/src/lan-interop.test.ts
git add apps/daemon/src apps/mobile/src/lan-interop.test.ts
git commit -m "feat: remember paired devices with a kind, name and last seen"
```

---

### Task 3: Each channel knows its device

**Files:**
- Modify: `apps/daemon/src/phone-channels.cjs:69-92,278`
- Modify: `apps/daemon/src/relay-host.cjs:156-175`
- Modify: `apps/daemon/src/lan-host.cjs:157-167`
- Modify: `apps/daemon/src/relay-test-kit.cjs:100,129`
- Test: `apps/daemon/src/relay-host.test.cjs`, `apps/daemon/src/lan-host.test.cjs`

**Interfaces:**
- Consumes: `hostAccept(...).kind/.name`, per-device `canPair` (Task 1); store `add(key, { kind, name })`, `seen(key, { name })` (Task 2). The `phones` object a host receives may lack `seen` (old fakes); calls are guarded.
- Produces:
  - `createPhoneChannels(...)` returns `{ onFrame, dropConn, dropKey(current, key), keysOf(current): string[] }`; `canPair` is called with the device key.
  - `startRelayHost(...)` returns `{ status, close, connectedKeys(): string[], drop(key): void }`.
  - `startLanHost(...)` resolves `{ port, close, connectedKeys(): string[], drop(key): void }`.
  - Hello refusal for a desktop: `{ t: "error", code: "bad-hello", reason: "kind" }`.
  - `connectPhone({ relayUrl, identity, token, key, name, kind })` in the test kit.

- [ ] **Step 1: Write the failing tests**

In `apps/daemon/src/relay-test-kit.cjs`, change the signature on line 100 to `function connectPhone({ relayUrl, identity, token = TOKEN, key = boxKeyPair(random), name, kind }) {` and line 129 to:

```js
      const { message, ephemeral } = phoneHello({ phone: key, host: identity.box.publicKey, token, random, name, kind });
```

In `apps/daemon/src/relay-host.test.cjs`, change `startMac`'s `canPair: () => canPair(),` (line 65) to `canPair: (key) => canPair(key),` and append:

```js
test("a phone's hello names it: a first pairing saves the name, a later hello renames it, and drop closes it", async (t) => {
  const { relay, mac } = await paired(t);
  const key = boxKeyPair(random);
  const id = b64url(key.publicKey);
  const first = connectPhone({ relayUrl: relay.url, identity: mac.identity, key, name: "iPhone 16 Pro" });
  t.after(() => first.close());
  assert.ok((await first.hello()).channel);
  assert.equal(mac.phones.list().find((device) => device.key === id).name, "iPhone 16 Pro");
  assert.deepEqual(mac.host.connectedKeys(), [id]);
  first.close();
  await until(() => mac.host.connectedKeys().length === 0, "the closed channel is gone");

  const second = connectPhone({ relayUrl: relay.url, identity: mac.identity, key, name: "Victor's iPhone" });
  t.after(() => second.close());
  assert.ok((await second.hello()).channel);
  await until(() => mac.phones.list().find((device) => device.key === id).name === "Victor's iPhone", "renamed by the hello");
  mac.host.drop(id);
  await second.closed;
  assert.deepEqual(mac.host.connectedKeys(), []);
});

test("a desktop's hello is turned away with reason kind and saved nowhere", async (t) => {
  const { relay, mac } = await paired(t);
  const key = boxKeyPair(random);
  const desktop = connectPhone({ relayUrl: relay.url, identity: mac.identity, key, kind: "desktop", name: "studio" });
  t.after(() => desktop.close());
  assert.deepEqual(await desktop.hello(), { error: { t: "error", code: "bad-hello", reason: "kind" } });
  assert.equal(mac.phones.isKnown(b64url(key.publicKey)), false);
});

test("the pairing window can stay closed to one phone while another pairs", async (t) => {
  const blocked = boxKeyPair(random);
  const { relay, mac, connect } = await paired(t, { mac: { canPair: (key) => key !== b64url(blocked.publicKey) } });
  const phone = connectPhone({ relayUrl: relay.url, identity: mac.identity, key: blocked });
  t.after(() => phone.close());
  assert.deepEqual(await phone.hello(), { error: { t: "error", code: "unknown-phone" } });
  await connect();
});
```

In `apps/daemon/src/lan-host.test.cjs`, change `lanMac`'s return (line 23) to `return { identity, key, bridge, host, phones, url: \`ws://127.0.0.1:${host.port}\` };` and append:

```js
test("a known phone on the LAN shows as connected, is seen with its name, and drop closes it", async (t) => {
  const { identity, key, host, phones, url } = await lanMac(t);
  const id = b64url(key.publicKey);
  const phone = connectPhone({ relayUrl: url, identity, key, name: "Victor's iPhone" });
  t.after(() => phone.close());
  assert.ok((await phone.hello()).channel);
  assert.deepEqual(host.connectedKeys(), [id]);
  await until(() => phones.list()[0].name === "Victor's iPhone", "the name from the hello");
  host.drop(id);
  await phone.closed;
  await until(() => host.connectedKeys().length === 0, "dropped");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test apps/daemon/src/relay-host.test.cjs apps/daemon/src/lan-host.test.cjs`
Expected: FAIL: `mac.host.connectedKeys is not a function`, the desktop hello opens a channel instead of an error, and the blocked phone pairs.

- [ ] **Step 3: Implement**

In `apps/daemon/src/phone-channels.cjs`, replace `hello` (lines 69-92) with:

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
    // A desktop speaks another protocol over this channel. Until this Mac does, it turns desktops away unsaved.
    if (accepted.kind !== "phone") return refuse(current, conn, "bad-hello", { reason: "kind" });
    // Set before any wait, so a removal that lands meanwhile finds this channel.
    record.key = accepted.phoneKey;
    if (accepted.firstPairing) {
      try {
        await phones.add(accepted.phoneKey, { kind: "phone", name: accepted.name });
      } catch {
        return dropConn(current, conn, true);
      }
    } else {
      // When it was last here, and its name if it changed. A failed write never closes a known phone's channel.
      void Promise.resolve(phones.seen?.(accepted.phoneKey, { name: accepted.name })).catch(() => {});
    }
    if (current.conns.get(conn) !== record) return;
    record.channel = accepted.channel;
    record.state = "open";
    clearTimeout(record.helloTimer);
    sendFrame(current, DATA, conn, accepted.reply);
  }

  /** Keys of the devices whose channel on this carrier finished its hello. */
  function keysOf(current) {
    const keys = new Set();
    for (const record of current.conns.values()) if (record.state === "open" && record.key) keys.add(record.key);
    return [...keys];
  }

  /** Closes every channel `key` has on this carrier, and tells the carrier to close their sockets. */
  function dropKey(current, key) {
    for (const [conn, record] of [...current.conns]) if (record.key === key) dropConn(current, conn, true);
  }
```

and its return (line 278) with `return { onFrame, dropConn, dropKey, keysOf };`. Add `key: null,` to the record literal in `onFrame` (after `helloTimer: null,`).

In `apps/daemon/src/relay-host.cjs`, add to the returned object (after `status: () => status,`):

```js
    /** Keys of the devices with a channel open through the relay now. */
    connectedKeys: () => (session ? channels.keysOf(session) : []),
    /** Closes every channel the device with `key` has open through the relay. */
    drop(key) {
      if (session) channels.dropKey(session, key);
    },
```

In `apps/daemon/src/lan-host.cjs`, add to the object passed to `resolve` (after `port: server.address().port,`):

```js
        connectedKeys: () => channels.keysOf(session),
        drop: (key) => channels.dropKey(session, key),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test apps/daemon/src/relay-host.test.cjs apps/daemon/src/lan-host.test.cjs apps/daemon/src/server.test.cjs && node --test apps/mobile/src/lan-interop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx oxfmt apps/daemon/src/phone-channels.cjs apps/daemon/src/relay-host.cjs apps/daemon/src/lan-host.cjs apps/daemon/src/relay-test-kit.cjs apps/daemon/src/relay-host.test.cjs apps/daemon/src/lan-host.test.cjs
git add apps/daemon/src/phone-channels.cjs apps/daemon/src/relay-host.cjs apps/daemon/src/lan-host.cjs apps/daemon/src/relay-test-kit.cjs apps/daemon/src/relay-host.test.cjs apps/daemon/src/lan-host.test.cjs
git commit -m "feat: each phone channel knows its device, so one device's channels can be listed and closed"
```

---

### Task 4: The Phone setting lists and removes devices

**Files:**
- Modify: `apps/daemon/src/phone.cjs:69-70,139-141,207-214,242-258,264-276,324-430`
- Test: `apps/daemon/src/phone.test.cjs`

**Interfaces:**
- Consumes: store from Task 2 (`createDevices`, `removedAt`, `seen`, `remove`); hosts' `connectedKeys()`/`drop(key)` from Task 3 (optional on fakes).
- Produces on `createPhone(...)`:
  - `devices(): Promise<Array<{ key, kind, name, pairedAt, lastSeen, route: "lan" | "relay" | null }>>`
  - `removeDevice(key: string): Promise<same array>`; throws `Error("Expected a device key")` for a key that isn't 43 base64url characters.
  - The relay host's `canPair(key)`: false for a key removed at or after the current window opened.
  - The `phones` object handed to hosts gains `seen(key, info)` and passes `add(key, info)` through.

- [ ] **Step 1: Write the failing tests**

Append to `apps/daemon/src/phone.test.cjs`:

```js
test("devices lists what paired, with the route each is connected on now", async (t) => {
  const { phone, relays, lans } = await fixture(t);
  await phone.setEnabled(true);
  await phone.settled();
  const key = "k".repeat(43);
  await relays[0].options.phones.add(key, { kind: "phone", name: "Victor's iPhone" });
  assert.deepEqual(
    (await phone.devices()).map((device) => [device.key, device.kind, device.name, device.route]),
    [[key, "phone", "Victor's iPhone", null]],
  );
  relays[0].connectedKeys = () => [key];
  assert.equal((await phone.devices())[0].route, "relay");
  lans[0].connectedKeys = () => [key];
  assert.equal((await phone.devices())[0].route, "lan", "the local network wins when both carry it");
});

test("the device list reads the saved devices while phone access is off", async (t) => {
  const { phone, dataDir } = await fixture(t);
  await createDevices(dataDir).add("k".repeat(43), { name: "iPad mini" });
  assert.deepEqual(
    (await phone.devices()).map((device) => [device.name, device.route]),
    [["iPad mini", null]],
  );
});

test("removing a device forgets it, closes its channels, and lets it pair again only in a window opened later", async (t) => {
  const { phone, relays, lans, clock, changes } = await fixture(t);
  await phone.setEnabled(true);
  await phone.settled();
  const dropped = [];
  relays[0].drop = (key) => dropped.push(`relay:${key}`);
  lans[0].drop = (key) => dropped.push(`lan:${key}`);
  const key = "k".repeat(43);
  await relays[0].options.phones.add(key, { name: "Victor's iPhone" });
  clock.now = 1000;
  const before = changes.length;
  assert.deepEqual(await phone.removeDevice(key), []);
  assert.deepEqual(dropped, [`relay:${key}`, `lan:${key}`]);
  assert.ok(changes.length > before, "a removal is announced as a phone status, so Settings reads the list again");
  assert.equal(relays[0].options.canPair(key), false, "the window it was removed in stays closed to it");
  assert.equal(relays[0].options.canPair("o".repeat(43)), true, "other new devices still pair");
  clock.now = 2000;
  await phone.openPairing();
  assert.equal(relays[0].options.canPair(key), true);
  await assert.rejects(phone.removeDevice("short"), /device key/);
});

test("a removed phone reaching routes through a trusted route is not added back", async (t) => {
  const { phone, relays, dataDir } = await fixture(t);
  await phone.setEnabled(true);
  await phone.settled();
  const key = "k".repeat(43);
  await relays[0].options.phones.add(key);
  await phone.removeDevice(key);
  await phone.routes(key);
  const after = createDevices(dataDir);
  await after.load();
  assert.equal(after.isKnown(key), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test apps/daemon/src/phone.test.cjs`
Expected: FAIL with "phone.devices is not a function".

- [ ] **Step 3: Implement**

In `apps/daemon/src/phone.cjs`:

After `let pairingUntil = 0;` (line 69) add `let pairingOpenedAt = 0;`, and change the comment on `relayPhones` (line 70) to `// the devices store, one instance so a reset or removal changes what the running hosts see`.

Replace `openPairing` (lines 139-141) with:

```js
  const openPairing = () => {
    pairingOpenedAt = now();
    pairingUntil = pairingOpenedAt + PAIRING_WINDOW_MS;
  };

  /** The devices store, read once; each launch reads it again. */
  async function deviceStore() {
    if (!relayPhones) {
      relayPhones = createDevices(dataDir, { now });
      await relayPhones.load();
    }
    return relayPhones;
  }

  /**
   * Whether the device with `key` may pair now. Showing the QR opens the window, so a phone removed while Settings is
   * open would redial and pair again at once: a device removed since the window opened waits for the next one.
   */
  function mayPair(key) {
    if (now() >= pairingUntil) return false;
    const removedAt = relayPhones?.removedAt(key) ?? null;
    return removedAt === null || removedAt < pairingOpenedAt;
  }
```

In `routes` (line 211), replace `if (!current.phones.isKnown(phoneKey)) await relayPhones.add(phoneKey);` with:

```js
    if (!current.phones.isKnown(phoneKey) && relayPhones.removedAt(phoneKey) === null) await relayPhones.add(phoneKey);
```

In `launch`, the store setup and wrapper (lines 242-258 after Task 2's rename) become:

```js
      relayPhones ??= createDevices(dataDir, { now });
      await relayPhones.load();
      const known = relayPhones;
      const phones = {
        isKnown: (id) => known.isKnown(id),
        seen: (id, info) => known.seen(id, info),
        async add(id, info) {
          await known.add(id, info);
          // A pairing the old host saw while a reset tore it down is about to be forgotten: nothing to announce.
          if (mine !== generation) return;
          changed();
          try {
            onPaired({ pairedPhones: known.count() });
          } catch {
            /* a listener must not break the setting */
          }
        },
      };
```

and in the `startRelay({...})` call (line 270) replace `canPair: () => now() < pairingUntil,` with `canPair: (key) => mayPair(key),`.

In `reset()` (lines 358-361 after Task 2's rename) replace the `if (!relayPhones) { ... }` block with `await deviceStore();`.

Before `return {` (line 324) add:

```js
  /** Every paired device, oldest first, with the route it is connected on now (the local network first), or null. */
  async function devices() {
    const store = await deviceStore();
    const lan = new Set(live?.lan?.connectedKeys?.() ?? []);
    const relay = new Set(live?.relay?.connectedKeys?.() ?? []);
    return store.list().map((device) => ({ ...device, route: lan.has(device.key) ? "lan" : relay.has(device.key) ? "relay" : null }));
  }
```

and add to the returned object, after `settled: () => queue,`:

```js
    devices,
    /** Forgets a device and closes its channels on every carrier. It may pair again only in a pairing window opened later. */
    async removeDevice(key) {
      if (typeof key !== "string" || !PHONE_KEY.test(key)) throw new Error("Expected a device key");
      await enqueue(async () => {
        const store = await deviceStore();
        await store.remove(key);
        live?.relay?.drop?.(key);
        live?.lan?.drop?.(key);
        changed();
      });
      return devices();
    },
```

Update the `createPhone` doc comment (lines 28-42): after the sentence about `pairedPhones`, add "`devices()` lists every paired device with the route it uses now, and `removeDevice(key)` forgets one and closes its channels."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test apps/daemon/src/phone.test.cjs apps/daemon/src/server.test.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx oxfmt apps/daemon/src/phone.cjs apps/daemon/src/phone.test.cjs
git add apps/daemon/src/phone.cjs apps/daemon/src/phone.test.cjs
git commit -m "feat: list paired devices and remove one, closing its channels"
```

---

### Task 5: `acceptConnection` and its policy hook

**Files:**
- Modify: `apps/daemon/src/server.cjs:216-222,256-272,284,335-535,578`
- Create: `apps/daemon/src/peer-policy.cjs`
- Create: `apps/daemon/src/connections.test.cjs`
- Unchanged and must pass: `apps/daemon/src/server.test.cjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `startDaemon(...)` returns `{ socketPath, close, acceptConnection }`.
  - `acceptConnection({ send(message, json?, bytes?): boolean, end(): void, destroy(): void, isClosed(): boolean, requireAuthentication?: boolean, policy?: { denies(method: string): boolean } | null })` → `{ receive(request): void, invalid(error): void, close(): void }`. The carrier calls `close()` once when it goes away; `daemon.close()` only ends sockets, so a carrier closes its own virtual connections.
  - Denied: `{ v: 1, id, error: { code: "NOT_AVAILABLE_REMOTELY", message: "Not available on a remote computer" } }`; `daemon:status` leaves denied methods out of `methods`.
  - `peerPolicy` from `peer-policy.cjs`: `{ denies(method) }` for the paired-desktop deny set (used by PR 2).

- [ ] **Step 1: Write the failing tests**

Create `apps/daemon/src/connections.test.cjs` (it fails on the missing `peer-policy.cjs` until Step 3):

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { startDaemon } = require("./server.cjs");
const { peerPolicy } = require("./peer-policy.cjs");

async function waitFor(read) {
  for (let i = 0; i < 400; i++) {
    const value = await read();
    if (value) return value;
    await delay(10);
  }
  throw new Error("Timed out");
}

async function daemonFixture(t) {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-connections-")));
  const daemon = await startDaemon({
    dataDir,
    version: "test",
    // No test may dial the real relay or bind the LAN port.
    phoneOptions: { localPort: 0, lanPort: null, startRelay: () => ({ close: async () => {}, status: () => "online" }) },
    runtimeOptions: { cwd: dataDir, environmentReady: Promise.resolve(), titleModels: {}, agentCli: Object.assign(async () => ({ command: null }), { invalidate() {} }) },
  });
  t.after(async () => {
    await daemon.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return daemon;
}

/** A daemon client with no socket: every frame the daemon sends lands in `frames`, even after close. */
function virtualClient(daemon, options = {}) {
  const frames = [];
  const waiters = new Map();
  let ended = false;
  let nextId = 0;
  const connection = daemon.acceptConnection({
    send(message, json) {
      const frame = JSON.parse(json ?? JSON.stringify(message));
      frames.push(frame);
      if (frame.id != null) waiters.get(frame.id)?.(frame);
      return true;
    },
    end: () => {
      ended = true;
    },
    destroy: () => {
      ended = true;
    },
    isClosed: () => ended,
    ...options,
  });
  return {
    frames,
    events: () => frames.filter((frame) => frame.event).map((frame) => frame.event),
    call(method, args = []) {
      const id = ++nextId;
      const reply = new Promise((resolve) => waiters.set(id, resolve));
      connection.receive({ v: 1, id, method, args });
      return reply;
    },
    close: () => connection.close(),
  };
}

test("the paired-desktop policy denies pairing, device management, push and stopping the daemon, and nothing else", () => {
  for (const method of ["phone:status", "phone:reset", "phone:open-pairing", "devices:list", "devices:remove", "push:register", "push:focus", "daemon:stop"])
    assert.equal(peerPolicy.denies(method), true, method);
  for (const method of ["daemon:status", "daemon:snapshot", "daemon:state-patches", "state:read", "project:open", "project:recent", "git:push", "chat:set-open"])
    assert.equal(peerPolicy.denies(method), false, method);
});

test("a virtual connection without a policy runs any method and gets events until it closes", async (t) => {
  const daemon = await daemonFixture(t);
  const client = virtualClient(daemon);
  const status = (await client.call("daemon:status")).result;
  assert.ok(status.methods.includes("phone:set-enabled"));
  assert.equal((await client.call("phone:set-enabled", [true])).result.state, "starting");
  await waitFor(() => client.events().some((event) => event.channel === "phone:status" && event.payload.state === "on"));
  client.close();
  const before = client.frames.length;
  const other = virtualClient(daemon);
  await other.call("phone:set-enabled", [false]);
  await waitFor(() => other.events().some((event) => event.channel === "phone:status" && event.payload.state === "off"));
  assert.equal(client.frames.length, before, "a closed connection gets nothing more");
});

test("a policy refuses what it denies before it runs, and daemon:status leaves those methods out", async (t) => {
  const daemon = await daemonFixture(t);
  const peer = virtualClient(daemon, { policy: peerPolicy });
  for (const [method, args] of [["phone:set-enabled", [true]], ["phone:reset", []], ["push:register", [{}]], ["daemon:stop", []]]) {
    const reply = await peer.call(method, args);
    assert.deepEqual(reply.error, { code: "NOT_AVAILABLE_REMOTELY", message: "Not available on a remote computer" }, method);
  }
  const methods = (await peer.call("daemon:status")).result.methods;
  assert.equal(methods.some((method) => peerPolicy.denies(method)), false);
  assert.ok(methods.includes("project:recent"));
  const local = virtualClient(daemon);
  assert.equal((await local.call("phone:status")).result.state, "off", "the denied phone:set-enabled never ran");
  assert.ok((await local.call("daemon:status")).result.methods.includes("daemon:stop"), "the socket's own view is unchanged");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test apps/daemon/src/connections.test.cjs`
Expected: FAIL with "Cannot find module './peer-policy.cjs'".

- [ ] **Step 3: Write the policy**

Create `apps/daemon/src/peer-policy.cjs`:

```js
// What a paired desktop may not call on this Mac: pairing and device management (it must not manage its own access),
// push registration (a phone's), and stopping the daemon. Everything else is allowed, so a new desktop method works
// remotely by default. The Unix socket, this Mac's own window, has no policy.
const DENIED_PREFIXES = Object.freeze(["phone:", "devices:", "push:"]);
const DENIED = new Set(["daemon:stop"]);

const peerPolicy = Object.freeze({
  denies: (method) => DENIED.has(method) || DENIED_PREFIXES.some((prefix) => method.startsWith(prefix)),
});

module.exports = { peerPolicy };
```

- [ ] **Step 4: Factor the socket handler into `acceptConnection`**

In `apps/daemon/src/server.cjs`:

Replace lines 220-222 (the comment and `const patchSockets = new Map();`) with:

```js
  // Connections that take state patches, and per scope the last state sent and its number. The numbers start again with
  // each host (epoch), so a client that reconnects to a new one reads its states again.
  // Connection -> { messages }: false for a client that reads messages by Chat (chat:messages) and takes states without them.
  const patchClients = new Map();
```

In `broadcast` (lines 263-266) rename the loop to `for (const [key, connection] of clients) {` and `const taker = patchClients.get(key);`. In `statePatch` (line 284) use `if (![...patchClients.keys()].some((key) => clients.has(key))) return null;`.

Replace the whole `const server = net.createServer((socket) => { ... });` block (lines 335-535) with:

```js
  /**
   * One client of the daemon, whatever carries its frames: the Unix socket below, and (PR 2) a paired desktop's channel.
   * The carrier supplies `send(message, json, bytes)`, which writes one frame as wire()'s send does (it may throw
   * FRAME_TOO_LARGE, and returns false once closed); `end()`, which closes after what is queued; `destroy()`, which
   * closes now; and `isClosed()`. `requireAuthentication`: the first requests must be the daemon:authenticate handshake
   * (the socket on Windows). `policy.denies(method)` refuses a method before it runs and leaves it out of daemon:status;
   * the socket has none. The carrier hands the result each parsed request (`receive`), a framing error (`invalid`) and,
   * once, its own close (`close`).
   */
  function acceptConnection({ send, end, destroy, isClosed, requireAuthentication: mustAuthenticate = false, policy = null }) {
    let authenticated = !mustAuthenticate;
    let challenge;
    let authenticationRejected = false;
    let closed = false;
    if (!authenticated) unauthenticated++;
    const authenticationTimeout = authenticated ? null : setTimeout(destroy, authTimeoutMs);
    authenticationTimeout?.unref();
    const inflight = new Set();
    // Requests whose reply waits for paging room: they don't hold a MAX_PENDING slot, so a reader's page reads get through.
    const awaitingPages = new Set();
    // Result pages and paged snapshots share one store and its rules.
    const resultPages = createResultPages(maxFrameBytes, { ttlMs: pagesTtlMs, budgetChars: pagesBudgetChars });
    const view = { focused: false, projectPath: null, chatId: null };
    // Never accept an actor supplied in RPC arguments. Each authenticated connection owns its viewer capabilities.
    const context = Object.freeze({ clientId: randomUUID() });
    // This connection in clients, views and patchClients.
    const key = Symbol("connection");
    const connection = { send };
    if (authenticated) {
      clients.set(key, connection);
      views.set(key, view);
    }
    async function dispatch(request) {
      const validId = Number.isSafeInteger(request?.id) || (typeof request?.id === "string" && request.id.length <= 128);
      const id = validId ? request.id : null;
      function fail(code, message) {
        connection.send({ v: VERSION, id, error: { code, message } });
      }
      if (authenticationRejected) return;
      if (!authenticated) {
        const supplied = request?.args?.[0];
        const valid = request?.v === VERSION && validId && request.method === "daemon:authenticate" && Array.isArray(request.args) && request.args.length === 1;
        if (valid && !challenge && validNonce(supplied?.clientNonce)) {
          challenge = { clientNonce: supplied.clientNonce, serverNonce: authenticationNonce() };
          connection.send({
            v: VERSION,
            id,
            result: {
              serverNonce: challenge.serverNonce,
              proof: authenticationProof(authenticationToken, "server", challenge.clientNonce, challenge.serverNonce),
            },
          });
          return;
        }
        if (
          !valid ||
          !challenge ||
          !validToken(authenticationProof(authenticationToken, "client", challenge.clientNonce, challenge.serverNonce), supplied?.proof)
        ) {
          authenticationRejected = true;
          fail("UNAUTHORIZED", "Local daemon authentication is required");
          end();
          return;
        }
        authenticated = true;
        unauthenticated--;
        clearTimeout(authenticationTimeout);
        clients.set(key, connection);
        views.set(key, view);
        connection.send({ v: VERSION, id, result: { authenticated: true } });
        return;
      }
      if (request?.v !== VERSION) {
        fail("VERSION_MISMATCH", `Local protocol version ${VERSION} is required`);
        return;
      }
      if (!validId || typeof request.method !== "string" || request.method.length > 128 || !Array.isArray(request.args)) {
        fail("INVALID_REQUEST", "Expected id, method and an args array");
        return;
      }
      if (stopping) {
        fail("CLOSING", "The daemon is closing");
        return;
      }
      if (policy?.denies(request.method)) {
        fail("NOT_AVAILABLE_REMOTELY", "Not available on a remote computer");
        return;
      }
      if (inflight.has(id) || inflight.size - awaitingPages.size >= MAX_PENDING) {
        fail("TOO_MANY_REQUESTS", "Request ID is in use or too many requests are pending");
        end();
        return;
      }
      inflight.add(id);
      async function capturePages(text) {
        if (resultPages.mustWait(text.length)) awaitingPages.add(id);
        try {
          return await resultPages.capture(text);
        } finally {
          awaitingPages.delete(id);
        }
      }
      // Serialised once. A client that reads pages (`pages: true`) gets anything over a quarter of a frame as a page
      // count; one that can't gets it whole up to the frame limit, and a clear FRAME_TOO_LARGE error past it.
      async function reply(result) {
        const resultJson = encode(patchClients.get(key)?.messages === false ? leanResult(result) : result);
        if (request.pages === true && !PAGE_METHODS.has(request.method) && resultJson.length > inlineLimit) {
          const pages = await capturePages(resultJson);
          if (pages) connection.send({ v: VERSION, id, pages });
          return;
        }
        connection.send(null, `{"v":${VERSION},"id":${JSON.stringify(id)},"result":${resultJson}}`);
      }
      try {
        let result;
        if (request.method === "daemon:status")
          result = {
            pid: process.pid,
            version,
            protocolVersion: VERSION,
            dataDir,
            socketPath,
            capabilities: ["desktop-v1", "snapshot-pages-v1", "result-pages-v1", "mobile-push-v1", STATE_PATCHES, CHAT_PAGES],
            methods: [...runtime.methods, ...PHONE_METHODS, ...PUSH_METHODS, ...STATE_METHODS].filter((method) => !policy?.denies(method)),
          };
        else if (request.method === "phone:status") result = phone.status();
        // Settings shows the reply, which arrives after the status events: answer with the settled status, not the
        // "starting" one a reset began from, or the window hides the new code.
        else if (request.method === "phone:set-enabled") {
          result = await phone.setEnabled(request.args[0]);
          if (request.args[0] === false) {
            await phone.settled();
            await push.clear();
            result = phone.status();
          }
        } else if (request.method === "phone:reset") {
          await phone.reset();
          await phone.settled();
          await push.clear();
          result = phone.status();
        } else if (request.method === "phone:open-pairing") result = await phone.openPairing();
        else if (request.method === "phone:set-lan") result = await phone.setLan(request.args[0]);
        else if (request.method === "push:register") result = await push.register(request.args[0]);
        else if (request.method === "push:unregister") result = await push.unregister(request.args[0]);
        else if (request.method === "push:focus") result = push.focus(request.args[0]);
        else if (request.method === "daemon:snapshot") {
          const whole = runtime.snapshot();
          const snapshot = { ...(patchClients.get(key)?.messages === false ? leanResult(whole) : whole), eventSeq };
          if (request.args[0]?.paged === true) {
            // Serialize once: all pages describe the same instant and watermark.
            const pages = await capturePages(JSON.stringify(snapshot));
            if (!pages) return;
            result = { snapshotId: pages.pageId, pageCount: pages.pageCount, eventSeq: snapshot.eventSeq };
          } else result = snapshot;
        } else if (request.method === "daemon:snapshot-page" || request.method === "daemon:result-page") result = resultPages.page(...request.args);
        else if (request.method === "daemon:flush") result = await runtime.flush();
        else if (request.method === "daemon:state-patches") {
          patchClients.set(key, { messages: request.args[0]?.messages !== false });
          result = { epoch };
        } else if (request.method === "state:read") result = await readState(request.args[0], { messages: patchClients.get(key)?.messages !== false });
        else if (request.method === "daemon:focus") {
          const next = request.args[0];
          if (!next || typeof next.focused !== "boolean") throw new Error("Expected a focused boolean");
          view.focused = next.focused;
          if (view.focused) await runtime.focused(view);
        } else if (request.method === "chat:set-open") {
          view.chatId = typeof request.args[0] === "string" ? request.args[0] : null;
          await runtime.focused(view);
        } else if (request.method === "daemon:stop") {
          await runtime.close();
          result = { stopping: true };
        }
        // Only a desktop open (it passes takeNotice) takes the restored-chats notice; the phone's bridge opens without it.
        else if (request.method === "project:open") result = await runtime.openProject(request.args[0], { takeNotice: request.args[1]?.takeNotice === true });
        else if (request.method === "project:current" && view.projectPath) result = await runtime.invoke("project:snapshot", [view.projectPath]);
        else result = await runtime.invoke(request.method, request.args, context);
        // An open may finish after its caller disconnects. Dispose that late session as well.
        if (isClosed() && /^(simulator|browser):/.test(request.method)) await runtime.disconnect?.(context.clientId);
        if (request.method === "link:open" && result?.link) view.linkId = result.link.id;
        if (["project:open", "project:current", "project:switch"].includes(request.method) && result?.path) view.projectPath = result.path;
        await reply(result ?? null);
        if (request.method === "daemon:stop") void close().catch(onError);
      } catch (error) {
        fail(typeof error.code === "string" ? error.code : "COMMAND_FAILED", error.message);
      } finally {
        inflight.delete(id);
      }
    }
    return {
      receive(request) {
        void dispatch(request).catch((error) => {
          onError(error);
          destroy();
        });
      },
      invalid(error) {
        connection.send({ v: VERSION, id: null, error: { code: error.code, message: error.message } });
        end();
      },
      close() {
        if (closed) return;
        closed = true;
        resultPages.clear();
        clearTimeout(authenticationTimeout);
        if (!authenticated) unauthenticated--;
        clients.delete(key);
        views.delete(key);
        patchClients.delete(key);
        Promise.resolve(runtime.disconnect?.(context.clientId)).catch(onError);
      },
    };
  }

  const server = net.createServer((socket) => {
    if (stopping || (requireAuthentication && unauthenticated >= 32)) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    let framed;
    const client = acceptConnection({
      send: (message, json, bytes) => framed.send(message, json, bytes),
      end: () => socket.end(),
      destroy: () => socket.destroy(),
      isClosed: () => socket.destroyed,
      requireAuthentication,
    });
    framed = wire(socket, { maxFrameBytes, onInvalid: (error) => client.invalid(error), onMessage: (request) => client.receive(request) });
    socket.on("error", () => {});
    socket.on("close", () => {
      sockets.delete(socket);
      client.close();
    });
  });
```

Change the final return (line 578) to `return { socketPath, close, acceptConnection };`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test apps/daemon/src/connections.test.cjs apps/daemon/src/server.test.cjs apps/daemon/src/windows-transport.test.cjs && npm test -- --unit --workspace daemon`
Expected: PASS; `git diff --stat apps/daemon/src/server.test.cjs` prints nothing.

- [ ] **Step 6: Commit**

```bash
npx oxfmt apps/daemon/src/server.cjs apps/daemon/src/peer-policy.cjs apps/daemon/src/connections.test.cjs
git add apps/daemon/src/server.cjs apps/daemon/src/peer-policy.cjs apps/daemon/src/connections.test.cjs
git commit -m "refactor: serve each daemon client through acceptConnection, with a policy hook for paired desktops"
```

---

### Task 6: `devices:list` and `devices:remove`

**Files:**
- Modify: `apps/daemon/src/server.cjs:17-20` and the daemon:status methods line and the method chain from Task 5
- Create: `apps/daemon/src/server-devices.test.cjs`
- Modify: `apps/daemon/src/confine.test.cjs`

**Interfaces:**
- Consumes: `phone.devices()`, `phone.removeDevice(key)` (Task 4); `acceptConnection` (Task 5).
- Produces: daemon methods `devices:list` → `PairedDevice[]` and `devices:remove(key)` → `PairedDevice[]`, listed in `daemon:status.methods` (so Electron main registers them through `registerHostMethods`, `apps/desktop/electron/main.cjs:207-215`, no main change needed). Shape: `{ key, kind, name, pairedAt, lastSeen, route }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/daemon/src/server-devices.test.cjs`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { startDaemon } = require("./server.cjs");
const { connect } = require("./client.cjs");

async function waitFor(read) {
  for (let i = 0; i < 400; i++) {
    const value = await read();
    if (value) return value;
    await delay(10);
  }
  throw new Error("Timed out");
}

test("devices:list and devices:remove are desktop methods over the saved devices, and never reach the phone's bridge", async (t) => {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-devices-")));
  const relays = [];
  const daemon = await startDaemon({
    dataDir,
    version: "test",
    phoneOptions: {
      localPort: 0,
      lanPort: null,
      startRelay: (options) => {
        relays.push(options);
        return { close: async () => {}, status: () => "online" };
      },
    },
    runtimeOptions: { cwd: dataDir, environmentReady: Promise.resolve(), titleModels: {}, agentCli: Object.assign(async () => ({ command: null }), { invalidate() {} }) },
  });
  const desktop = await connect({ dataDir });
  t.after(async () => {
    desktop.close();
    await daemon.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const methods = (await desktop.call("daemon:status")).methods;
  for (const method of ["devices:list", "devices:remove"]) assert.ok(methods.includes(method), method);
  assert.deepEqual(await desktop.call("devices:list"), []);

  await desktop.call("phone:set-enabled", [true]);
  const on = await waitFor(async () => {
    const status = await desktop.call("phone:status");
    return status.state === "on" && status;
  });
  const key = "k".repeat(43);
  await relays[0].phones.add(key, { kind: "phone", name: "Victor's iPhone" });
  const [device] = await desktop.call("devices:list");
  assert.deepEqual(
    { ...device, pairedAt: typeof device.pairedAt, lastSeen: typeof device.lastSeen },
    { key, kind: "phone", name: "Victor's iPhone", pairedAt: "number", lastSeen: "number", route: null },
  );

  // The phone's own bridge never manages devices, its own or another's.
  const token = new URL(on.pairingLink).searchParams.get("token");
  for (const [method, args] of [["devices:list", []], ["devices:remove", [key]]]) {
    const response = await fetch(on.localUrl + "/rpc", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ v: 1, method, args }),
    });
    assert.equal(response.status, 403, method);
  }
  assert.equal((await desktop.call("devices:list")).length, 1);

  assert.deepEqual(await desktop.call("devices:remove", [key]), []);
  assert.deepEqual(await desktop.call("devices:list"), []);
  await assert.rejects(desktop.call("devices:remove", ["nope"]), /device key/);
});
```

Append to `apps/daemon/src/confine.test.cjs`:

```js
test("device management is never a phone command, confined or not", async () => {
  const confine = createConfinement({ allowedRoot: os.tmpdir() });
  for (const method of ["devices:list", "devices:remove"]) {
    assert.equal(METHODS.has(method), false, method);
    assert.equal(PATHS[method], undefined, method);
    await assert.rejects(confine.checkCall(method, []), { status: 403, message: REFUSED });
  }
});
```

(`METHODS`, `os`, `PATHS`, `REFUSED` and `createConfinement` are already imported at `confine.test.cjs:4,11,13`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test apps/daemon/src/server-devices.test.cjs apps/daemon/src/confine.test.cjs`
Expected: `server-devices` FAILS (`devices:list` not in methods); the confine test passes already, which is the point: the default refuses it.

- [ ] **Step 3: Implement**

In `apps/daemon/src/server.cjs`, change the comment and constants on lines 17-19 to:

```js
// Handled here, never by core, and not in the mobile bridge's allow-list: a paired phone must not manage its own access.
const PUSH_METHODS = Object.freeze(["push:register", "push:unregister", "push:focus"]);
const PHONE_METHODS = Object.freeze(["phone:status", "phone:set-enabled", "phone:reset", "phone:open-pairing", "phone:set-lan"]);
// Paired phones and computers, listed and removed from this Mac's own window only (Settings › Devices).
const DEVICE_METHODS = Object.freeze(["devices:list", "devices:remove"]);
```

In `daemon:status`, change the methods line to:

```js
            methods: [...runtime.methods, ...PHONE_METHODS, ...DEVICE_METHODS, ...PUSH_METHODS, ...STATE_METHODS].filter((method) => !policy?.denies(method)),
```

After the `phone:set-lan` branch add:

```js
        else if (request.method === "devices:list") result = await phone.devices();
        else if (request.method === "devices:remove") result = await phone.removeDevice(request.args[0]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test apps/daemon/src/server-devices.test.cjs apps/daemon/src/confine.test.cjs apps/daemon/src/connections.test.cjs apps/daemon/src/server.test.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx oxfmt apps/daemon/src/server.cjs apps/daemon/src/server-devices.test.cjs apps/daemon/src/confine.test.cjs
git add apps/daemon/src/server.cjs apps/daemon/src/server-devices.test.cjs apps/daemon/src/confine.test.cjs
git commit -m "feat: devices:list and devices:remove for the desktop"
```

---

### Task 7: Desktop plumbing and the device lines

**Files:**
- Modify: `apps/desktop/electron/preload.cjs:201` (after `openPhonePairing`)
- Modify: `apps/desktop/app/src/electron.d.ts:88` (after `PhoneStatus`) and `:319` (after `openPhonePairing`)
- Modify: `packages/shared/src/main-sync.ts:36` (export `ago`)
- Create: `apps/desktop/app/src/lib/devices.ts`, `apps/desktop/app/src/lib/devices.test.ts`

**Interfaces:**
- Consumes: daemon methods from Task 6.
- Produces:
  - `window.milagre.listDevices(): Promise<PairedDevice[]>`, `window.milagre.removeDevice(key: string): Promise<PairedDevice[]>`.
  - `type PairedDevice = { key: string; kind: "phone" | "computer"; name: string | null; pairedAt: number | null; lastSeen: number | null; route: "lan" | "relay" | null }`.
  - `deviceName(device)`, `deviceSeenLine(device, now)`, `removeDeviceQuestion(device)`, `devicesByKind(devices) → { computers, phones }` (connected first, then most recently seen).
  - `ago(at: number, now: number): string` exported from `@milagre/shared/main-sync`.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/app/src/lib/devices.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { PairedDevice } from "../electron";
import { deviceName, deviceSeenLine, devicesByKind, removeDeviceQuestion } from "./devices.ts";

const device = (over: Partial<PairedDevice> = {}): PairedDevice => ({ key: "k", kind: "phone", name: null, pairedAt: 0, lastSeen: null, route: null, ...over });
const MINUTE = 60_000;

test("a device without a name is called what it is", () => {
  assert.equal(deviceName(device()), "Phone");
  assert.equal(deviceName(device({ kind: "computer" })), "Computer");
  assert.equal(deviceName(device({ name: "Victor's iPhone" })), "Victor's iPhone");
});

test("the line under a device says how it is connected now, or when it was last seen", () => {
  const now = 100 * MINUTE;
  assert.equal(deviceSeenLine(device({ route: "lan", lastSeen: 0 }), now), "Connected now, same network");
  assert.equal(deviceSeenLine(device({ route: "relay" }), now), "Connected now, relay");
  assert.equal(deviceSeenLine(device({ lastSeen: now - 5 * MINUTE }), now), "Last seen 5 min ago");
  assert.equal(deviceSeenLine(device({ lastSeen: now - 10_000 }), now), "Last seen just now");
  assert.equal(deviceSeenLine(device(), now), "Not seen yet");
});

test("removing asks by name and says it can pair again", () => {
  assert.equal(removeDeviceQuestion(device({ name: "studio", kind: "computer" })), "Remove studio? It can pair again with a new link.");
  assert.equal(removeDeviceQuestion(device()), "Remove Phone? It can pair again with a new link.");
});

test("devices split into computers and phones, connected first, then the most recently seen", () => {
  const old = device({ key: "old", lastSeen: 1 });
  const recent = device({ key: "recent", lastSeen: 5 });
  const live = device({ key: "live", lastSeen: 0, route: "relay" });
  const never = device({ key: "never" });
  const mac = device({ key: "mac", kind: "computer" });
  const { computers, phones } = devicesByKind([old, never, recent, mac, live]);
  assert.deepEqual(
    computers.map((item) => item.key),
    ["mac"],
  );
  assert.deepEqual(
    phones.map((item) => item.key),
    ["live", "recent", "old", "never"],
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test apps/desktop/app/src/lib/devices.test.ts`
Expected: FAIL with "Cannot find module ... devices.ts".

- [ ] **Step 3: Implement**

In `packages/shared/src/main-sync.ts` line 36, change `function ago(` to `export function ago(` and put this doc comment above it: `/** "just now", "5 min ago", "3 h ago" or "2 d ago". */`.

In `apps/desktop/app/src/electron.d.ts`, after the `PhoneStatus` type (ends line 88) add:

```ts
/** A phone or computer paired to this Mac, as Settings › Devices lists it. `route`: how it is connected now, or null. */
export type PairedDevice = {
  key: string;
  kind: "phone" | "computer";
  /** What the device called itself in its hello; null for phones paired before names. */
  name: string | null;
  pairedAt: number | null;
  lastSeen: number | null;
  route: "lan" | "relay" | null;
};
```

and after `openPhonePairing: () => Promise<PhoneStatus>;` (line 320) add:

```ts
      /** Every phone and computer paired to this Mac. */
      listDevices: () => Promise<PairedDevice[]>;
      /** Forgets one and closes its connections; resolves with the devices left. */
      removeDevice: (key: string) => Promise<PairedDevice[]>;
```

In `apps/desktop/electron/preload.cjs`, after `openPhonePairing: () => ipcRenderer.invoke("phone:open-pairing"),` add:

```js
  listDevices: () => ipcRenderer.invoke("devices:list"),
  removeDevice: (key) => ipcRenderer.invoke("devices:remove", key),
```

Create `apps/desktop/app/src/lib/devices.ts`:

```ts
import { ago } from "@milagre/shared/main-sync";
import type { PairedDevice } from "../electron";

/** What a device is called: its own name, or what it is when it sent none. */
export function deviceName(device: Pick<PairedDevice, "kind" | "name">): string {
  return device.name ?? (device.kind === "computer" ? "Computer" : "Phone");
}

/** The line under a device's name in Settings › Devices. */
export function deviceSeenLine(device: Pick<PairedDevice, "route" | "lastSeen">, now: number): string {
  if (device.route === "lan") return "Connected now, same network";
  if (device.route === "relay") return "Connected now, relay";
  if (device.lastSeen === null) return "Not seen yet";
  return `Last seen ${ago(device.lastSeen, now)}`;
}

/** Shown in place of that line while Remove waits for a second click. */
export const removeDeviceQuestion = (device: Pick<PairedDevice, "kind" | "name">) => `Remove ${deviceName(device)}? It can pair again with a new link.`;

/** The two lists, each with what is connected first and then the most recently seen. */
export function devicesByKind(devices: PairedDevice[]): { computers: PairedDevice[]; phones: PairedDevice[] } {
  const order = (a: PairedDevice, b: PairedDevice) => Number(b.route !== null) - Number(a.route !== null) || (b.lastSeen ?? -1) - (a.lastSeen ?? -1);
  return {
    computers: devices.filter((device) => device.kind === "computer").sort(order),
    phones: devices.filter((device) => device.kind === "phone").sort(order),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test apps/desktop/app/src/lib/devices.test.ts packages/shared/src/main-sync.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
npx oxfmt packages/shared/src/main-sync.ts apps/desktop/electron/preload.cjs apps/desktop/app/src/electron.d.ts apps/desktop/app/src/lib/devices.ts apps/desktop/app/src/lib/devices.test.ts
git add packages/shared/src/main-sync.ts apps/desktop/electron/preload.cjs apps/desktop/app/src/electron.d.ts apps/desktop/app/src/lib/devices.ts apps/desktop/app/src/lib/devices.test.ts
git commit -m "feat: the window can list and remove paired devices"
```

---

### Task 8: Settings › Devices

**Files:**
- Modify: `apps/desktop/app/src/components/Settings.tsx:10-20,21,32,50,58,400-614,1174`
- Modify: `apps/desktop/app/src/App.tsx:1005-1012`
- Modify: `apps/desktop/app/src/lib/phone.ts:41-46`, `apps/desktop/app/src/lib/phone.test.ts:3,41-49`
- Rename + modify: `scripts/test-phone.cjs` → `scripts/test-settings-devices.cjs`

**Interfaces:**
- Consumes: `listDevices`, `removeDevice`, `PairedDevice`, `deviceName`, `deviceSeenLine`, `removeDeviceQuestion`, `devicesByKind` (Task 7).
- Produces: `SettingsSection` value `"devices"` (replaces `"phone"`); DOM hooks for checks: `[data-device-row="phone"|"computer"]`, `[data-device-line]`, `[data-device-remove]`, `[data-device-remove-confirm]`, `[data-devices-empty]`, `[data-devices-error]`; the existing `[data-phone-*]` hooks stay except `[data-phone-paired]`, which goes.

- [ ] **Step 1: Write the failing Electron check**

```bash
git mv scripts/test-phone.cjs scripts/test-settings-devices.cjs
```

In `scripts/test-settings-devices.cjs`:

1. Replace the header comment (lines 1-4) with:

```js
// Run with npm test -- --only test-settings-devices. Exercises Settings › Devices in the real App against a real daemon (its
// own temporary data directory and socket, port chosen by the OS): see the devices list fail soft on a host without it,
// turn device access on, see the QR code and the relay status, copy the link, see a phone and a computer pair and the
// Computers list appear, remove the phone, reset access, turn it off. The rest of the window's API is mocked, like the
// other checks. Set MILAGRE_SCREENSHOT_DIR to save screenshots.
```

2. In the fixture's `window.milagre`, after `openPhonePairing: ...,` add:

```js
  listDevices: () => ipcRenderer.invoke("devices:list"),
  removeDevice: (key) => ipcRenderer.invoke("devices:remove", key),
```

3. Change the `ipcMain.handle` loop's list to `["phone:status", "phone:set-enabled", "phone:set-lan", "phone:reset", "phone:open-pairing", "devices:remove"]`. `devices:list` is registered later on purpose: the window first meets a host without it.

4. Change `const toggle = ...` to use `aria-label="Allow devices to connect"`.

5. Replace the block from `await click("Phone");` through `console.log("PASS: Settings › Phone starts off, with nothing to pair");` with:

```js
    await click("Devices");

    // A host from before devices:list: the access controls still work, and the lists say they couldn't be read.
    await waitFor(`!!${toggle} && document.body.textContent.includes('Allow devices to connect')`);
    await waitFor(`document.querySelector('[data-devices-error]')?.textContent.startsWith("Couldn't read paired devices")`);
    ipcMain.handle("devices:list", (_event, ...args) => host.call("devices:list", args));
    console.log("PASS: without devices:list the section still shows its access controls");

    // Off: the toggle, its status, and nothing else to pair with.
    assert.equal(await evaluate(`${toggle}.getAttribute('aria-checked')`), "false");
    await waitFor(`document.body.textContent.includes('Off')`);
    assert.equal(await evaluate(`!!document.querySelector('[data-phone-qr]')`), false);
    assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(el => el.textContent.includes('Reset access'))`), false);
    await screenshot("devices-off");
    console.log("PASS: Settings › Devices starts off, with nothing to pair");
```

6. Change `'New phones can pair for 10 more minutes'` to `'New devices can pair for 10 more minutes'`, `await click("Copy pairing link");` to `await click("Copy link");` and the PASS line to `"PASS: Copy link copies the link"`. After the toggle is clicked on, add `await waitFor(\`!document.querySelector('[data-devices-error]')\`);` (the phone:status events read the list again).

7. Replace the "Paired phones" block (from `// Paired phones: none yet, ...` through its `console.log`) with:

```js
    // Devices: no phones yet and no Computers list, then a phone and a computer as they pair.
    const phoneKey = "p".repeat(43);
    const computerKey = "c".repeat(43);
    const hostDevices = () => relays.filter((options) => !options.retired).at(-1).phones;
    const computersShown = `[...document.querySelectorAll('h2')].some((h) => h.textContent === 'Computers')`;
    await waitFor(`document.querySelector('[data-devices-empty]')?.textContent === 'No phones yet'`);
    assert.equal(await evaluate(computersShown), false);
    await hostDevices().add(phoneKey, { kind: "phone", name: "Victor's iPhone" });
    await waitFor(`document.querySelector('[data-device-row="phone"]')?.textContent.includes("Victor's iPhone")`);
    assert.equal(await evaluate(`document.querySelector('[data-device-row="phone"] [data-device-line]').textContent`), "Last seen just now");
    assert.equal(await evaluate(computersShown), false, "Computers stays hidden with no computer");
    assert.deepEqual(paired, [{ pairedPhones: 1 }]);
    await hostDevices().add(computerKey, { kind: "computer", name: "studio" });
    await waitFor(`${computersShown} && document.querySelector('[data-device-row="computer"]')?.textContent.includes('studio')`);
    await evaluate(`document.querySelector('[data-device-row="phone"]').scrollIntoView({ block: 'center' })`);
    await screenshot("devices-lists");
    console.log("PASS: phones and computers list by name as they pair; Computers shows only once there is one");

    // Remove asks first; Cancel keeps the phone; confirming removes it on the host.
    const phoneLine = `document.querySelector('[data-device-row="phone"] [data-device-line]')?.textContent`;
    await evaluate(`document.querySelector('[data-device-row="phone"] [data-device-remove]').click()`);
    await waitFor(`${phoneLine} === "Remove Victor's iPhone? It can pair again with a new link."`);
    await screenshot("device-remove-confirm");
    await click("Cancel");
    await waitFor(`${phoneLine} === "Last seen just now"`);
    await evaluate(`document.querySelector('[data-device-row="phone"] [data-device-remove]').click()`);
    await waitFor(`!!document.querySelector('[data-device-remove-confirm]')`);
    await evaluate(`document.querySelector('[data-device-remove-confirm]').click()`);
    await waitFor(`!document.querySelector('[data-device-row="phone"]') && document.querySelector('[data-devices-empty]')?.textContent === 'No phones yet'`);
    assert.deepEqual(
      (await host.call("devices:list")).map((device) => device.key),
      [computerKey],
    );
    console.log("PASS: Remove asks first and removes the phone on the host");
```

8. In the reset block change `'must scan again'` (both places) to `'must pair again'`, `'Make a new code'` stays, and replace `await waitFor(\`document.querySelector('[data-phone-paired]')?.textContent === 'No phones yet'\`);` with:

```js
    await waitFor(`document.querySelector('[data-devices-empty]')?.textContent === 'No phones yet' && !${computersShown}`);
```

and its PASS line with `"PASS: reset asks first, makes a new token, forgets every device and keeps the old room answering"`.

9. Rename the Vite plugin's `"phone-fixture"`, `"/__phone_fixture.tsx"` and `"/__phone__"` to `"devices-fixture"`, `"/__devices_fixture.tsx"` and `"/__devices__"`, the Electron partition `"phone-test"` to `"devices-test"`, and the temp prefixes `milagre-phone-ui-`/`milagre-phone-host-` to `milagre-devices-ui-`/`milagre-devices-host-`.

- [ ] **Step 2: Run the check to verify it fails**

Run: `npm test -- --only test-settings-devices`
Expected: FAIL, "Timed out: !!(…'Devices')" (no Devices section yet).

- [ ] **Step 3: Implement the section**

In `apps/desktop/app/src/lib/phone.ts`, delete `pairedPhonesLine` (lines 41-46). In `apps/desktop/app/src/lib/phone.test.ts`, drop it from the import on line 3 and delete the test "the paired-phone count is shown only for a relay phone" (lines 41-49).

In `apps/desktop/app/src/components/Settings.tsx`:

- Add `LaptopIcon` to the `@hugeicons/core-free-icons` import, add `PairedDevice` to the `../electron` type import, change line 32 to `import { pairingWindow, phoneLanLine, phoneQrSrc, phoneStatusLine } from "../lib/phone";` and add `import { deviceName, deviceSeenLine, devicesByKind, removeDeviceQuestion } from "../lib/devices";`.
- Line 50: replace `"phone"` with `"devices"` in `SettingsSection`. Line 58: `{ key: "devices", label: "Devices", icon: SmartphoneIcon },`. Line 1174: `{section === "devices" && <DevicesSettings />}`.
- Replace the section from the `/* ─── PHONE ─── */` comment (line 399) through the end of `PhoneSettings` (line 614) with:

```tsx
/* ─────────────────────────────────────────────────────────
 * DEVICES
 * The host runs the bridge the Milagre phone app talks to.
 * Turning it on shows a QR code that carries the access token;
 * resetting makes a new token, so every paired device pairs again.
 * Below it, the phones and computers paired to this Mac.
 * ───────────────────────────────────────────────────────── */
function usePhoneStatus() {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let pushed = false;
    // An update that arrives while the first read is in flight is newer than that read.
    const off = window.milagre.onPhoneStatus((next) => {
      pushed = true;
      setStatus(next);
    });
    window.milagre.getPhoneStatus().then(
      (next) => {
        // oxlint-disable-next-line promise/no-callback-in-promise -- the handler receives the resolved value, not a Node-style callback
        if (live && !pushed) setStatus(next);
      },
      (error) => {
        if (live) setLoadError(`Couldn't read device access: ${ipcErrorMessage(error)}`);
      },
    );
    return () => {
      live = false;
      off();
    };
  }, []);
  return { status, setStatus, loadError };
}

/**
 * The paired devices. A pairing, a removal or a reset arrives as a phone status, which reads the list again; a device
 * connecting or leaving doesn't, so it is also read every 15 seconds while the section is open.
 */
function usePairedDevices() {
  const [list, setList] = useState<PairedDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    const read = () => {
      window.milagre.listDevices().then(
        (devices) => {
          if (!live) return;
          setList(devices);
          setError(null);
          setNow(Date.now());
        },
        (failure) => {
          if (live) setError(`Couldn't read paired devices: ${ipcErrorMessage(failure)}`);
        },
      );
    };
    read();
    const off = window.milagre.onPhoneStatus(read);
    const timer = window.setInterval(read, 15_000);
    return () => {
      live = false;
      off();
      window.clearInterval(timer);
    };
  }, []);
  return { list, setList, error, now };
}

const SECONDARY_BUTTON =
  "rounded-control border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-hover disabled:cursor-default disabled:opacity-50";
const DANGER_BUTTON =
  "rounded-control border border-red/30 bg-red/5 px-3 py-1.5 text-[12px] font-medium text-red transition-colors hover:bg-red/10 disabled:cursor-default disabled:opacity-50";

function DeviceGroup({
  title,
  devices,
  now,
  busy,
  empty,
  error,
  onRemove,
}: {
  title: string;
  devices: PairedDevice[];
  now: number;
  busy: boolean;
  empty?: string;
  error?: string | null;
  onRemove: (key: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <Group title={title}>
      {error ? (
        <p data-devices-error className="break-words px-4 py-3 text-[12px] text-red">
          {error}
        </p>
      ) : (
        devices.length === 0 &&
        empty && (
          <p data-devices-empty className="px-4 py-3 text-[12px] text-ink-3">
            {empty}
          </p>
        )
      )}
      {devices.map((device) => {
        const asking = confirming === device.key;
        return (
          <div key={device.key} data-device-row={device.kind} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <span className="relative flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-hover text-ink-2">
              <Icon icon={device.kind === "computer" ? LaptopIcon : SmartphoneIcon} size={15} />
              <span aria-hidden className={`absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-surface ${device.route ? "bg-green" : "bg-ink-3"}`} />
            </span>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate text-[13.5px] font-medium text-ink">{deviceName(device)}</span>
              <span data-device-line className="text-[12px] text-ink-3">
                {asking ? removeDeviceQuestion(device) : deviceSeenLine(device, now)}
              </span>
            </div>
            {asking ? (
              <span className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => setConfirming(null)} className={SECONDARY_BUTTON}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  data-device-remove-confirm
                  onClick={() => {
                    setConfirming(null);
                    onRemove(device.key);
                  }}
                  className={DANGER_BUTTON}
                >
                  Remove
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={busy}
                data-device-remove
                onClick={() => setConfirming(device.key)}
                className="shrink-0 rounded-control px-2 py-1 text-[12.5px] text-red transition-colors hover:bg-red/5 disabled:cursor-default disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
        );
      })}
    </Group>
  );
}

function DevicesSettings() {
  const { status, setStatus, loadError } = usePhoneStatus();
  const paired = usePairedDevices();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const copyTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const run = (action: () => Promise<PhoneStatus>) => {
    setBusy(true);
    setError(null);
    action()
      .then(setStatus, (failure) => setError(ipcErrorMessage(failure)))
      .finally(() => setBusy(false));
  };
  const removeDevice = (key: string) => {
    setBusy(true);
    setError(null);
    window.milagre
      .removeDevice(key)
      .then(paired.setList, (failure) => setError(ipcErrorMessage(failure)))
      .finally(() => setBusy(false));
  };
  const copyLink = () => {
    if (!status?.pairingLink) return;
    void navigator.clipboard.writeText(status.pairingLink).then(
      () => {
        setCopied(true);
        if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
      },
      () => {},
    );
  };

  const on = status?.state === "on" && status.qrSvg && status.pairingLink;
  // Showing the QR is what invites a new device to pair, so it opens the window; a status that arrives later keeps the countdown honest.
  const showingQr = Boolean(on) && status?.remote === "relay";
  useEffect(() => {
    if (!showingQr) return;
    let live = true;
    window.milagre.openPhonePairing().then(
      (next) => {
        // oxlint-disable-next-line promise/no-callback-in-promise -- the handler receives the resolved value, not a Node-style callback
        if (live) setStatus(next);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [showingQr, setStatus]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!showingQr) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [showingQr, status?.pairingUntil]);
  const pairing = pairingWindow(status, now);
  const { computers, phones } = devicesByKind(paired.list ?? []);
  return (
    <>
      <p className="mt-1 text-[13px] text-ink-2">Phones and other Macs that can see and drive this Mac's chats.</p>
      <Group title="Access">
        <Row label="Allow devices to connect" description={loadError ?? phoneStatusLine(status)}>
          <Switch
            label="Allow devices to connect"
            checked={status?.enabled === true}
            onChange={(enabled) => {
              if (!busy && status) run(() => window.milagre.setPhoneEnabled(enabled));
            }}
          />
        </Row>
        {status?.enabled && status.lan && (
          <Row label="Allow on local network" description={phoneLanLine(status) ?? ""}>
            <Switch
              label="Allow on local network"
              checked={status.lan.enabled}
              onChange={(enabled) => {
                if (!busy) run(() => window.milagre.setPhoneLan(enabled));
              }}
            />
          </Row>
        )}
        {status?.state === "on" && status.remote === "none" && (
          <p data-phone-local-only className="px-4 py-3 text-[12px] text-ink-3">
            Only a phone simulator on this Mac can connect. Set up a Cloudflare tunnel with npm run mobile:cloudflare to reach this Mac from any network.
          </p>
        )}
        {status?.state === "error" && status.error && (
          <p data-phone-error className="break-words px-4 py-3 text-[12px] text-red">
            {status.error}
          </p>
        )}
        {error && (
          <p data-phone-action-error className="break-words px-4 py-3 text-[12px] text-red">
            Couldn't change device access: {error}
          </p>
        )}
      </Group>
      {on && (
        <Group title="Pair a device">
          <div className="flex items-start gap-5 px-4 py-4">
            <img
              data-phone-qr
              src={phoneQrSrc(status.qrSvg!)}
              alt="QR code to pair your phone"
              width={176}
              height={176}
              className="size-44 shrink-0 rounded-[10px] bg-white"
            />
            <div className="grid min-w-0 gap-3">
              <div className="grid gap-0.5">
                <span className="text-[13.5px] font-medium text-ink">Scan with the Milagre app</span>
                <span className="text-[12px] text-ink-3">Open the app on your phone and point its camera at this code.</span>
              </div>
              <div>
                <button type="button" onClick={copyLink} className={SECONDARY_BUTTON}>
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
              <p data-phone-warning className="text-[12px] text-ink-2">
                This code gives access to your agents. Don't share it or post a screenshot of it.
              </p>
              {pairing && (
                <div data-phone-pairing={pairing.open ? "open" : "closed"} className="flex flex-wrap items-center gap-3">
                  <span className="text-[12px] text-ink-3">
                    {pairing.open
                      ? `New devices can pair for ${pairing.minutes} more ${pairing.minutes === 1 ? "minute" : "minutes"}`
                      : "Pairing is closed to new devices."}
                  </span>
                  {!pairing.open && (
                    <button
                      type="button"
                      disabled={busy}
                      data-phone-allow-pairing
                      onClick={() => run(() => window.milagre.openPhonePairing())}
                      className={SECONDARY_BUTTON}
                    >
                      Allow pairing again
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </Group>
      )}
      {computers.length > 0 && <DeviceGroup title="Computers" devices={computers} now={paired.now} busy={busy} onRemove={removeDevice} />}
      <DeviceGroup title="Phones" devices={phones} now={paired.now} busy={busy} empty="No phones yet" error={paired.error} onRemove={removeDevice} />
      {status?.enabled && (
        <Group title="Reset">
          <Row
            label="Reset access"
            description={
              confirmReset
                ? "Devices that already paired stop working and must pair again. This can't be undone."
                : "Make a new code. Devices that already paired pair again."
            }
          >
            {confirmReset ? (
              <span className="flex items-center gap-2">
                <button type="button" onClick={() => setConfirmReset(false)} className={SECONDARY_BUTTON}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  data-phone-reset-confirm
                  onClick={() => {
                    setConfirmReset(false);
                    run(() => window.milagre.resetPhoneAccess());
                  }}
                  className={DANGER_BUTTON}
                >
                  Reset and disconnect
                </button>
              </span>
            ) : (
              <button type="button" disabled={busy || status.state === "starting"} onClick={() => setConfirmReset(true)} className={SECONDARY_BUTTON}>
                Reset access
              </button>
            )}
          </Row>
        </Group>
      )}
    </>
  );
}
```

In `apps/desktop/app/src/App.tsx` lines 1005-1012, change the comment to `// Clicking the "phone paired" notification opens Settings → Devices, where it can be removed.` and `setSettingsSection("phone");` to `setSettingsSection("devices");`.

- [ ] **Step 4: Run the checks to verify they pass**

Run: `npm run typecheck && node --test apps/desktop/app/src/lib/phone.test.ts apps/desktop/app/src/lib/devices.test.ts && MILAGRE_SCREENSHOT_DIR=$TMPDIR/settings-devices npm test -- --only test-settings-devices`
Expected: PASS, every `PASS:` line printed; screenshots `devices-off.png`, `phone-on.png`, `lan-on.png`, `lan-off.png`, `devices-lists.png`, `device-remove-confirm.png`, `phone-reset-confirm.png`, `phone-off-again.png` in `$TMPDIR/settings-devices`. Open `devices-lists.png` and `device-remove-confirm.png` and compare with design `settings-devices` v1: icon tile with status dot, name, line under it, red Remove.

- [ ] **Step 5: Commit**

```bash
npx oxfmt apps/desktop/app/src/components/Settings.tsx apps/desktop/app/src/App.tsx apps/desktop/app/src/lib/phone.ts apps/desktop/app/src/lib/phone.test.ts scripts/test-settings-devices.cjs
git add apps/desktop/app/src/components/Settings.tsx apps/desktop/app/src/App.tsx apps/desktop/app/src/lib/phone.ts apps/desktop/app/src/lib/phone.test.ts scripts/test-settings-devices.cjs scripts/test-phone.cjs
git commit -m "feat: Settings › Devices lists paired phones and computers and removes them"
```

---

### Task 9: The phone sends its name

**Files:**
- Create: `apps/mobile/src/phone-name.ts`, `apps/mobile/src/phone-name.test.ts`, `apps/mobile/src/phone-name-native.ts`
- Modify: `apps/mobile/src/relay-transport.ts:25-39,114-115,195`
- Modify: `apps/mobile/src/relay-native.ts:1-6,31`, `apps/mobile/src/routes-native.ts` (imports, `openLan` at :43-51)
- Test: `apps/mobile/src/relay-transport.test.ts`, `apps/mobile/src/lan-interop.test.ts`

**Interfaces:**
- Consumes: `phoneHello({ ..., name })` (Task 1); store `list()` and LAN host (Tasks 2-3) in the interop test.
- Produces: `phoneNameFrom(deviceName, modelName): string | null`; `phoneName: string | null` (native module); `RelayTransportOptions.name?: string | null`.

- [ ] **Step 1: Check the fingerprint before writing**

```bash
cd apps/mobile
npx expo-updates fingerprint:generate --platform ios | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).hash))'
npx eas-cli@latest build:list --platform ios --status finished --limit 1 --json --non-interactive | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].runtimeVersion))'
cd ../..
```

Expected: the two hashes are equal. Write both down. If they already differ before any change, stop and report it; it is not this PR's change.

- [ ] **Step 2: Write the failing tests**

Create `apps/mobile/src/phone-name.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { phoneNameFrom } from "./phone-name.ts";

test("the phone sends the name its owner gave it, or its model when iOS only shares a generic one", () => {
  assert.equal(phoneNameFrom("Victor's iPhone", "iPhone 16 Pro"), "Victor's iPhone");
  assert.equal(phoneNameFrom("iPhone", "iPhone 16 Pro"), "iPhone 16 Pro");
  assert.equal(phoneNameFrom("iPad", "iPad mini"), "iPad mini");
  assert.equal(phoneNameFrom("iPhone", null), "iPhone");
  assert.equal(phoneNameFrom(null, "Pixel 9"), "Pixel 9");
  assert.equal(phoneNameFrom(null, null), null);
  assert.equal(phoneNameFrom("   ", undefined), null);
  assert.equal(phoneNameFrom("x".repeat(80), null), "x".repeat(64));
});
```

In `apps/mobile/src/relay-transport.test.ts`, change the fake relay's state (in `relay()`) to `const state = { mode: "host" as Mode, ping: 0, names: [] as (string | null)[] };` and, right after `const accepted = hostAccept({ host, hello: bytes, isKnown: () => true, token: TOKEN, random });`, add `state.names.push(accepted.name);`. Append:

```ts
test("the hello carries the phone's name when it has one", async () => {
  const fake = relay();
  const named = transportFor(fake, { name: "Victor's iPhone" });
  await named.transport.ready();
  named.transport.close();
  const unnamed = transportFor(fake);
  await unnamed.transport.ready();
  unnamed.transport.close();
  assert.deepEqual(fake.state.names, ["Victor's iPhone", null]);
});
```

In `apps/mobile/src/lan-interop.test.ts`, change `lanPair`'s signature to `async function lanPair(t: TestContext, { known, name }: { known: boolean; name?: string })`, pass `name,` in its `createRelayTransport({...})` options, return `{ transport, bridge, phones }`, add `until` to the `relay-test-kit.cjs` require (`const { startFakeBridge, TOKEN, until } = ...`), and append:

```ts
test("a phone that names itself over the LAN shows that name on the Mac", async (t) => {
  const { transport, phones } = await lanPair(t, { known: true, name: "Victor's iPhone" });
  await transport.ready();
  await until(() => phones.list()[0]?.name === "Victor's iPhone", "the name from the hello");
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/mobile && node --test src/phone-name.test.ts src/relay-transport.test.ts src/lan-interop.test.ts; cd ../..`
Expected: FAIL: `phone-name.ts` missing; `names` is `[null, null]`; the LAN name never arrives.

- [ ] **Step 4: Implement**

Create `apps/mobile/src/phone-name.ts`:

```ts
// What iOS reports for every device when the app may not read the name its owner chose (iOS 16 and later without the
// user-assigned-device-name entitlement, which would need a new native build).
const GENERIC = new Set(["iPhone", "iPad", "iPod touch"]);
const MAX_NAME = 64;

/** What this phone is called in Settings › Devices on a Mac: its owner's name for it, else its model, else null. */
export function phoneNameFrom(deviceName: string | null | undefined, modelName: string | null | undefined): string | null {
  const own = deviceName?.trim() || null;
  const model = modelName?.trim() || null;
  const name = own && !GENERIC.has(own) ? own : (model ?? own);
  return name ? Array.from(name).slice(0, MAX_NAME).join("") : null;
}
```

Create `apps/mobile/src/phone-name-native.ts`:

```ts
import * as Device from "expo-device";
import { phoneNameFrom } from "./phone-name";

/** Read once per launch: a phone renamed in iOS Settings sends the new name after the app restarts. */
export const phoneName = phoneNameFrom(Device.deviceName, Device.modelName);
```

In `apps/mobile/src/relay-transport.ts`, add to `RelayTransportOptions` (after `identity: KeyPair;`):

```ts
  /** What this phone calls itself; the Mac shows it in Settings › Devices. */
  name?: string | null;
```

and change the hello on line 195 to:

```ts
        hello = phoneHello({ phone: identity, host, token, random, name: options.name ?? undefined });
```

In `apps/mobile/src/relay-native.ts`, add `import { phoneName } from "./phone-name-native";` and change line 31 to:

```ts
    const transport = createRelayTransport({ relay: relay.url, hostId: relay.hostId, key: relay.key, token, identity, random: phoneRandom, name: phoneName });
```

In `apps/mobile/src/routes-native.ts`, add `import { phoneName } from "./phone-name-native";` and add `name: phoneName,` to the `createRelayTransport({...})` options in `openLan` (after `random: phoneRandom,`).

Update the user-visible copy in `relay-transport.ts` COPY in Task 10, not here.

- [ ] **Step 5: Run the tests and the mobile typecheck**

Run: `cd apps/mobile && node --test src/phone-name.test.ts src/relay-transport.test.ts src/lan-interop.test.ts; cd ../.. && npm run typecheck:mobile`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Check the fingerprint again**

Run the two commands from Step 1.
Expected: the same hash as before, still equal to the TestFlight build's `runtimeVersion` (`expo-device` is already linked through `push-native.ts`, and no `app.json` or dependency changed). If it differs, stop: do not commit or merge; report what changed it.

- [ ] **Step 7: Commit**

```bash
npx oxfmt apps/mobile/src/phone-name.ts apps/mobile/src/phone-name.test.ts apps/mobile/src/phone-name-native.ts apps/mobile/src/relay-transport.ts apps/mobile/src/relay-transport.test.ts apps/mobile/src/relay-native.ts apps/mobile/src/routes-native.ts apps/mobile/src/lan-interop.test.ts
git add apps/mobile/src/phone-name.ts apps/mobile/src/phone-name.test.ts apps/mobile/src/phone-name-native.ts apps/mobile/src/relay-transport.ts apps/mobile/src/relay-transport.test.ts apps/mobile/src/relay-native.ts apps/mobile/src/routes-native.ts apps/mobile/src/lan-interop.test.ts
git commit -m "feat(mobile): the phone sends its name when it says hello to a Mac"
```

---

### Task 10: "Settings → Devices" everywhere, and the glossary

**Files:**
- Modify copy: `apps/mobile/src/relay-transport.ts:52-56`, `apps/mobile/src/pairing.ts:23`, `apps/mobile/src/client.ts:58,260`, `apps/mobile/src/app/index.tsx:222`, `apps/mobile/src/app/add-computer.tsx:152`, `apps/desktop/electron/notifications.cjs:126,131`, `apps/desktop/app/src/electron.d.ts:348`
- Modify tests: `apps/mobile/src/relay-transport.test.ts:12-15`, `apps/mobile/src/client.test.ts:224`, `apps/desktop/electron/notifications.test.cjs:155,161`
- Modify docs: `README.md:19`, `docs/mobile-local.md:7,123`, `docs/local-daemon.md:3,32`, `packages/core/src/bundled-skills/milagre-help/references/phone.md:3,13`
- Modify: `GLOSSARY.md`

**Interfaces:**
- Consumes: the section name from Task 8.
- Produces: no code interface; user-facing copy only.

- [ ] **Step 1: Change the tests' expected copy first**

```bash
sed -i '' 's/Settings → Phone/Settings → Devices/g' apps/mobile/src/relay-transport.test.ts apps/mobile/src/client.test.ts
sed -i '' "s/Settings › Phone/Settings › Devices/; s/If it wasn't you, reset access in Settings → Phone/If it wasn't you, remove it in Settings → Devices/" apps/desktop/electron/notifications.test.cjs
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test apps/desktop/electron/notifications.test.cjs && cd apps/mobile && node --test src/relay-transport.test.ts src/client.test.ts; cd ../..`
Expected: FAIL on the old "Settings → Phone" copy.

- [ ] **Step 3: Change the copy**

```bash
sed -i '' 's/Settings → Phone/Settings → Devices/g' apps/mobile/src/relay-transport.ts apps/mobile/src/pairing.ts apps/mobile/src/client.ts apps/mobile/src/app/index.tsx apps/mobile/src/app/add-computer.tsx apps/desktop/electron/notifications.cjs apps/desktop/app/src/electron.d.ts
sed -i '' "s/If it wasn't you, reset access in Settings → Devices/If it wasn't you, remove it in Settings → Devices/" apps/desktop/electron/notifications.cjs
sed -i '' 's/turn on phone access and scan the QR code it shows/turn on Allow devices to connect and scan the QR code it shows/' apps/mobile/src/app/add-computer.tsx
sed -i '' 's/Settings > Phone/Settings > Devices/g; s/Settings › Phone/Settings › Devices/g; s/Allow your phone to connect/Allow devices to connect/g' README.md docs/mobile-local.md docs/local-daemon.md packages/core/src/bundled-skills/milagre-help/references/phone.md
```

In `docs/mobile-local.md` line 123, after the sentence ending "`phone:open-pairing` are not available through the bridge itself." add: "Settings › Devices also lists each phone that paired through the relay or the local network, with its name and when it was last seen, and removes one; a removed phone can pair again only once the code is shown again. `devices:list` and `devices:remove` are not available through the bridge either."

Check: `grep -rn "Settings → Phone\|Settings › Phone\|Settings > Phone" apps packages README.md docs --include='*' | grep -v node_modules | grep -v docs/superpowers` prints nothing.

- [ ] **Step 4: Add the glossary terms**

In `GLOSSARY.md`, before `## Relationships`, add:

```markdown
### Computers and devices

**Computer**:
A Mac running Milagre, whose daemon owns its **Projects**. "This Mac" is the **Computer** a window runs on; other **Computers** can be paired to it.
_Avoid_: host, machine, server (code says host; the UI says computer or Mac)

**Device**:
A phone or **Computer** paired to a Mac. That Mac's Settings › Devices lists each one, says whether it is connected now or when it was last seen, and removes it.
_Avoid_: client (any connection to the daemon, this Mac's own window included)
```

and under `## Relationships` add:

```markdown
- A **Project** lives on exactly one **Computer**, whose daemon is its only writer (ADR-0003).
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test apps/desktop/electron/notifications.test.cjs && cd apps/mobile && node --test src/relay-transport.test.ts src/client.test.ts; cd ../.. && npm run typecheck && npm run typecheck:mobile`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx oxfmt apps/mobile/src apps/desktop/electron/notifications.cjs apps/desktop/electron/notifications.test.cjs apps/desktop/app/src/electron.d.ts README.md docs/mobile-local.md docs/local-daemon.md packages/core/src/bundled-skills/milagre-help/references/phone.md GLOSSARY.md
git add apps/mobile/src apps/desktop/electron/notifications.cjs apps/desktop/electron/notifications.test.cjs apps/desktop/app/src/electron.d.ts README.md docs/mobile-local.md docs/local-daemon.md packages/core/src/bundled-skills/milagre-help/references/phone.md GLOSSARY.md
git commit -m "docs: Settings › Phone is now Settings › Devices; add Computer and Device to the glossary"
```

---

### Task 11: Full checks and PR screenshots

**Files:** none changed in the PR branch; screenshots go to the `screenshots` branch.

**Interfaces:**
- Consumes: everything above.
- Produces: a branch ready for review.

- [ ] **Step 1: Run every check AGENTS.md asks for**

Run: `npm run typecheck && npm run typecheck:mobile && npm run lint && npm run knip && npm test -- --unit && npm test -- --only test-settings-devices && npm test -- --only test-experimental-settings`
Expected: all PASS; `knip` reports nothing new. `test-experimental-settings` opens Settings too and must still find its section.

- [ ] **Step 2: Confirm the socket tests were untouched**

Run: `git diff origin/main --stat -- apps/daemon/src/server.test.cjs`
Expected: no output.

- [ ] **Step 3: Confirm the fingerprint one last time**

Run the two commands from Task 9 Step 1.
Expected: equal hashes. Do not run `npm run update:testflight`; publishing the OTA is a separate step after merge.

- [ ] **Step 4: Put the screenshots on the `screenshots` branch**

```bash
MILAGRE_SCREENSHOT_DIR=$TMPDIR/settings-devices npm test -- --only test-settings-devices
git fetch origin screenshots
git worktree add $TMPDIR/shots origin/screenshots
mkdir -p $TMPDIR/shots/settings-devices
cp $TMPDIR/settings-devices/{devices-off,phone-on,devices-lists,device-remove-confirm}.png $TMPDIR/shots/settings-devices/
git -C $TMPDIR/shots add settings-devices
git -C $TMPDIR/shots commit -m "screenshots: settings devices"
git -C $TMPDIR/shots push origin HEAD:screenshots
git -C $TMPDIR/shots rev-parse HEAD
git worktree remove $TMPDIR/shots
```

Use the printed SHA for the PR body links: `https://raw.githubusercontent.com/the-ptf/milagre-ade/<sha>/settings-devices/<name>.png`.

---

## Self-review notes

- Spec coverage for step 1 of its "Order of work": `acceptConnection` (Task 5), devices store and migration (Task 2), `devices:list`/`devices:remove` (Task 6), Settings › Devices on desktop (Task 8), the phone sending its name (Task 9), glossary terms (Task 10). The deny-set hook (Task 5) is in because PR 2 depends on it; the channel, `rpc`/`evt`/`part`, `desktop-peer-v1` and the end-to-end test stay in PR 2.
- Beyond the spec, and why: a removed device is kept out of the pairing window it was removed in (`removed` in `devices.json`, per-device `canPair`), because Settings › Devices opens the window just by being shown and the phone redials within seconds; `seen` also refreshes the name, so phones migrated with `name: null` get one after the OTA; the hello refuses `kind: "desktop"` until PR 2 so a PR 1 daemon never saves a desktop as a phone; the phone falls back to its model name because iOS 16+ reports "iPhone" without an entitlement.
- Known limits left for later: a removed phone keeps its push registration until Reset (push devices in `mobile-push.cjs` are keyed by a phone-made `deviceId`, not the pairing key); phones on a Cloudflare tunnel use the bearer token and never appear in the list; "Connected now" can lag by up to 15 s since a device connecting sends no event.
