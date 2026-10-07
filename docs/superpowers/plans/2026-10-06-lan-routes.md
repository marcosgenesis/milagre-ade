# LAN Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The phone talks to the Mac directly over the LAN when both share a network, falls back to Cloudflare or the relay otherwise, and switches on its own, including mid-session.

**Architecture:** The daemon gets a second WebSocket listener on `0.0.0.0:8798` that speaks the relay's end-to-end encrypted phone protocol, served by the same per-phone logic as the relay host (extracted into `phone-channels.cjs`). The Mac advertises its private IPv4 endpoints and box key through a new bridge RPC, `phone:routes`, over the route the phone already trusts. On the phone, a route supervisor per computer probes the LAN endpoints, opens a relay transport against the LAN socket with the Mac's key pinned, and the client sends every request and live stream through it while it is up.

**Tech Stack:** Node 24 (`node:test`, `ws`, `tweetnacl`), Electron + React desktop, Expo 57 / React Native (TypeScript, `node --test` with type stripping), `expo-network`, `expo-build-properties`.

**Spec:** `docs/superpowers/specs/2026-10-06-lan-routes-design.md`

## Global Constraints

- LAN listener: port `8798` (`LAN_PORT`), bound to `0.0.0.0`. The loopback bridge on `127.0.0.1:8797` and its Host/Origin checks do not change.
- LAN traffic is only the relay protocol (box hello + secretbox frames). Never plain HTTP with the bearer token on the LAN.
- The LAN listener never opens a pairing window: `canPair: () => false`.
- Advertised endpoints: IPv4 private ranges only (10/8, 172.16/12, 192.168/16), no internal, link-local or virtual interfaces (`utun*`, `bridge*`, `vmnet*`, `awdl*`, `llw*`), never hostnames. Format `ws://<ip>:<port>`.
- Phone probe: `GET http://<ip>:<port>/v1/hello`, 2500 ms timeout, valid only when `{ v: 1, hostId }` matches.
- A LAN route that answers the probe but fails to open is held back for 5 minutes. A route lost after it was up is not held.
- Re-check triggers: every 60 s while the app is active, on `AppState` active, on `expo-network` state change.
- Desktop copy: switch label "Allow on local network"; status "Reachable at <ip>[, <ip>]" or "Off". Phone copy: row subtitle "Online · Local network".
- Daemon never binds the LAN port when `allowedRoot` is set (review demo) or when `lanPort` is `null`. Tests always pass `lanPort: null` or `lanPort: 0` with `lanHostname: "127.0.0.1"`; never 8797/8798, never Victor's data dir.
- Native build: `expo-network`, `expo-build-properties` (`android.usesCleartextTraffic: true`), `ios.infoPlist.NSLocalNetworkUsageDescription` = "Milagre connects to your computer directly when you are on the same network." Approved by Victor on 2026-10-06. No agent runs EAS build, TestFlight upload or APK build.
- App copy, commits and PR text in English. No Claude attribution anywhere.
- Before the PR: `npm run typecheck`, `npm run typecheck:mobile`, `npm run lint`, `npm test -- --unit`, `npm test -- --only test-phone`.

## Review Focus

1. **Two Milagre daemons on one Mac** (packaged app plus a dev build, or the review demo). The second one cannot bind 8798. Phone access must still start, with `lan.error` set. Pinned in Task 3.
2. **A saved LAN IP that belongs to another machine on another network** (home and office are both 192.168.1.x). The probe's `hostId` check rejects it, and even a forged `/v1/hello` cannot finish the hello without the pinned key. Pinned in Task 6 (hostId mismatch) and Task 2 (wrong key refused).
3. **The Mac's IP changes** after DHCP renews or the Mac moves to another Wi-Fi. The old endpoint stops answering, the phone falls back to the primary route, and the next `phone:routes` answer replaces the endpoints. Pinned in Task 6 (endpoint not advertised anymore) and Task 8 (relearn on connect).
4. **An older Mac** (no `phone:routes`) or **the review demo** (`allowedRoot`). The RPC answers 403 and the phone keeps working over the primary route with no LAN entry saved. Pinned in Task 3 and Task 8.
5. **The app goes to the background while on LAN.** The LAN socket closes without demoting the route. On foreground the endpoint is probed again and the transport reopens lazily; live streams come back through the existing foreground resync. Pinned in Task 6 (`suspend`).

---

## File Structure

Daemon (`apps/daemon/src/`):
- Create `phone-channels.cjs`: the per-phone encrypted channel logic moved out of `relay-host.cjs` (hello, requests, live sockets, limits).
- Modify `relay-host.cjs`: keeps only the relay socket lifecycle and delegates phones to `phone-channels.cjs`.
- Create `lan-addresses.cjs`: which IPv4 addresses to advertise.
- Create `lan-host.cjs`: the `0.0.0.0:8798` listener (`/v1/hello`, `/v1/phone`).
- Create `relay-test-kit.cjs`: test helpers shared by `relay-host.test.cjs` and `lan-host.test.cjs` (moved from `relay-host.test.cjs`).
- Modify `phone.cjs`: identity and phone list in every mode, the LAN host, `setLan`, `routes`, status `lan`.
- Modify `mobile-bridge.cjs`: answers `phone:routes` itself.
- Modify `server.cjs`: `phone:set-lan`.

Desktop:
- Modify `apps/desktop/electron/preload.cjs`, `apps/desktop/app/src/electron.d.ts`, `apps/desktop/app/src/lib/phone.ts`, `apps/desktop/app/src/components/Settings.tsx`, `scripts/test-phone.cjs`.

Mobile (`apps/mobile/src/`):
- Create `lan-route.ts`: `LanRoute` type and validation (pure).
- Modify `hosts-store.ts`: saves `routes.lan`, `learn()`.
- Modify `relay-transport.ts`: `ready()` and `onLost`.
- Create `routes.ts`: the route supervisor (pure).
- Modify `client.ts`: sends through the LAN transport when it is up.
- Create `routes-native.ts`: supervisors per computer, probe, triggers, learning.
- Modify `relay-native.ts`, `session.tsx`, `app/index.tsx`, `hosts-native.ts` (if `learn` needs exporting), `app.json`, `package.json`.

---

### Task 1: Extract the per-phone channel from the relay host

Pure refactor. Every existing `relay-host.test.cjs` test must stay green unchanged.

**Files:**
- Create: `apps/daemon/src/phone-channels.cjs`
- Modify: `apps/daemon/src/relay-host.cjs` (lines 1-46 constants, 87-327 per-phone functions, `connect()` session object)
- Test: `apps/daemon/src/relay-host.test.cjs` (unchanged, must pass)

**Interfaces:**
- Produces: `createPhoneChannels({ identity, phones, token, bridgeUrl, canPair, retired, WebSocket, fetch, random, helloMs })` returning `{ onFrame(session, data), dropConn(session, conn, notify) }`. A `session` is `{ conns: Map<bigint, record>, send(bytes: Uint8Array): void }`. Also exports `frame(type, conn, payload)`, `OPEN = 1`, `DATA = 2`, `CLOSE = 3`.

- [ ] **Step 1: Run the relay host tests to record the baseline**

Run: `node --test apps/daemon/src/relay-host.test.cjs`
Expected: all PASS.

- [ ] **Step 2: Create `phone-channels.cjs`**

Move, verbatim, from `relay-host.cjs` into this file: the requires for `hostAccept`, `RelayAuthError`, `splitBody`, `createAssembler`, `MAX_RESPONSE`; the constants `OPEN`, `DATA`, `CLOSE`, `ERROR_MARK`, `LIVE_ORIGIN`, `MAX_LIVE`, `MAX_INFLIGHT`, `MAX_UPLOAD`, `REQUEST_TIMEOUT`, `BLOCKED_HEADERS`, `FORWARDED_HEADERS`, `encoder`, `frame`, `tooLarge`, `tooManyRequests`, `routeOk`, `JSON_HEADERS`; and the functions `sendMessage`, `closeLives`, `dropConn`, `refuse`, `hello`, `respond`, `forward`, `requestPart`, `refuseRequest`, `liveOpen`, `handleMessage`, `onFrame`. Wrap them in a factory:

```js
const { hostAccept, RelayAuthError } = require("@milagre/shared/relay-crypto");
const { splitBody, createAssembler, MAX_RESPONSE } = require("@milagre/shared/relay-rpc");

// ...moved constants, `frame`, `tooLarge`, `tooManyRequests`, `routeOk`, `JSON_HEADERS`...

/**
 * One encrypted channel per phone, whatever carries its bytes: the public relay (frames multiplexed on the Mac's
 * relay socket) or the LAN listener (one socket per phone). A `session` is `{ conns, send(bytes) }`; `send` takes a
 * whole frame (type, conn id, payload) and delivers it to that phone.
 */
function createPhoneChannels({ identity, phones, token, bridgeUrl, canPair, retired = false, WebSocket, fetch: fetchBridge, random, helloMs }) {
  const sendFrame = (current, type, conn, payload) => current.send(frame(type, conn, payload));
  // ...moved functions, unchanged except: every `sendRaw(current, bytes)` becomes `current.send(bytes)`,
  // and `sendFrame` is the one above...
  return { onFrame, dropConn };
}

module.exports = { createPhoneChannels, frame, OPEN, DATA, CLOSE };
```

`sendMessage` keeps its `WebSocket.OPEN` checks on live sockets (`liveOpen`, `handleMessage`), which is why `WebSocket` is a parameter.

- [ ] **Step 3: Make `relay-host.cjs` use it**

In `startRelayHost`, after the timing destructure:

```js
const channels = createPhoneChannels({ identity, phones, token, bridgeUrl, canPair, retired, WebSocket, fetch: fetchBridge, random, helloMs });
```

Delete the moved functions and constants. Keep `sendRaw` only for the session's `send`. In `connect()`, give the session object its `send`:

