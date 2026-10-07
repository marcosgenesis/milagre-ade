# Phone reaches the Mac over the local network when it can

Date: 2026-10-06. Status: approved design, awaiting spec review.

## Goal

When the phone and the Mac share a network, the phone talks to the Mac directly over the LAN instead of going through
Cloudflare (named tunnel) or the public relay. When they don't, nothing changes. The switch happens on its own, including
in the middle of an open session, and the user can see which path is in use.

Modeled on T3 Code's routes (pingdotgg/t3code PRs #15467 and #15468, merged 2026-10-05), with one deliberate difference:
T3 sends its bearer token over plain HTTP on the LAN; we reuse the relay's end-to-end encryption, so nothing readable
crosses the Wi-Fi.

## Decisions

| Question | Decision |
| --- | --- |
| How the phone learns LAN addresses | The Mac advertises them over the already-authenticated remote route. No mDNS, no QR change. |
| How it picks a route | Probe every route in parallel, prefer LAN over remote, fall through on failure. |
| When it re-evaluates | On connect, every 60 s, on app foreground, and on network change (`expo-network`). Migrates an open session. |
| LAN security | Relay protocol (tweetnacl box hello + secretbox frames) over a direct WebSocket, with the Mac's key pinned. |
| Desktop control | "Allow on local network" toggle in Settings → Phone, on by default. |
| Indicator | "Local network" / "Remote" label next to each computer's status dot; route list with "In use" in the computer's settings. |
| Native build | Needed (`expo-network`). Add `NSLocalNetworkUsageDescription` in the same build. Approved by Victor 2026-10-06; never started by an agent. |

## Today

- The bridge listens only on `127.0.0.1:8797` and rejects any non-loopback Host (`apps/daemon/src/mobile-bridge.cjs:635`, `:286`).
- A saved host has exactly one transport: Cloudflare (`https` + Access headers) or relay (`apps/mobile/src/client.ts:90`).
- `localEndpoint` refuses `http`/`ws` to anything but `127.0.0.1` / `10.0.2.2` (`client.ts:34`).
- No LAN discovery, no local IP detection, no network-change handling anywhere.

## Mac (daemon)

### LAN listener

A new WebSocket server on `0.0.0.0:8798` (`LAN_PORT`, overridable like `localPort` for tests), started by `phone.cjs`
when phone access is on and the LAN toggle is on. The loopback bridge on 8797 is untouched.

- `GET /v1/hello` (unauthenticated) answers `{ "v": 1, "hostId": "<22 b64url>" }`. It is the cheap probe; it reveals only
  the public relay id the QR already carries.
- `GET /v1/phone?id=<hostId>` upgrades to a WebSocket that speaks the relay's phone protocol unchanged: box hello,
  accept, then secretbox frames carrying requests and live streams. A wrong `id` gets 404.
- Every other path gets 404. No Host or Origin relaxation on the loopback bridge.

Implementation: extract the per-phone logic of `relay-host.cjs` (`hello`, `handleMessage`, `forward`, `liveOpen` and
their limits: `MAX_LIVE`, `MAX_INFLIGHT`, `MAX_UPLOAD`, `REQUEST_TIMEOUT`) into a unit that serves one phone channel
given a `send(bytes)` and a stream of incoming bytes. The relay session feeds it frames demultiplexed by conn id; the
LAN listener feeds it one socket per phone. Both forward to the loopback bridge with the bearer token, as today.

`hostAccept` already checks the token inside the hello and refuses unknown phone keys unless pairing is open; the LAN
listener uses the same `phones` list and the same `canPair`.

### Identity for every Mac

The LAN path needs a box key pair and `hostId` even on Macs that use Cloudflare. `phone.cjs` reads (or creates) the
relay identity whenever phone access starts, not only in relay mode. Reset rotates it, as today, which also invalidates
learned LAN routes.

### Advertising routes

A new method on the bridge's authenticated `POST /rpc`, `phone:routes`, params `{ "phoneKey": "<43 b64url>" }`. The
bridge handles it itself through a hook `phone.cjs` passes to `startMobileBridge` (it needs the phones list and LAN state),
and it is never forwarded to the daemon client:

