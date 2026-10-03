# Run Milagre in a local simulator

This preview connects an Expo mobile app to the Node daemon on your Mac. It lists Projects and Chats, shows transcripts and live text, sends text, stops or continues a turn, and answers approvals and questions. The daemon owns the state and keeps running when the app disconnects.

## Try the demo

From the repository root:

```sh
npm ci
npm run mobile:demo
```

Press **Shift+i** in that terminal and select **Milagre Local** (or your chosen iOS simulator). Expo installs its matching Expo Go app if needed. On Expo Go's first launch, dismiss its developer-menu tutorial.

1. Tap **Connect to computer**. The temporary demo connection is filled in.
2. Open **Mobile playground**, then **Hello from your Mac**.
3. Send a message. The labeled demo agent replies through the real core, socket and HTTP bridge.
4. Send `approval`, `question`, or `slow` to try approval controls, answers or Stop. Disconnect and reconnect to see saved messages and pending requests.
5. Press **Ctrl+C** in the demo terminal to stop Metro, the bridge and the demo daemon. The command prints the temporary Project location; its saved Chat remains there for inspection. A later demo run creates a fresh Project.

The demo is deterministic and uses no provider account. It never opens your development repository. Do not mistake its replies for model-generated output.

## Use an installed provider

The persistent host starts the real providers installed and logged in on your Mac:

```sh
npm run mobile:host -- --project /absolute/path/to/a/Project --stay-awake
```

Omit `--project` to choose a Project in the app. The separate profile defaults to `~/.milagre-mobile`; use `--data-dir /absolute/profile` to choose another. The command prints the private connection-file path, never its token. Enter its address and token in the app and leave **Remember this computer** selected to save them in platform secure storage. **Forget this computer** removes the saved connection. Tokens remain stable across host restarts; to rotate one, stop the host, remove its `mobile-connection.json`, restart and connect again.

Ctrl+C stops the host cleanly. On macOS, `--stay-awake` keeps the computer awake while the host runs; it does not keep a closed laptop lid awake. The separate daemon/bridge commands below remain available.

### Separate daemon and bridge processes

Close the chosen Project in other Milagre hosts first. The current desktop still embeds its own runtime; this preview controls a separate daemon. Ownership errors name the lock to investigate. Never remove a lock while its owner is running; see [daemon recovery](local-daemon.md).

Run each command in a separate terminal, from this repository root:

```sh
# Terminal 1: use a separate profile, not desktop userData.
npm run daemon -- serve --data-dir /tmp/milagre-local-profile

# Terminal 2: connection-file must be a new file.
npm run daemon -- bridge --data-dir /tmp/milagre-local-profile --connection-file /tmp/milagre-local-connection.json

# Terminal 3: start the mobile app without demo defaults.
npm run mobile
```

Press Shift+i and choose your simulator. Enter `http://127.0.0.1:8787` and the token from `/tmp/milagre-local-connection.json`. Open an absolute Git Project folder on your Mac. Start a Chat with your installed, logged-in Codex or Claude provider; the model field accepts its model ID. Permissions default to **Ask approval**.

Stop Metro and the bridge with Ctrl+C. Stop the daemon cleanly with:

```sh
npm run daemon -- stop --data-dir /tmp/milagre-local-profile
```

The connection token is regenerated on each bridge launch. Use a new connection-file path or remove the old file after its bridge has stopped. With Remember this computer selected, the mobile app keeps the token in platform secure storage. Turn it off for a connection held only in memory. Failed sends retain the draft and are never automatically retried; check the Chat after reconnecting before sending again.

## Connect through HTTPS

Use an HTTPS endpoint from your own reverse proxy, VPN or configured tunnel. It must forward to the loopback bridge and rewrite the Host header to that bridge's address. For an already configured ngrok account:

```sh
ngrok http http://127.0.0.1:8787 --host-header=rewrite --inspect=false
```

Enter the HTTPS endpoint and the host's connection token in the app. `--public-url https://your-endpoint` makes `mobile:host` write that address into its connection file. The token is still required for every request. Browser Origins are rejected. Remote plaintext HTTP and redirected endpoints are rejected by the client; use the endpoint's direct HTTPS origin.

TLS terminates at the proxy or tunnel provider, which can see traffic. This is not Paseo's encrypted relay. Keep HTTP request inspection off so connection tokens and Chat content are not recorded there. No remote endpoint starts automatically. Stop a test tunnel with Ctrl+C. Physical devices also need an installed build or access to the development bundler; the standalone simulator build does not need Metro.

## Boundaries

- The HTTP bridge binds only to `127.0.0.1`. Every request needs its token; browser Origins and unexpected Hosts are rejected. Only the mobile command allowlist is available. Request bodies are capped at 1 MiB and concurrent requests at 16.
- Foreground snapshots poll once per second. Text and tool summaries are supported. Images, full desktop tools, rich markdown and large-history rendering remain desktop capabilities.
- Local simulator and direct HTTPS host access are supported. An encrypted relay, QR device pairing, push notifications and production background services come later.
- iOS uses Expo Go. Android uses the same client; its host address is `http://10.0.2.2:8787`. Android runtime behavior still needs emulator validation. No physical-device or store build is claimed.
- Demo connection defaults are injected into a local development bundle. Never publish that bundle or use this mechanism for a real remote token. The real workflow enters the token in the app.

## Development checks

```sh
npm run typecheck:mobile
npm run lint --workspace @milagre/mobile
npm run test:mobile
npm run test:daemon
npm run export:ios --workspace @milagre/mobile
```

`apps/mobile` uses Expo Router and the default Expo monorepo Metro configuration. `scripts/start-mobile.cjs` selects IPv4-first DNS for Metro because Expo advertises `127.0.0.1`, while Node can otherwise bind only `::1` for localhost on macOS. Desktop React and mobile React resolve independently; existing desktop dependency versions are retained. The native UI's scrolling and choice controls live in `apps/mobile/src/ui.tsx`.

### Validation note

Expo Doctor passes 20 of 21 checks. Its duplicate-React check sees desktop React 19.3.0 and mobile React 19.2.3. Both are intentionally retained to preserve the desktop and match Expo 57. The running iOS Metro source map contains only `apps/mobile/node_modules/react`; the simulator renders and handles hooks correctly. A native development/release build still needs its own validation. See [Expo's duplicate-package guidance](https://docs.expo.dev/guides/monorepos/#duplicate-native-packages-within-monorepos).