```js
const current = { socket: ws, conns: new Map(), ready: false, lastHeard: Date.now(), timer: null, readyTimer: null, stableTimer: null, over: false };
current.send = (bytes) => sendRaw(current, bytes);
```

Replace `onFrame(current, data)` with `channels.onFrame(current, data)`, and both `dropConn(current, conn, false)` calls (in `finish` and `close`) with `channels.dropConn(current, conn, false)`. Remove now-unused requires (`hostAccept`, `RelayAuthError`, `splitBody`, `createAssembler`, `MAX_RESPONSE`) and add `const { createPhoneChannels } = require("./phone-channels.cjs");`.

- [ ] **Step 4: Run the relay host tests**

Run: `node --test apps/daemon/src/relay-host.test.cjs && npx oxlint apps/daemon/src`
Expected: all PASS, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/phone-channels.cjs apps/daemon/src/relay-host.cjs
git commit -m "refactor(daemon): serve relay phones through a reusable phone channel"
```

---

### Task 2: LAN addresses and the LAN listener

**Files:**
- Create: `apps/daemon/src/lan-addresses.cjs`, `apps/daemon/src/lan-addresses.test.cjs`
- Create: `apps/daemon/src/lan-host.cjs`, `apps/daemon/src/lan-host.test.cjs`
- Create: `apps/daemon/src/relay-test-kit.cjs` (moved helpers)
- Modify: `apps/daemon/src/relay-host.test.cjs` (import the moved helpers)

**Interfaces:**
- Consumes: `createPhoneChannels`, `frame`, `OPEN`, `DATA`, `CLOSE` from Task 1.
- Produces:
  - `lanAddresses(interfaces = os.networkInterfaces()): string[]`, sorted, deduplicated.
  - `startLanHost({ port, hostname = "0.0.0.0", identity, phones, token, bridgeUrl, WebSocket?, fetch?, random?, helloMs? }): Promise<{ port: number, close(): Promise<void> }>`.
  - `relay-test-kit.cjs` exports `{ until, startFakeBridge, connectPhone, TOKEN, random, LIVE_ORIGIN }`.

- [ ] **Step 1: Write the failing address test**

`apps/daemon/src/lan-addresses.test.cjs`:

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { lanAddresses } = require("./lan-addresses.cjs");

const v4 = (address, internal = false) => ({ address, family: "IPv4", internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null });

test("only private IPv4 addresses of physical interfaces are advertised", () => {
  const found = lanAddresses({
    lo0: [v4("127.0.0.1", true)],
    en0: [v4("192.168.1.20"), { ...v4("fe80::1"), family: "IPv6" }],
    en1: [v4("10.0.0.7")],
    en5: [v4("172.20.3.4"), v4("172.32.0.1"), v4("169.254.10.10")],
    utun3: [v4("100.101.102.103")],
    bridge100: [v4("192.168.64.1")],
    vmnet8: [v4("172.16.5.1")],
    awdl0: [v4("10.9.9.9")],
    llw0: [v4("10.8.8.8")],
    en7: [v4("8.8.8.8")],
  });
  assert.deepEqual(found, ["10.0.0.7", "172.20.3.4", "192.168.1.20"]);
});

test("the same address on two interfaces is listed once", () => {
  assert.deepEqual(lanAddresses({ en0: [v4("192.168.1.20")], en1: [v4("192.168.1.20")] }), ["192.168.1.20"]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test apps/daemon/src/lan-addresses.test.cjs`
Expected: FAIL, "Cannot find module './lan-addresses.cjs'".

- [ ] **Step 3: Implement `lan-addresses.cjs`**

```js
const os = require("node:os");

// Tunnels, VM bridges and Apple's peer-to-peer links: a phone on the Wi-Fi can't reach these.
const VIRTUAL = /^(utun|bridge|vmnet|awdl|llw|gif|stf|anpi|ap)\d*/;

function isPrivate(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The addresses a phone on the same network can dial. Numbers only: a name like `mac.local` can resolve to
 * another machine on another network, and the phone would hand it a hello.
 */
function lanAddresses(interfaces = os.networkInterfaces()) {
  const found = new Set();
  for (const [name, entries] of Object.entries(interfaces)) {
    if (VIRTUAL.test(name)) continue;
    for (const entry of entries ?? []) {
      if ((entry.family === "IPv4" || entry.family === 4) && !entry.internal && isPrivate(entry.address)) found.add(entry.address);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

module.exports = { lanAddresses };
```

- [ ] **Step 4: Run it**

Run: `node --test apps/daemon/src/lan-addresses.test.cjs`
Expected: PASS.

- [ ] **Step 5: Move the shared test helpers**

Create `apps/daemon/src/relay-test-kit.cjs` and move into it, verbatim, from `relay-host.test.cjs`: `random`, `TOKEN`, `LIVE_ORIGIN`, `sleep`, `listen`, `until`, `startFakeBridge`, `connectPhone` (with their requires). Export them:

```js
module.exports = { random, TOKEN, LIVE_ORIGIN, sleep, listen, until, startFakeBridge, connectPhone };
```

In `relay-host.test.cjs`, replace those definitions with:

```js
const { random, TOKEN, LIVE_ORIGIN, sleep, listen, until, startFakeBridge, connectPhone } = require("./relay-test-kit.cjs");
```

Run: `node --test apps/daemon/src/relay-host.test.cjs`
Expected: PASS (same count as Task 1).

- [ ] **Step 6: Write the failing LAN host tests**

`apps/daemon/src/lan-host.test.cjs`:

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { b64url, boxKeyPair } = require("@milagre/shared/relay-crypto");
const { readIdentity, createPhones } = require("./relay-identity.cjs");
const { startLanHost } = require("./lan-host.cjs");
const { random, startFakeBridge, connectPhone, until } = require("./relay-test-kit.cjs");