1. Adds `phoneKey` to the known phones (so a Cloudflare-paired phone can complete the LAN hello without a pairing window).
   It is authorized by the bearer token on a route the phone already trusts (TLS to Cloudflare, or the relay's E2E).
2. Answers `{ "v": 1, "hostId", "key": "<43 b64url box public key>", "lan": ["ws://192.168.1.20:8798", ...] }`.
   `lan` is empty when the toggle is off.

Addresses: IPv4 only, from `os.networkInterfaces()`, private ranges only (10/8, 172.16/12, 192.168/16), skipping
internal, link-local and virtual interfaces (`utun*`, `bridge*`, `vmnet*`, `awdl*`, `llw*`). Never hostnames: `name.local`
can resolve to another machine. Tailscale (100.64/10) is out of scope for now.

### Desktop

Settings → Phone gets an "Allow on local network" switch, on by default, stored in `mobile.json` as `lan: true|false`
(absent means on). Below it, a status line: "Reachable at 192.168.1.20" or "Off". Turning it off closes the 8798 server
and drops its phones; the next `phone:routes` answers `lan: []`. macOS may ask once to accept incoming connections.

`status()` gains `lan: { enabled, addresses }`; `electron.d.ts` and `lib/phone.ts` carry it to the UI.

## Phone

### Saved routes

`SavedHost` (`apps/mobile/src/hosts-store.ts:4`) gains:

```ts
routes?: { lan?: { hostId: string; key: string; endpoints: string[]; learnedAt: number } };
```

The paired route (Cloudflare address or relay) stays the primary and is never modified. `routes.lan` is replaced on
every successful `phone:routes` answer and removed when the answer has no `lan` entries or a different `key` (Reset).

### Learning

After any successful connection over the primary route, the phone calls `phone:routes` with its own box public key
(`phone-identity.ts`, created if missing for Cloudflare hosts) and saves the answer. It repeats on every reconnect over
the primary route, so changed IPs are picked up.

### Choosing a route

A route supervisor per host owns the active client:

1. Candidates, in preference order: each LAN endpoint, then the primary route.
2. Start probes in parallel. LAN probe: `GET http://<ip>:8798/v1/hello`, 2.5 s timeout, valid only if `hostId` matches.
   The primary route has no probe and is always a candidate.
3. Walk candidates in order; each waits only for its own probe. A LAN route that answered is opened with
   `createRelayTransport` against `ws://<ip>:8798/v1/phone?id=<hostId>` with the pinned `key`. The pinned key is the
   real guarantee: a different machine on the same IP elsewhere cannot complete the hello, and the token travels only
   inside the box.
4. A LAN route that answered the probe but failed to open is held back for 5 minutes.
5. `localEndpoint`'s http restriction is untouched; LAN traffic goes only through the relay transport.

### Re-evaluating and migrating

While connected over the primary route, the supervisor probes the LAN routes:

- every 60 s,
- when `AppState` becomes active,
- when `expo-network`'s `addNetworkStateListener` reports a change of type or connectivity.

If a LAN route answers and opens, the supervisor swaps the client: live streams resubscribe on the new transport using
the existing resubscribe path, in-flight requests finish on the old one, then the old one closes. While on LAN, losing
the socket (the relay transport's 45 s silence, or a network-change event) falls back to the primary route through the
same walk.

### UI

- Computers list: "Local network" or "Remote" next to the status dot.
- Computer settings page: the routes (Local network with its address, Cloudflare or Relay), the active one marked
  "In use".

### Native

- Add `expo-network` (`npx expo install expo-network`).
- `app.json` → `ios.infoPlist.NSLocalNetworkUsageDescription`: "Milagre connects to your computer directly when you are
  on the same network."
- Confirm with `expo prebuild` that ATS allows `ws://` to private IPs (Expo's template sets `NSAllowsLocalNetworking`;
  raw IPs are also outside ATS). If it does not, add `NSAllowsLocalNetworking` in the same change.
- The fingerprint changes. The PR is not merged until a new build is planned; no agent starts EAS or TestFlight.

## Desktop and mobile parity

Desktop is the host side: the toggle and status are its counterpart. Desktop does not connect to other Macs, so there is
no route picker to mirror there.

## Errors

- Probe timeouts and failures are silent; the user sees "Remote".
- `bad-token` or `host-reset` over LAN behave as they do over the relay (scan again).
- `unknown-phone` over LAN means `phone:routes` never registered the key: drop `routes.lan` and relearn over the primary.

## Testing

- Unit (daemon): address filter (private, skips virtual and link-local); `/v1/hello`; `phone:routes` registers the key
  and honors the toggle; LAN listener serves a full hello + request + live stream through the extracted phone channel;
  relay host behavior unchanged (existing tests stay green).
- Unit (phone): route ordering, probe `hostId` mismatch, 5-minute hold, migration keeps live streams, fallback on loss.
- e2e: throwaway daemon (`startDaemon({ dataDir: tmp, phoneOptions: { localPort: 8897, lanPort: 8898 } })`) and the
  phone relay transport against `ws://127.0.0.1:8898`. Never Victor's data dir or ports 8797/8798.
- Electron check for the Settings → Phone toggle, with screenshots for the PR.
- Manual on device after the build: home Wi-Fi shows "Local network"; switching to cellular falls back to "Remote"
  within seconds; returning to Wi-Fi switches back.

## Out of scope

Tailscale routes, mDNS/Bonjour, user-reordered routes, IPv6, TLS on the LAN listener.