async function lanMac(t, { knownPhone = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lan-host-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const identity = await readIdentity(dir);
  const phones = createPhones(dir);
  await phones.load();
  const key = boxKeyPair(random);
  if (knownPhone) await phones.add(b64url(key.publicKey));
  const bridge = await startFakeBridge(t);
  const host = await startLanHost({ port: 0, hostname: "127.0.0.1", identity, phones, token: "a".repeat(64), bridgeUrl: bridge.url });
  t.after(() => host.close());
  return { identity, key, bridge, host, url: `ws://127.0.0.1:${host.port}` };
}

test("/v1/hello names this Mac and nothing else", async (t) => {
  const { identity, host } = await lanMac(t);
  const response = await fetch(`http://127.0.0.1:${host.port}/v1/hello`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { v: 1, hostId: identity.hostId });
  assert.equal((await fetch(`http://127.0.0.1:${host.port}/rpc`)).status, 404);
});

test("a known phone calls /rpc over the LAN socket", async (t) => {
  const { identity, key, bridge, url } = await lanMac(t);
  const phone = connectPhone({ relayUrl: url, identity, key });
  t.after(() => phone.close());
  const result = await phone.hello();
  assert.ok(result.channel, JSON.stringify(result));
  phone.request(1, { method: "POST", path: "/rpc", headers: { "content-type": "application/json" }, body: '{"v":1,"method":"daemon:status","args":[]}' });
  const response = await phone.response(1);
  assert.equal(response.status, 200);
  assert.equal(new TextDecoder().decode(response.body), '{"v":1,"result":"pong"}');
  assert.equal(bridge.seen.requests.at(-1).authorization, `Bearer ${"a".repeat(64)}`);
});

test("an unknown phone is refused: the LAN never opens pairing", async (t) => {
  const { identity, url } = await lanMac(t, { knownPhone: false });
  const phone = connectPhone({ relayUrl: url, identity });
  t.after(() => phone.close());
  assert.deepEqual((await phone.hello()).error, { t: "error", code: "unknown-phone" });
});

test("a phone pinning another Mac's key cannot finish the hello", async (t) => {
  const { identity, key, url } = await lanMac(t);
  const other = { ...identity, box: boxKeyPair(random) };
  const phone = connectPhone({ relayUrl: url, identity: other, key });
  t.after(() => phone.close());
  // The hello is sealed to a key this Mac does not hold: it can't open it and refuses.
  assert.deepEqual((await phone.hello()).error, { t: "error", code: "bad-hello" });
});

test("a wrong host id gets no socket", async (t) => {
  const { url } = await lanMac(t);
  const { WebSocket } = require("ws");
  const ws = new WebSocket(`${url}/v1/phone?id=${"A".repeat(22)}`);
  const outcome = await new Promise((resolve) => {
    ws.on("open", () => resolve("open"));
    ws.on("error", () => resolve("refused"));
  });
  assert.equal(outcome, "refused");
});

test("closing the host closes its phones", async (t) => {
  const { identity, key, host, url } = await lanMac(t);
  const phone = connectPhone({ relayUrl: url, identity, key });
  assert.ok((await phone.hello()).channel);
  await host.close();
  await until(async () => (await Promise.race([phone.closed, new Promise((r) => setTimeout(() => r(null), 50))])) !== null, "phone closed");
});
```

The fake bridge's `requests` entries must record `authorization`; if `startFakeBridge` does not already store it, add `authorization: request.headers.authorization` to the object it pushes (check the moved code first).

- [ ] **Step 7: Run them to see them fail**

Run: `node --test apps/daemon/src/lan-host.test.cjs`
Expected: FAIL, "Cannot find module './lan-host.cjs'".

- [ ] **Step 8: Implement `lan-host.cjs`**

```js
const http = require("node:http");
const { randomBytes } = require("node:crypto");
const { WebSocketServer, WebSocket: NodeWebSocket } = require("ws");
const { createPhoneChannels, frame, OPEN, DATA, CLOSE } = require("./phone-channels.cjs");

const MAX_PHONES = 16;
// Larger than one sealed 256 KiB upload chunk, base64 and all.
const MAX_FRAME = 4 * 1024 * 1024;
const HELLO_MS = 15_000;
const notFound = "HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n";

/**
 * Phone access on the local network: the relay's phone protocol, end to end encrypted, over a socket the phone
 * dials directly. `/v1/hello` lets a phone check, without credentials, that this address is still this Mac.
 * Pairing never happens here: a phone must already be known (paired over the relay, or registered through
 * `phone:routes` on a route it trusts).
 */
function startLanHost({
  port,
  hostname = "0.0.0.0",
  identity,
  phones,
  token,
  bridgeUrl,
  WebSocket = NodeWebSocket,
  fetch = globalThis.fetch,
  random = (n) => new Uint8Array(randomBytes(n)),
  helloMs = HELLO_MS,
}) {
  const channels = createPhoneChannels({ identity, phones, token, bridgeUrl, canPair: () => false, WebSocket, fetch, random, helloMs });
  const sockets = new Map(); // conn id -> the phone's socket
  let nextConn = 1n;
  const session = {
    conns: new Map(),
    send(bytes) {
      const conn = new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(1);
      const ws = sockets.get(conn);
      if (!ws) return;
      if (bytes[0] === DATA) {
        if (ws.readyState === NodeWebSocket.OPEN) ws.send(bytes.subarray(9));
      } else if (bytes[0] === CLOSE) {
        sockets.delete(conn);
        ws.close(1000);
      }
    },
  };
  const hello = JSON.stringify({ v: 1, hostId: identity.hostId });
  const server = http.createServer((req, res) => {
    const target = new URL(req.url, "http://lan");
    if (req.method === "GET" && target.pathname === "/v1/hello") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(hello);
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => {});
    const target = new URL(req.url, "http://lan");
    if (target.pathname !== "/v1/phone" || target.searchParams.get("id") !== identity.hostId || sockets.size >= MAX_PHONES) {
      socket.end(notFound);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = nextConn++;
      sockets.set(conn, ws);
      channels.onFrame(session, frame(OPEN, conn));
      ws.on("message", (data, isBinary) => {
        // Nothing a phone sends may take the daemon down.
        try {
          if (!isBinary) return ws.close(1003);
          channels.onFrame(session, frame(DATA, conn, new Uint8Array(data)));
        } catch {
          ws.terminate();
        }
      });
      ws.on("close", () => {
        if (sockets.get(conn) === ws) sockets.delete(conn);
        channels.onFrame(session, frame(CLOSE, conn));
      });
      ws.on("error", () => {});
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => {
      server.off("error", reject);
      resolve({
        port: server.address().port,
        async close() {
          for (const ws of sockets.values()) ws.terminate();
          sockets.clear();
          server.closeAllConnections?.();
          await new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

module.exports = { startLanHost, LAN_PORT: 8798 };
```

- [ ] **Step 9: Run the tests**

Run: `node --test apps/daemon/src/lan-host.test.cjs apps/daemon/src/relay-host.test.cjs apps/daemon/src/lan-addresses.test.cjs`
Expected: PASS. If "a phone pinning another Mac's key" gets a different refusal code, read `hostAccept` in `packages/shared/src/relay-crypto.mjs` (it throws `bad-hello` when `box.open` fails) and match the test to what `refuse` sends; the assertion that matters is that no channel opens.

- [ ] **Step 10: Commit**

```bash
git add apps/daemon/src/lan-addresses.cjs apps/daemon/src/lan-addresses.test.cjs apps/daemon/src/lan-host.cjs apps/daemon/src/lan-host.test.cjs apps/daemon/src/relay-test-kit.cjs apps/daemon/src/relay-host.test.cjs
git commit -m "feat(daemon): serve paired phones over the local network"
```

---

### Task 3: Phone access runs the LAN host and answers `phone:routes`

**Files:**
- Modify: `apps/daemon/src/phone.cjs` (config load/save, `status`, `launch`, `closeLive`, new `setLan`, new `routes`)
- Modify: `apps/daemon/src/mobile-bridge.cjs:246` (options) and the `/rpc` branch near `:555`
- Modify: `apps/daemon/src/server.cjs:19` and the dispatch near `:362`
- Modify: `scripts/review-demo.cjs:148` (no LAN), test fixtures that enable phone access
- Test: `apps/daemon/src/phone.test.cjs`, `apps/daemon/src/server.test.cjs`

**Interfaces:**
- Consumes: `startLanHost`, `LAN_PORT` (Task 2), `lanAddresses` (Task 2), `readIdentity`, `createPhones`.
- Produces:
  - `createPhone({ ..., startLan = startLanHost, lanPort = LAN_PORT, lanHostname = "0.0.0.0", addresses = lanAddresses })`. `lanPort: null` disables the LAN.
  - `phone.setLan(enabled: boolean): Promise<Status>`.
  - `status().lan = { enabled: boolean, addresses: string[], error?: string }` (present whenever the config is loaded).
  - Bridge option `phoneRoutes(phoneKey: string) => Promise<{ hostId: string, key: string, lan: string[] }>`; RPC `phone:routes` with `args: [{ phoneKey }]` answers that object.
  - Daemon RPC `phone:set-lan` with `args: [boolean]`.

- [ ] **Step 1: Update the test fixtures so no test binds a real LAN port**

In `apps/daemon/src/phone.test.cjs` `fixture()`, add a fake LAN starter and pass it to every `createPhone` the fixture builds:

```js
const lans = [];
const startLan = async (options) => {
  if (failLan?.()) throw new Error("listen EADDRINUSE: address already in use 0.0.0.0:8798");
  const lan = { options, port: options.port, closed: false, close: async () => { lan.closed = true; log.push("lan:close"); } };
  lans.push(lan);
  log.push(`lan:start:${options.port}`);
  return lan;
};
// createPhone({ ..., startLan, addresses: () => ["192.168.1.20"] })
```

Add `failLan` to the fixture's options and `lans` to what it returns. In `server.test.cjs`, add `lanPort: null` to `fakePhoneOptions()` and to the inline `{ localPort: 0, ... }` phone options at `:592` and `:805`. In `scripts/test-phone.cjs:61` add `lanPort: 0, lanHostname: "127.0.0.1"`. In `scripts/review-demo.cjs:148` add `lanPort: null` before `...phoneOptions`.

- [ ] **Step 2: Write the failing phone tests**

Append to `apps/daemon/src/phone.test.cjs` (adapt `fixture()`'s returned names: it returns the phone as created by `createPhone`, plus `log`, `bridges`; check its return statement):

```js
test("phone access starts the LAN host with the relay identity and reports its addresses", async (t) => {
  const { phone, lans } = await fixture(t);
  await phone.setEnabled(true);
  await phone.settled();
  assert.equal(lans.length, 1);
  assert.equal(lans[0].port, 8798);
  assert.equal(lans[0].options.hostname, "0.0.0.0");
  assert.match(lans[0].options.identity.hostId, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(phone.status().lan, { enabled: true, addresses: ["192.168.1.20"] });
});

test("a Cloudflare Mac also gets a relay identity and a LAN host", async (t) => {
  const { phone, lans } = await fixture(t, { cloudflare: true });
  await phone.setEnabled(true);
  await phone.settled();
  assert.equal(phone.status().remote, "cloudflare");
  assert.equal(lans.length, 1);
});

test("a LAN port that is taken leaves phone access on, with the error in lan", async (t) => {
  const { phone } = await fixture(t, { failLan: () => true });
  await phone.setEnabled(true);
  await phone.settled();
  assert.equal(phone.status().state, "on");
  assert.equal(phone.status().lan.enabled, true);
  assert.deepEqual(phone.status().lan.addresses, []);
  assert.match(phone.status().lan.error, /EADDRINUSE/);
});

test("setLan(false) closes the LAN host, is saved, and survives a restart", async (t) => {
  const { phone, lans, dataDir } = await fixture(t);
  await phone.setEnabled(true);
  await phone.settled();
  const status = await phone.setLan(false);
  assert.equal(lans[0].closed, true);
  assert.deepEqual(status.lan, { enabled: false, addresses: [] });
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, "mobile.json"), "utf8")).lan, false);
  await phone.setLan(true);
  assert.equal(lans.length, 2);
  assert.equal(phone.status().lan.enabled, true);
});

test("routes registers the phone's key without announcing a pairing, and lists the LAN endpoints", async (t) => {
  const paired = [];
  const { phone, dataDir } = await fixture(t, { onPaired: (info) => paired.push(info) });
  await phone.setEnabled(true);
  await phone.settled();
  const phoneKey = "k".repeat(43);
  const answer = await phone.routes(phoneKey);
  assert.match(answer.hostId, /^[A-Za-z0-9_-]{22}$/);
  assert.match(answer.key, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(answer.lan, ["ws://192.168.1.20:8798"]);
  assert.deepEqual(paired, []);
  const phones = createPhones(dataDir);
  await phones.load();
  assert.equal(phones.isKnown(phoneKey), true);
  await phone.setLan(false);
  assert.deepEqual((await phone.routes(phoneKey)).lan, []);
  await assert.rejects(phone.routes("short"), /key/);
});

test("lanPort null never starts a LAN host", async (t) => {
  const { phone, lans } = await fixture(t, { lanPort: null });
  await phone.setEnabled(true);
  await phone.settled();
  assert.equal(lans.length, 0);
  assert.deepEqual(phone.status().lan, { enabled: false, addresses: [] });
});
```

If `fixture()` does not forward `onPaired` or `lanPort`, extend it to pass them to `createPhone`.

- [ ] **Step 3: Run them to see them fail**

Run: `node --test apps/daemon/src/phone.test.cjs`
Expected: the new tests FAIL (`lans.length` is 0, `phone.setLan is not a function`).

- [ ] **Step 4: Implement it in `phone.cjs`**

Requires and options:

```js
const { startLanHost, LAN_PORT } = require("./lan-host.cjs");
const { lanAddresses } = require("./lan-addresses.cjs");
// in createPhone's parameters:
  startLan = startLanHost,
  lanPort = LAN_PORT,
  lanHostname = "0.0.0.0",
  addresses = lanAddresses,
```

Below the other state: `let lanError;` and `const lanAllowed = lanPort !== null && allowedRoot === undefined;`

Config: in `load()`, parse `lan: value.lan !== false` (and default `{ enabled: false, token: null, lan: true }`); in `save()` write `{ enabled: config.enabled, token: config.token, lan: config.lan }`.

Status (inside `status()`, added to the returned object):

```js
...(config ? { lan: lanStatus(on) } : {}),
```

with

```js
function lanStatus(on) {
  const enabled = lanAllowed && config.lan !== false;
  return { enabled, addresses: enabled && on && live.lan ? addresses() : [], ...(enabled && lanError ? { error: lanError } : {}) };
}
```

Starting the LAN host for a running `live`:

```js
async function startLanFor(current) {
  if (!lanAllowed || config.lan === false || current.lan) return;
  try {
    current.lan = await startLan({ port: lanPort, hostname: lanHostname, identity: current.identity, phones: current.phones, token: config.token, bridgeUrl: current.bridge.url });
    lanError = undefined;
  } catch (failure) {
    lanError = message(failure);
  }
}
```

In `launch()`: move the identity and phone list out of the relay-only branch so both modes have them. Right after the bridge starts:

```js
const identity = await readIdentity(dataDir);
relayPhones ??= createPhones(dataDir);
await relayPhones.load();
const known = relayPhones;
const phones = { /* the existing isKnown/add wrapper, unchanged */ };
```

The relay branch keeps using `identity` and `phones`. Build `live` as before plus `identity, phones`, then call `await startLanFor(live)` before `set("on")`. Pass the bridge a hook:

```js
bridge = await startBridge({ ..., phoneRoutes: (phoneKey) => routes(phoneKey) });
```

`closeLive(old)`: close the LAN host first: `await old?.lan?.close().catch(() => {});`. In the `catch` of `launch`, include `lan` in what `closeLive` receives if it was started (start it last, so a failure before it leaves nothing to close).

`routes()`:

```js
const PHONE_KEY = /^[A-Za-z0-9_-]{43}$/;
async function routes(phoneKey) {
  if (typeof phoneKey !== "string" || !PHONE_KEY.test(phoneKey)) throw Object.assign(new Error("Expected this phone's key"), { status: 400 });
  const current = live;
  if (!current) throw Object.assign(new Error("Phone access is starting. Try again."), { status: 409 });
  // Asked over a route the phone already proved itself on: knowing its key lets it finish a hello on the LAN.
  // Not a new pairing, so no "phone paired" notice.
  if (!relayPhones.isKnown(phoneKey)) await relayPhones.add(phoneKey);
  const port = current.lan?.port;
  return { hostId: current.identity.hostId, key: b64url(current.identity.box.publicKey), lan: port ? addresses().map((ip) => `ws://${ip}:${port}`) : [] };
}
```

`setLan()` on the returned object:

```js
/** Turns the LAN listener on or off without touching the bridge, tunnel or relay. */
async setLan(enabled) {
  if (typeof enabled !== "boolean") throw new Error("Expected enabled to be true or false");
  await enqueue(async () => {
    await load();
    if (config.lan === enabled) return;
    config.lan = enabled;
    await save();
    if (live && !enabled) {
      const host = live.lan;
      live.lan = undefined;
      await host?.close().catch(() => {});
    } else if (live) await startLanFor(live);
    lanError = enabled ? lanError : undefined;
    changed();
  });
  return status();
},
```

Export `routes` too only through the bridge hook; tests call `phone.routes`, so add `routes` to the returned object as well.

- [ ] **Step 5: Run the phone tests**

Run: `node --test apps/daemon/src/phone.test.cjs`
Expected: PASS, old and new.

- [ ] **Step 6: Write the failing bridge test**

In the bridge's test file (`apps/daemon/src/mobile-bridge.test.cjs`; find how its tests start a bridge and post `/rpc`), add:

```js
test("phone:routes is answered by the phone hook, never forwarded", async (t) => {
  const asked = [];
  const { url, token, forwarded } = await startTestBridge(t, { phoneRoutes: async (key) => (asked.push(key), { hostId: "h".repeat(22), key: "k".repeat(43), lan: ["ws://192.168.1.20:8798"] }) });
  const response = await fetch(`${url}/rpc`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, method: "phone:routes", args: [{ phoneKey: "p".repeat(43) }] }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).result.lan, ["ws://192.168.1.20:8798"]);
  assert.deepEqual(asked, ["p".repeat(43)]);
  assert.equal(forwarded.some((call) => call.method === "phone:routes"), false);
});

test("phone:routes is refused without a hook or in a confined bridge", async (t) => {
  const { url, token } = await startTestBridge(t, {});
  const response = await fetch(`${url}/rpc`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, method: "phone:routes", args: [{ phoneKey: "p".repeat(43) }] }),
  });
  assert.equal(response.status, 403);
});
```

`startTestBridge`, `forwarded` are stand-ins: use that file's existing helper for starting a bridge against a fake daemon client and its record of forwarded calls, and pass `phoneRoutes` through to `startMobileBridge`.

- [ ] **Step 7: Implement it in `mobile-bridge.cjs`**

Add `phoneRoutes` to `startMobileBridge`'s parameters. In the `/rpc` branch, right after the `request?.v !== 1` check and before the `METHODS` check:

```js
if (request.method === "phone:routes") {
  if (!phoneRoutes || confine) throw failure(403, "Command is not available from mobile");
  result = await phoneRoutes(request.args[0]?.phoneKey);
} else {
  if (!METHODS.has(request.method)) throw failure(403, "Command is not available from mobile");
  // ...the existing confine / client.call code, unchanged...
}
```

Errors thrown by `phoneRoutes` with a `status` already map through the existing `.catch` (`error.status ?? 409`).

- [ ] **Step 8: Add `phone:set-lan` to the daemon**

`server.cjs:19`: add `"phone:set-lan"` to `PHONE_METHODS`. In the dispatch, after `phone:open-pairing`:

```js
else if (request.method === "phone:set-lan") result = await phone.setLan(request.args[0]);
```

Add a test next to the existing `phone:set-enabled` test in `server.test.cjs`:

```js
test("phone:set-lan is listed and reaches the phone setting", async (t) => {
  const { client } = await fixture(t, { phoneOptions: fakePhoneOptions() });
  const status = await client.call("daemon:status");
  assert.ok(status.methods.includes("phone:set-lan"));
  const result = await client.call("phone:set-lan", [false]);
  assert.equal(result.lan.enabled, false);
});
```

- [ ] **Step 9: Run the daemon tests**

Run: `node --test apps/daemon/src/*.test.cjs scripts/review-demo.test.cjs`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/daemon/src scripts/review-demo.cjs scripts/test-phone.cjs
git commit -m "feat(daemon): advertise LAN routes to paired phones"
```

---

### Task 4: Desktop toggle "Allow on local network"

**Files:**
- Modify: `apps/desktop/electron/preload.cjs:148`
- Modify: `apps/desktop/app/src/electron.d.ts:50-62` and the `milagre` API block near `:239`
- Modify: `apps/desktop/app/src/lib/phone.ts`, `apps/desktop/app/src/lib/phone.test.ts`
- Modify: `apps/desktop/app/src/components/Settings.tsx` (`PhoneSettings`, `Group title="Phone access"`)
- Modify: `scripts/test-phone.cjs`

**Interfaces:**
- Consumes: `phone:set-lan`, `status.lan` (Task 3).
- Produces: `window.milagre.setPhoneLan(enabled: boolean): Promise<PhoneStatus>`, `phoneLanLine(status: PhoneStatus | null): string | null`.

- [ ] **Step 1: Write the failing status-line test**

Append to `apps/desktop/app/src/lib/phone.test.ts` (match its import style):

```ts
test("phoneLanLine says where a phone on the same network reaches this Mac", () => {
  const on = { enabled: true, state: "on", remote: "relay" } as const;
  assert.equal(phoneLanLine(null), null);
  assert.equal(phoneLanLine({ ...on, lan: { enabled: false, addresses: [] } }), "Off");
  assert.equal(phoneLanLine({ ...on, lan: { enabled: true, addresses: ["192.168.1.20", "10.0.0.7"] } }), "Reachable at 192.168.1.20, 10.0.0.7");
  assert.equal(phoneLanLine({ ...on, lan: { enabled: true, addresses: [] } }), "Not connected to a local network");
  assert.equal(phoneLanLine({ ...on, lan: { enabled: true, addresses: [], error: "listen EADDRINUSE" } }), "Couldn't listen on the local network: listen EADDRINUSE");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test apps/desktop/app/src/lib/phone.test.ts`
Expected: FAIL, `phoneLanLine` is not exported.

- [ ] **Step 3: Implement types and the line**

`electron.d.ts`, in `PhoneStatus`:

```ts
  /** Phone access on this Mac's local network: on or off, and the addresses a phone on the same network dials. */
  lan?: { enabled: boolean; addresses: string[]; error?: string };
```

In the `milagre` API block next to `setPhoneEnabled`:

```ts
      /** Turns phone access over the local network on or off. Resolves with the new status. */
      setPhoneLan(enabled: boolean): Promise<PhoneStatus>;
```

`lib/phone.ts`:

```ts
/** The line under "Allow on local network". Null until the daemon reports it. */
export function phoneLanLine(status: PhoneStatus | null): string | null {
  if (!status?.lan) return null;
  if (!status.lan.enabled) return "Off";
  if (status.lan.error) return `Couldn't listen on the local network: ${status.lan.error}`;
  if (!status.lan.addresses.length) return "Not connected to a local network";
  return `Reachable at ${status.lan.addresses.join(", ")}`;
}
```

`preload.cjs` after `setPhoneEnabled`:

```js
  setPhoneLan: (enabled) => ipcRenderer.invoke("phone:set-lan", enabled),
```

(`main.cjs:220` already forwards every method the daemon lists; nothing to add there.)

- [ ] **Step 4: Add the row in `PhoneSettings`**

Inside `<Group title="Phone access">`, after the "Allow your phone to connect" row:

```tsx
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
```

Import `phoneLanLine` with the other `lib/phone` imports.

- [ ] **Step 5: Extend the Electron check**

In `scripts/test-phone.cjs`, add `setPhoneLan: (enabled) => ipcRenderer.invoke("phone:set-lan", enabled),` to the fixture's `window.milagre`. After the step that turns phone access on and sees the QR, add:

```js
const lanRow = await page.waitForSelector('text="Allow on local network"');
assert.ok(lanRow, "the LAN switch shows once phone access is on");
await screenshot("lan-on");
await page.click('[role="switch"][aria-label="Allow on local network"]');
await page.waitForSelector('text="Off"');
await screenshot("lan-off");
```

Use the file's own helpers for waiting, clicking and screenshots (read how it toggles "Allow your phone to connect" and copy that pattern; the selectors above are illustrative of what to assert, not the file's API).

- [ ] **Step 6: Run the checks**

Run: `node --test apps/desktop/app/src/lib/phone.test.ts && npm run typecheck && MILAGRE_SCREENSHOT_DIR=$TMPDIR/lan-routes npm test -- --only test-phone`
Expected: PASS, screenshots `lan-on.png` and `lan-off.png` in `$TMPDIR/lan-routes`.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop scripts/test-phone.cjs
git commit -m "feat(desktop): toggle phone access on the local network"
```

---

### Task 5: Phone stores LAN routes; relay transport reports readiness and loss

**Files:**
- Create: `apps/mobile/src/lan-route.ts`, `apps/mobile/src/lan-route.test.ts`
- Modify: `apps/mobile/src/hosts-store.ts`, `apps/mobile/src/hosts-store.test.ts`
- Modify: `apps/mobile/src/relay-transport.ts` (options type, `open()`'s `end`, `close()`, returned object), `apps/mobile/src/relay-transport.test.ts`

**Interfaces:**
- Produces:
  - `type LanRoute = { hostId: string; key: string; endpoints: string[]; learnedAt: number }`
  - `validLanRoute(value: unknown): LanRoute | undefined`
  - `lanRouteFromAnswer(answer: unknown, learnedAt: number): LanRoute | undefined`
  - `SavedHost.routes?: { lan?: LanRoute }`; store method `learn(id: string, lan: LanRoute | undefined): Promise<void>`; `save()` keeps an existing `routes` for the same id.
  - `RelayTransport.ready(): Promise<void>` (opens and handshakes); `RelayTransportOptions.onLost?: () => void`, called when an established socket is lost, never on `close()`.

- [ ] **Step 1: Write the failing route validation test**

`apps/mobile/src/lan-route.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lanRouteFromAnswer, validLanRoute } from "./lan-route.ts";

const hostId = "H".repeat(22);
const key = "K".repeat(43);

test("keeps private ws endpoints only, at most four", () => {
  const route = validLanRoute({
    hostId,
    key,
    learnedAt: 5,
    endpoints: ["ws://192.168.1.20:8798", "ws://10.0.0.7:8798", "ws://172.31.0.2:8798", "ws://172.32.0.2:8798", "wss://192.168.1.20:8798", "ws://8.8.8.8:8798", "ws://mac.local:8798", "ws://192.168.1.21:8798", "ws://192.168.1.22:8798"],
  });
  assert.deepEqual(route, { hostId, key, learnedAt: 5, endpoints: ["ws://192.168.1.20:8798", "ws://10.0.0.7:8798", "ws://172.31.0.2:8798", "ws://192.168.1.21:8798"] });
});

test("no usable endpoint, a bad id or a bad key is no route", () => {
  assert.equal(validLanRoute({ hostId, key, endpoints: [] }), undefined);
  assert.equal(validLanRoute({ hostId: "x", key, endpoints: ["ws://192.168.1.20:8798"] }), undefined);
  assert.equal(validLanRoute({ hostId, key: "y", endpoints: ["ws://192.168.1.20:8798"] }), undefined);
  assert.equal(validLanRoute(null), undefined);
});

test("reads the Mac's phone:routes answer", () => {
  assert.deepEqual(lanRouteFromAnswer({ hostId, key, lan: ["ws://192.168.1.20:8798"] }, 9), { hostId, key, endpoints: ["ws://192.168.1.20:8798"], learnedAt: 9 });
  assert.equal(lanRouteFromAnswer({ hostId, key, lan: [] }, 9), undefined);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd apps/mobile && node --test src/lan-route.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lan-route.ts`**

```ts
/** How a phone reaches its Mac on the same network: the Mac's relay id and box key, and its addresses there. */
export type LanRoute = { hostId: string; key: string; endpoints: string[]; learnedAt: number };

const PRIVATE_WS = /^ws:\/\/(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}:\d{1,5}$/;
const MAX_ENDPOINTS = 4;

export function validLanRoute(value: unknown): LanRoute | undefined {
  const route = value as Partial<LanRoute> | null | undefined;
  if (!route || !/^[A-Za-z0-9_-]{22}$/.test(String(route.hostId)) || !/^[A-Za-z0-9_-]{43}$/.test(String(route.key))) return undefined;
  const endpoints = (Array.isArray(route.endpoints) ? route.endpoints : [])
    .filter((endpoint): endpoint is string => typeof endpoint === "string" && PRIVATE_WS.test(endpoint))
    .slice(0, MAX_ENDPOINTS);
  if (!endpoints.length) return undefined;
  return { hostId: String(route.hostId), key: String(route.key), endpoints, learnedAt: Number(route.learnedAt) || 0 };
}

/** The Mac's `phone:routes` answer as a saved route; undefined when it has none to offer. */
export function lanRouteFromAnswer(answer: unknown, learnedAt: number): LanRoute | undefined {
  const value = answer as { hostId?: unknown; key?: unknown; lan?: unknown } | null | undefined;
  return validLanRoute({ hostId: value?.hostId, key: value?.key, endpoints: value?.lan, learnedAt });
}
```

- [ ] **Step 4: Run it**

Run: `cd apps/mobile && node --test src/lan-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing store tests**

Append to `apps/mobile/src/hosts-store.test.ts` (reuse its in-memory storage helper):

```ts
const lan = { hostId: "H".repeat(22), key: "K".repeat(43), endpoints: ["ws://192.168.1.20:8798"], learnedAt: 1 };

test("learn saves a LAN route on that computer, and a re-pairing keeps it until relearned", async () => {
  const store = createHostsStore(memoryStorage());
  const saved = await store.save({ name: "Mac", address: "https://mac.example.com", token: "a".repeat(64) });
  await store.learn(saved.id, lan);
  assert.deepEqual((await store.list())[0].routes, { lan });
  await store.save({ name: "Mac", address: "https://mac.example.com", token: "b".repeat(64) });
  assert.deepEqual((await store.list())[0].routes, { lan });
  await store.learn(saved.id, undefined);
  assert.equal((await store.list())[0].routes, undefined);
});

test("a damaged LAN route is dropped, the computer is kept", async () => {
  const storage = memoryStorage();
  await storage.setItemAsync("milagre.hosts.v1", JSON.stringify([{ name: "Mac", address: "https://mac.example.com", token: "a".repeat(64), routes: { lan: { hostId: "bad" } } }]));
  const [host] = await createHostsStore(storage).list();
  assert.equal(host.address, "https://mac.example.com");
  assert.equal(host.routes, undefined);
});
```

(`memoryStorage` stands for the file's existing fake; use its real name.)

- [ ] **Step 6: Implement it in `hosts-store.ts`**

```ts
import { validLanRoute, type LanRoute } from "./lan-route.ts";

export type SavedHost = { id: string; name: string; address: string; token: string; access?: Access; relay?: RelayLink; routes?: { lan?: LanRoute }; lastUsed: number };
```

In `validate`, compute `const lan = validLanRoute((host as { routes?: { lan?: unknown } }).routes?.lan);` and add `...(lan ? { routes: { lan } } : {})` to both returned objects.

In `save`, keep what was learned:

```ts
save: (host: { name: string; address: string; token: string; access?: Access; relay?: RelayLink }) =>
  ordered(async () => {
    const hosts = await read();
    const saved = validate({ ...host, lastUsed: now() });
    const learned = hosts.find((item) => item.id === saved.id)?.routes;
    const next = learned ? { ...saved, routes: learned } : saved;
    await write([next, ...hosts.filter((item) => item.id !== saved.id)]);
    return next;
  }),
learn: (id: string, lan: LanRoute | undefined) =>
  ordered(async () => {
    await write(
      (await read()).map((item) => {
        if (item.id !== id) return item;
        const { routes: _old, ...rest } = item;
        return lan ? { ...rest, routes: { lan } } : rest;
      }),
    );
  }),
```

Run: `cd apps/mobile && node --test src/hosts-store.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing transport tests**

Append to `apps/mobile/src/relay-transport.test.ts`, using the file's fake socket and fake Mac helpers (it already drives a full hello with fake timers; reuse that setup):

```ts
test("ready() handshakes once; onLost fires when the socket drops, not on close()", async () => {
  let lost = 0;
  const { transport, mac } = setup({ onLost: () => lost++ }); // the file's harness, extended to pass options through
  await transport.ready();
  assert.equal(mac.hellos, 1);
  await transport.ready();
  assert.equal(mac.hellos, 1);
  mac.drop(); // closes the socket from the Mac's side
  assert.equal(lost, 1);
  await transport.ready();
  transport.close();
  assert.equal(lost, 1);
});
```

Adapt `setup`, `mac.hellos` and `mac.drop` to the harness the file already has (read its top 80 lines first); the asserted behavior is the contract.

- [ ] **Step 8: Implement it in `relay-transport.ts`**

Options type: add

```ts
  /** An open socket was lost (dropped, silent, refused mid-session). Not called when close() ends it. */
  onLost?: () => void;
```

At the top of `createRelayTransport`: `let closing = false;`. In `open()`'s `end`, inside `if (c) { ... }` before `teardown(c, error)`: `if (!closing) options.onLost?.();`. In `close()`: set `closing = true` at the start and `closing = false` at the end. Add to the returned object:

```ts
    /** Opens the socket and finishes the hello now, instead of on the first request. */
    ready: () => connect().then(() => undefined),
```

and add `ready(): Promise<void>;` to the `RelayTransport` type.

- [ ] **Step 9: Run the mobile tests and typecheck**

Run: `cd apps/mobile && node --test src/*.test.ts && npx tsc --noEmit`
Expected: PASS. Any other `RelayTransport` fakes (e.g. in `client.test.ts`) need `ready: async () => {}` to typecheck.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/src/lan-route.ts apps/mobile/src/lan-route.test.ts apps/mobile/src/hosts-store.ts apps/mobile/src/hosts-store.test.ts apps/mobile/src/relay-transport.ts apps/mobile/src/relay-transport.test.ts apps/mobile/src/client.test.ts
git commit -m "feat(mobile): save LAN routes and report relay socket loss"
```

---

### Task 6: Route supervisor

**Files:**
- Create: `apps/mobile/src/routes.ts`, `apps/mobile/src/routes.test.ts`

**Interfaces:**
- Consumes: `LanRoute` (Task 5), `RelayTransport` with `ready()` / `close()` (Task 5).
- Produces:

```ts
export const PROBE_TIMEOUT = 2_500;
export const HOLD_MS = 300_000;
export type ActiveRoute = { kind: "primary" } | { kind: "lan"; endpoint: string; transport: RelayTransport };
export type RouteSupervisor = {
  current(): ActiveRoute;
  check(): Promise<ActiveRoute>;
  suspend(): void;
  subscribe(listener: (route: ActiveRoute) => void): () => void;
  close(): void;
};
export function createRouteSupervisor(options: {
  lan: () => LanRoute | undefined;
  probe: (endpoint: string, hostId: string) => Promise<boolean>;
  openLan: (endpoint: string, lan: LanRoute, onLost: () => void) => Promise<RelayTransport>;
  now?: () => number;
}): RouteSupervisor;
```

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/routes.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouteSupervisor, HOLD_MS } from "./routes.ts";
import type { RelayTransport } from "./relay-transport.ts";
import type { LanRoute } from "./lan-route.ts";

const A = "ws://192.168.1.20:8798";
const B = "ws://10.0.0.7:8798";
const route = (endpoints = [A, B]): LanRoute => ({ hostId: "H".repeat(22), key: "K".repeat(43), endpoints, learnedAt: 0 });

function harness({ answers = { [A]: true, [B]: true } as Record<string, boolean>, opens = {} as Record<string, boolean>, lan = route() as LanRoute | undefined } = {}) {
  const clock = { now: 0 };
  const state = { lan, answers, opens, probed: [] as string[], opened: [] as string[], closed: [] as string[], lost: new Map<string, () => void>() };
  const supervisor = createRouteSupervisor({
    lan: () => state.lan,
    probe: async (endpoint, hostId) => {
      state.probed.push(endpoint);
      assert.equal(hostId, "H".repeat(22));
      return state.answers[endpoint] ?? false;
    },
    openLan: async (endpoint, _lan, onLost) => {
      state.opened.push(endpoint);
      if (state.opens[endpoint] === false) throw new Error("hello refused");
      state.lost.set(endpoint, onLost);
      return { close: () => state.closed.push(endpoint) } as unknown as RelayTransport;
    },
    now: () => clock.now,
  });
  return { supervisor, state, clock };
}

test("starts on the primary route and moves to the first LAN endpoint that answers", async () => {
  const { supervisor, state } = harness({ answers: { [A]: false, [B]: true } });
  assert.equal(supervisor.current().kind, "primary");
  const seen: string[] = [];
  supervisor.subscribe((next) => seen.push(next.kind));
  const active = await supervisor.check();
  assert.deepEqual(active.kind === "lan" && active.endpoint, B);
  assert.deepEqual(state.probed.sort(), [A, B].sort());
  assert.deepEqual(state.opened, [B]);
  assert.deepEqual(seen, ["lan"]);
});

test("no learned route, or nothing answering, stays on the primary route", async () => {
  assert.equal((await harness({ lan: undefined }).supervisor.check()).kind, "primary");
  assert.equal((await harness({ answers: {} }).supervisor.check()).kind, "primary");
});

test("an endpoint that answers but refuses the hello is held back for five minutes", async () => {
  const { supervisor, state, clock } = harness({ answers: { [A]: true }, opens: { [A]: false }, lan: route([A]) });
  assert.equal((await supervisor.check()).kind, "primary");
  clock.now = HOLD_MS - 1;
  await supervisor.check();
  assert.deepEqual(state.opened, [A]);
  clock.now = HOLD_MS;
  state.opens[A] = true;
  assert.equal((await supervisor.check()).kind, "lan");
});

test("a lost LAN socket falls back to the primary route without a hold", async () => {
  const { supervisor, state } = harness({ lan: route([A]) });
  await supervisor.check();
  state.lost.get(A)!();
  assert.equal(supervisor.current().kind, "primary");
  assert.equal((await supervisor.check()).kind, "lan");
});

test("on LAN, a check that no longer reaches the endpoint, or finds it unadvertised, falls back", async () => {
  const { supervisor, state } = harness({ lan: route([A]) });
  await supervisor.check();
  state.answers[A] = false;
  assert.equal((await supervisor.check()).kind, "primary");
  assert.deepEqual(state.closed, [A]);
  state.answers[A] = true;
  await supervisor.check();
  state.lan = route([B]);
  state.answers[B] = false;
  assert.equal((await supervisor.check()).kind, "primary");
});

test("a probe answered by another Mac (hostId mismatch) is not a route", async () => {
  // The native probe returns false on a hostId mismatch; here that is an endpoint that does not answer.
  const { supervisor, state } = harness({ answers: { [A]: false, [B]: false } });
  assert.equal((await supervisor.check()).kind, "primary");
  assert.deepEqual(state.opened, []);
});

test("suspend closes the LAN socket but keeps the route; concurrent checks share one walk", async () => {
  const { supervisor, state } = harness({ lan: route([A]) });
  await Promise.all([supervisor.check(), supervisor.check()]);
  assert.deepEqual(state.opened, [A]);
  supervisor.suspend();
  assert.deepEqual(state.closed, [A]);
  assert.equal(supervisor.current().kind, "lan");
  assert.equal((await supervisor.check()).kind, "lan");
});

test("close() drops the LAN socket, and a walk still in flight opens nothing", async () => {
  const first = harness({ lan: route([A]) });
  await first.supervisor.check();
  first.supervisor.close();
  assert.equal(first.supervisor.current().kind, "primary");
  assert.deepEqual(first.state.closed, [A]);
  const second = harness({ lan: route([A]) });
  const walking = second.supervisor.check();
  second.supervisor.close();
  await walking;
  assert.equal(second.supervisor.current().kind, "primary");
  assert.deepEqual(second.state.opened, []);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/mobile && node --test src/routes.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `routes.ts`**

```ts
import type { RelayTransport } from "./relay-transport.ts";
import type { LanRoute } from "./lan-route.ts";

export const PROBE_TIMEOUT = 2_500;
/** An endpoint that answered its probe but would not open waits this long before it is tried again. */
export const HOLD_MS = 5 * 60_000;

export type ActiveRoute = { kind: "primary" } | { kind: "lan"; endpoint: string; transport: RelayTransport };
export type RouteSupervisor = {
  current(): ActiveRoute;
  /** Moves to the best route that works now: a LAN endpoint if one answers and opens, else the paired route. */
  check(): Promise<ActiveRoute>;
  /** The app is going to the background: closes the LAN socket and keeps the route, which reopens on next use. */
  suspend(): void;
  subscribe(listener: (route: ActiveRoute) => void): () => void;
  close(): void;
};
export type RouteSupervisorOptions = {
  lan: () => LanRoute | undefined;
  probe: (endpoint: string, hostId: string) => Promise<boolean>;
  openLan: (endpoint: string, lan: LanRoute, onLost: () => void) => Promise<RelayTransport>;
  now?: () => number;
};
const PRIMARY: ActiveRoute = { kind: "primary" };

/** Which way one computer is reached: its LAN endpoints when they work, its paired route (Cloudflare or relay) otherwise. */
export function createRouteSupervisor({ lan, probe, openLan, now = Date.now }: RouteSupervisorOptions): RouteSupervisor {
  let active: ActiveRoute = PRIMARY;
  let walking: Promise<ActiveRoute> | null = null;
  let closed = false;
  const held = new Map<string, number>();
  const listeners = new Set<(route: ActiveRoute) => void>();

  function set(next: ActiveRoute) {
    const previous = active;
    if (previous === next) return;
    active = next;
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        /* a listener must not stop the switch */
      }
    }
    if (previous.kind === "lan") previous.transport.close();
  }

  async function walk(): Promise<ActiveRoute> {
    const route = lan();
    if (active.kind === "lan") {
      const { endpoint } = active;
      const still = route?.endpoints.includes(endpoint) && (await probe(endpoint, route.hostId).catch(() => false));
      if (closed) return active;
      if (still) return active;
      set(PRIMARY);
    }
    if (!route) return active;
    const candidates = route.endpoints.filter((endpoint) => (held.get(endpoint) ?? 0) <= now());
    const probes = candidates.map((endpoint) => probe(endpoint, route.hostId).catch(() => false));
    for (const [index, endpoint] of candidates.entries()) {
      if (!(await probes[index]) || closed) continue;
      let transport: RelayTransport;
      try {
        transport = await openLan(endpoint, route, () => {
          if (active.kind === "lan" && active.endpoint === endpoint) set(PRIMARY);
        });
      } catch {
        held.set(endpoint, now() + HOLD_MS);
        continue;
      }
      if (closed) {
        transport.close();
        return active;
      }
      set({ kind: "lan", endpoint, transport });
      return active;
    }
    return active;
  }

  return {
    current: () => active,
    check() {
      if (closed) return Promise.resolve(active);
      walking ??= walk().finally(() => {
        walking = null;
      });
      return walking;
    },
    suspend() {
      if (active.kind === "lan") active.transport.close();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      listeners.clear();
      if (active.kind === "lan") active.transport.close();
      active = PRIMARY;
    },
  };
}
```

`suspend()` calls `transport.close()`, which by Task 5's contract never fires `onLost`, so the route stays `lan`; the relay transport reopens on its next request.

- [ ] **Step 4: Run them**

Run: `cd apps/mobile && node --test src/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/routes.ts apps/mobile/src/routes.test.ts
git commit -m "feat(mobile): pick the LAN route when it answers"
```

---

### Task 7: The client sends through the LAN when it is up

**Files:**
- Modify: `apps/mobile/src/client.ts` (`RelayRuntime`, `createClient`: `overRelay`, `request`, `media`, `image`, `relayImage`, `relayLive`, `live`)
- Test: `apps/mobile/src/client.test.ts`

**Interfaces:**
- Consumes: `RelayTransport` (Task 5).
- Produces:
  - `type RouteView = { current(): RelayTransport | null; subscribe(listener: () => void): () => void }`
  - `RelayRuntime.lan?(host: { id: string; token: string }): RouteView` (optional, so tests and old call sites compile).

- [ ] **Step 1: Write the failing tests**

Append to `apps/mobile/src/client.test.ts` (reuse `fakeRelay`, `reply` and the HTTPS host fixtures the file defines):

```ts
function lanView(transport: RelayTransport | null) {
  const listeners = new Set<() => void>();
  const view = { transport, current: () => view.transport, subscribe: (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn)), switch(next: RelayTransport | null) { view.transport = next; for (const fn of listeners) fn(); } };
  return view;
}

test("a Cloudflare computer's requests go through the LAN transport while it is up, and back to HTTPS after", async () => {
  const lan = fakeRelay(() => reply({ v: 1, result: "over-lan" }));
  const view = lanView(null);
  const fetched: string[] = [];
  const fetcher = (async (url: string) => (fetched.push(url), new Response(JSON.stringify({ v: 1, result: "over-https" })))) as typeof fetch;
  const client = createClient(cloudflareHost, fetcher, 30000, { ...lan.runtime, lan: () => view });
  assert.equal(await client.call("daemon:status"), "over-https");
  view.switch(await lan.runtime.transport({ relay: { url: "ws://192.168.1.20:8798", hostId: "H".repeat(22), key: "K".repeat(43) }, token: "a".repeat(64) }));
  assert.equal(await client.call("daemon:status"), "over-lan");
  view.switch(null);
  assert.equal(await client.call("daemon:status"), "over-https");
  assert.equal(fetched.length, 2);
});

test("a live stream reopens on the new route when the route changes", async () => {
  const lan = fakeRelay(() => reply({ v: 1 }));
  const view = lanView(null);
  const opened: string[] = [];
  const client = createClient(relayHost, fetch, 30000, { ...lan.runtime, lan: () => view });
  const statuses: boolean[] = [];
  const live = client.live("/p", { onSignal: () => {}, onStatus: (up) => statuses.push(up) });
  await Promise.resolve();
  view.switch(await lan.runtime.transport({ relay: { url: "ws://192.168.1.20:8798", hostId: "H".repeat(22), key: "K".repeat(43) }, token: "a".repeat(64) }));
  await Promise.resolve();
  assert.ok(lan.lives.length >= 2, "opened once on the relay, again on the LAN");
  live.close();
});

test("images of a Cloudflare computer load through the LAN transport while it is up", async () => {
  const lan = fakeRelay(() => ({ status: 200, headers: {}, body: new Uint8Array([1, 2, 3]) }));
  const view = lanView(await lan.runtime.transport({ relay: { url: "ws://192.168.1.20:8798", hostId: "H".repeat(22), key: "K".repeat(43) }, token: "a".repeat(64) }));
  const client = createClient(cloudflareHost, fetch, 30000, { ...lan.runtime, lan: () => view });
  const source = client.image("/p", "/p/a.png");
  assert.ok(source instanceof Promise, "an image over the LAN is fetched to a file");
  assert.match((await source).uri, /^file:|\.png$/);
});
```

`cloudflareHost` is an `https://` host with `access`; if the file has no such fixture, define one: `{ address: "https://mac.example.com", token: "a".repeat(64), access: { id: \`${"a".repeat(32)}.access\`, secret: "b".repeat(40) } }`. Adjust `lan.lives` / file URIs to what `fakeRelay` records.

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/mobile && node --test src/client.test.ts`
Expected: FAIL (requests still go over HTTPS; `lan` is ignored).

- [ ] **Step 3: Implement it in `client.ts`**

Types:

```ts
/** Which LAN transport, if any, carries this computer's traffic right now. */
export type RouteView = { current(): RelayTransport | null; subscribe(listener: () => void): () => void };
```

and in `RelayRuntime`:

```ts
  /** This computer's LAN route; requests and live streams use its transport while `current()` has one. */
  lan?(host: { id: string; token: string }): RouteView;
```

In `createClient`, after `token`:

```ts
const lanView = runtime?.lan?.({ id: url, token });
const lanNow = () => lanView?.current() ?? null;
/** The transport this request rides: the LAN when it is up, else the relay for a relay computer, else none (HTTPS). */
const carrier = (): Promise<RelayTransport> | null => {
  const lan = lanNow();
  if (lan) return Promise.resolve(lan);
  return relay ? runtime!.transport({ relay, token }) : null;
};
```

Change `overRelay` to take the carrier instead of calling `transport()`:

```ts
function overRelay(through: Promise<RelayTransport>, method: "GET" | "POST", route: string, headers: Record<string, string>, body: string | undefined, signal: AbortSignal) {
  const deadline = new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error(LOST)), { once: true }));
  const answer = through.then((relayed) =>
    relayed.request(method, route, headers, body).catch((error) => {
      throw (error as Error)?.name === "RelayTransportError" ? error : new Error(LOST);
    }),
  );
  return Promise.race([deadline, answer]);
}
```

In `request`: replace `if (relay) {` with `const through = carrier(); if (through) {` and pass `through` as `overRelay`'s first argument. In the 401/403 copy, branch on `through` instead of `relay`.

`media`: `if (relay || lanNow()) throw ...`. `image`: `relay || lanNow() ? relayImage(...) : media(...)`. In `relayImage`, replace the `overRelay("GET", ...)` call with:

```ts
const through = carrier();
if (!through) throw new Error(LOST);
// ...inTurn(() => timed(timeoutMs, (signal) => overRelay(through, "GET", mediaRoute(projectPath, path), {}, undefined, signal)))
```

`relayLive(path, options, through: Promise<RelayTransport>)`: use `through.then(...)` instead of `transport().then(...)`. Delete the old `transport` helper.

`live`:

```ts
live: (projectPath: string, options: LiveOptions) => {
  const path = `/live?projectPath=${encodeURIComponent(projectPath)}`;
  const open = () => {
    const through = carrier();
    return through ? relayLive(path, options, through) : openLive(`${url.replace(/^http/, "ws")}${path}`, auth, options);
  };
  if (!lanView) return open();
  let using = lanNow();
  let inner = open();
  // A switch of route moves the stream: the old one closes, the new one opens; the snapshot polls in between.
  const unsubscribe = lanView.subscribe(() => {
    if (lanNow() === using) return;
    using = lanNow();
    inner.close();
    options.onStatus(false);
    inner = open();
  });
  return {
    close() {
      unsubscribe();
      inner.close();
    },
  };
},
```

- [ ] **Step 4: Run the mobile tests and typecheck**

Run: `cd apps/mobile && node --test src/*.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/client.ts apps/mobile/src/client.test.ts
git commit -m "feat(mobile): send requests and live streams over the LAN route"
```

---

### Task 8: Native wiring, learning, indicator and the native build changes

**Files:**
- Create: `apps/mobile/src/routes-native.ts`
- Modify: `apps/mobile/src/relay-native.ts` (adds `lan`)
- Modify: `apps/mobile/src/session.tsx` (`connect`, `loadHosts`, forget path)
- Modify: `apps/mobile/src/app/index.tsx` (row subtitle, forget)
- Modify: `apps/mobile/package.json`, `apps/mobile/app.json`, `package-lock.json`

**Interfaces:**
- Consumes: `createRouteSupervisor`, `PROBE_TIMEOUT` (Task 6), `createRelayTransport` with `onLost`/`ready` (Task 5), `lanRouteFromAnswer`, `savedHosts.learn` (Task 5), `RouteView`, `Client` (Task 7).
- Produces: `lanRoutes = { view(host), set(id, token, lan), kind(id), subscribe(id, fn), forget(id), checkAll() }` and `learnRoutes(client: Client, host: { token: string; relay?: RelayLink }): Promise<void>`.

- [ ] **Step 1: Add the native dependencies and config**

Run from `apps/mobile`: `npx expo install expo-network expo-build-properties`

`app.json`: in `ios.infoPlist` add `"NSLocalNetworkUsageDescription": "Milagre connects to your computer directly when you are on the same network."`. In `plugins` add:

```json
["expo-build-properties", { "android": { "usesCleartextTraffic": true } }]
```

Then confirm ATS: `cd apps/mobile && npx expo prebuild --platform ios --no-install --clean` into a scratch copy (or run it and `git clean` the generated `ios/` afterwards; `ios/` is not committed). Check `ios/Milagre/Info.plist`: `NSAppTransportSecurity` must have `NSAllowsLocalNetworking` true or `NSAllowsArbitraryLoads` true. If neither, add to `ios.infoPlist`: `"NSAppTransportSecurity": { "NSAllowsLocalNetworking": true }`. Delete the generated `ios/` folder afterwards.

- [ ] **Step 2: Create `routes-native.ts`**

```ts
import { AppState } from "react-native";
import * as Network from "expo-network";
import { b64url } from "@milagre/shared/relay-crypto";
import { createRelayTransport } from "./relay-transport";
import { phoneIdentity, phoneRandom } from "./phone-identity";
import { createRouteSupervisor, PROBE_TIMEOUT, type RouteSupervisor } from "./routes";
import { lanRouteFromAnswer, type LanRoute } from "./lan-route";
import { savedHosts } from "./hosts-native";
import type { Client, RelayLink, RouteView } from "./client";

const CHECK_EVERY = 60_000;
type Entry = { token: string; lan: LanRoute | undefined; supervisor: RouteSupervisor };
const entries = new Map<string, Entry>();

/** Whether this address still answers as the Mac we paired with. No credentials go out. */
async function probe(endpoint: string, hostId: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
  try {
    const response = await fetch(`${endpoint.replace(/^ws:/, "http:")}/v1/hello`, { signal: controller.signal });
    if (!response.ok) return false;
    const body = (await response.json()) as { v?: unknown; hostId?: unknown };
    return body?.v === 1 && body.hostId === hostId;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function entry(id: string, token: string): Entry {
  const found = entries.get(id);
  if (found) {
    found.token = token;
    return found;
  }
  const created = { token, lan: undefined } as Entry;
  created.supervisor = createRouteSupervisor({
    lan: () => created.lan,
    probe,
    async openLan(endpoint, lan, onLost) {
      const identity = await phoneIdentity();
      const transport = createRelayTransport({ relay: endpoint, hostId: lan.hostId, key: lan.key, token: created.token, identity, random: phoneRandom, onLost });
      try {
        await transport.ready();
      } catch (error) {
        transport.close();
        throw error;
      }
      return transport;
    },
  });
  entries.set(id, created);
  return created;
}

/** Each saved computer's LAN route: which transport carries it now, and when to look again. */
export const lanRoutes = {
  view(host: { id: string; token: string }): RouteView {
    const { supervisor } = entry(host.id, host.token);
    return {
      current: () => {
        const route = supervisor.current();
        return route.kind === "lan" ? route.transport : null;
      },
      subscribe: (listener) => supervisor.subscribe(() => listener()),
    };
  },
  set(id: string, token: string, lan: LanRoute | undefined) {
    const found = entry(id, token);
    found.lan = lan;
    void found.supervisor.check();
  },
  kind: (id: string): "lan" | "remote" => (entries.get(id)?.supervisor.current().kind === "lan" ? "lan" : "remote"),
  subscribe(id: string, listener: () => void) {
    return entry(id, entries.get(id)?.token ?? "").supervisor.subscribe(() => listener());
  },
  forget(id: string) {
    entries.get(id)?.supervisor.close();
    entries.delete(id);
  },
  checkAll() {
    for (const found of entries.values()) void found.supervisor.check();
  },
};

/**
 * Asks the Mac for its LAN route over the route this client already uses, and saves it. An older Mac, or the review
 * demo, refuses `phone:routes`: the computer keeps its paired route only.
 */
export async function learnRoutes(client: Client, host: { token: string; relay?: RelayLink }) {
  const identity = await phoneIdentity();
  let answer: unknown;
  try {
    answer = await client.call("phone:routes", [{ phoneKey: b64url(identity.publicKey) }]);
  } catch {
    return;
  }
  let lan = lanRouteFromAnswer(answer, Date.now());
  // A relay computer's LAN route must be the same Mac we pinned from its QR.
  if (lan && host.relay && (lan.key !== host.relay.key || lan.hostId !== host.relay.hostId)) lan = undefined;
  await savedHosts.learn(client.url, lan);
  lanRoutes.set(client.url, host.token, lan);
}

AppState.addEventListener("change", (state) => {
  if (state === "background") for (const found of entries.values()) found.supervisor.suspend();
  else if (state === "active") lanRoutes.checkAll();
});
Network.addNetworkStateListener(() => lanRoutes.checkAll());
setInterval(() => {
  if (AppState.currentState === "active") lanRoutes.checkAll();
}, CHECK_EVERY);
```

If `hosts-native.ts` builds `savedHosts` with `createHostsStore`, `learn` is already on it; otherwise export it there.

- [ ] **Step 3: Give the relay runtime its `lan`**

In `relay-native.ts`: `import { lanRoutes } from "./routes-native";` and add to `relayRuntime`:

```ts
  lan: (host) => lanRoutes.view(host),
```

- [ ] **Step 4: Learn on connect, load on start, forget with the computer**

In `session.tsx` `connect()`, after the `if (remember) { ... }` save block and before `setClient(next)`:

```ts
if (process.env.EXPO_PUBLIC_DEMO !== "1") void learnRoutes(next, { token: host.token.trim(), relay: host.relay }).catch(() => {});
```

Do the same in `openNotificationTarget` after its `daemon:status`. In `loadHosts` (where `setHosts` receives the saved list), seed the routes:

```ts
for (const saved of list) lanRoutes.set(saved.id, saved.token, saved.routes?.lan);
```

Wherever a computer is forgotten (`app/index.tsx` `manage(host, "forget")` and any `relayRuntime.forget` call), also call `lanRoutes.forget(host.id)`.

- [ ] **Step 5: Show the route in the computers list**

In `app/index.tsx`, keep a tick that re-renders when any route changes:

```tsx
const [, setRouteTick] = useState(0);
useEffect(() => {
  const unsubscribe = session.hosts.map((host) => lanRoutes.subscribe(host.id, () => setRouteTick((tick) => tick + 1)));
  return () => unsubscribe.forEach((stop) => stop());
}, [session.hosts]);
```

Replace the row subtitle:

```tsx
subtitle={`${label(status[host.id])} · ${
  status[host.id] === "online" && lanRoutes.kind(host.id) === "lan"
    ? "Local network"
    : host.relay
      ? host.relay.url.replace(/^wss:\/\//, "")
      : host.address.replace(/^https?:\/\//, "")
}`}
```

- [ ] **Step 6: Typecheck, test, fingerprint**

Run: `npm run typecheck:mobile && cd apps/mobile && node --test src/*.test.ts`
Expected: PASS.

Run the fingerprint check documented in `apps/mobile/AGENTS.md` and record the new runtime fingerprint for the PR body. Expected: it changed (new native modules). Do not build.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile package-lock.json
git commit -m "feat(mobile): switch to the LAN route on its own and show it"
```

---

### Task 9: End-to-end check, full suite, PR

**Files:**
- Create: `apps/daemon/src/lan-e2e.test.cjs`

**Interfaces:**
- Consumes: everything above. `startDaemon` from `apps/daemon/src/server.cjs`, the phone relay transport from `apps/mobile/src/relay-transport.ts` is TS, so this test drives the protocol with `connectPhone` from `relay-test-kit.cjs` instead.

- [ ] **Step 1: Write the e2e test**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { b64url, boxKeyPair, fromB64url } = require("@milagre/shared/relay-crypto");
const { startDaemon } = require("./server.cjs");
const { connectPhone, random } = require("./relay-test-kit.cjs");

// A throwaway daemon: its own data dir and ports. Never Victor's data dir or 8797/8798.
test("a phone learns the LAN route over the bridge, then calls the daemon over the LAN socket", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lan-e2e-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const startRelay = () => ({ status: () => "online", close: async () => {} });
  const daemon = await startDaemon({ dataDir, phoneOptions: { localPort: 8897, lanPort: 8898, lanHostname: "127.0.0.1", addresses: () => ["127.0.0.1"], startRelay } });
  t.after(() => daemon.close());
  const client = daemon.client ?? (await daemon.connect()); // use whatever startDaemon's tests use to call it
  const status = await client.call("phone:set-enabled", [true]);
  assert.equal(status.state, "on");
  const token = JSON.parse(await fs.readFile(path.join(dataDir, "mobile.json"), "utf8")).token;
  const key = boxKeyPair(random);
  const routes = await fetch("http://127.0.0.1:8897/rpc", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, method: "phone:routes", args: [{ phoneKey: b64url(key.publicKey) }] }),
  }).then((response) => response.json());
  assert.deepEqual(routes.result.lan, ["ws://127.0.0.1:8898"]);
  const identity = { hostId: routes.result.hostId, box: { publicKey: fromB64url(routes.result.key) } };
  const phone = connectPhone({ relayUrl: routes.result.lan[0], identity, key, token });
  t.after(() => phone.close());
  assert.ok((await phone.hello()).channel);
  phone.request(1, { method: "POST", path: "/rpc", headers: { "content-type": "application/json" }, body: '{"v":1,"method":"daemon:status","args":[]}' });
  const response = await phone.response(1);
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(new TextDecoder().decode(response.body)).v, 1);
});
```

Read `server.test.cjs`'s `fixture()` for how it starts a daemon and gets a client, and use the same calls.

- [ ] **Step 2: Run it**

Run: `node --test apps/daemon/src/lan-e2e.test.cjs`
Expected: PASS.

- [ ] **Step 3: Run every check AGENTS.md requires**

Run: `npm run typecheck && npm run typecheck:mobile && npm run lint && npm test -- --unit && MILAGRE_SCREENSHOT_DIR=$TMPDIR/lan-routes npm test -- --only test-phone`
Expected: all PASS.

- [ ] **Step 4: Commit and open the PR**

```bash
git add apps/daemon/src/lan-e2e.test.cjs
git commit -m "test(daemon): phone reaches a throwaway daemon over the LAN socket"
git push -u origin HEAD
```

Push the Settings screenshots to the `screenshots` branch under `lan-routes/` (see AGENTS.md, "Pull request screenshots") and open the PR with `gh pr create`. The body says: what changed, that the runtime fingerprint changed and the PR waits for the new TestFlight build Victor approved, the manual on-device check still to run after that build (home Wi-Fi shows "Local network"; cellular falls back within seconds; back on Wi-Fi it switches back), and the screenshot links. No attribution lines.
