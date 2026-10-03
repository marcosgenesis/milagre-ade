# Run Milagre in a local simulator

This preview connects an Expo mobile app to the Node daemon on your Mac. It groups Chats by Worktree, creates Worktrees, shows transcripts and live text, sends text, photos and files, stops or continues a turn, and answers approvals and questions. It also supports model, effort, fast-mode and permission settings, Chat rename/archive/restore, and read-only changes and file diffs. The daemon owns the state and keeps running when the app disconnects.

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

Omit `--project` to choose a Project in the app. The separate profile defaults to `~/.milagre-mobile`; use `--data-dir /absolute/profile` to choose another. The command prints the private connection-file path, then a QR code and the same pairing link. In the app, choose the scan option and point the camera at the QR code; the app fills in the address, token and computer name. Pass `--no-qr` to print only the link. The QR code and link contain the token, so do not share or screenshot them. To pair by hand instead, enter the address and the token from the connection file. Leave **Remember this computer** selected to save the connection in platform secure storage. **Forget this computer** removes the saved connection. Tokens remain stable across host restarts; to rotate one, stop the host, remove its `mobile-connection.json`, restart and connect again.

Ctrl+C stops the host cleanly. On macOS, `--stay-awake` keeps the computer awake while the host runs; it does not keep a closed laptop lid awake. The separate daemon/bridge commands below remain available.

### Share the desktop's Chats

The current desktop starts or attaches to the persistent daemon using its Electron userData profile. The mobile bridge can attach to that same daemon, so both clients see the same saved Chats and provider sessions. First launch the current desktop, then use its actual profile path below. The path can differ between development, packaged and explicitly configured launches; the host's `daemon:status` response identifies it. Do not point `mobile:host` at an already owned desktop profile: that command starts its own daemon.

```sh
# Replace this with the profile used by the running current desktop.
MILAGRE_DESKTOP_PROFILE="/absolute/path/to/desktop/userData"
npm run daemon -- status --data-dir "$MILAGRE_DESKTOP_PROFILE"

# Attach only the HTTP bridge. The connection file must not exist yet.
npm run daemon -- bridge --data-dir "$MILAGRE_DESKTOP_PROFILE" --connection-file /tmp/milagre-desktop-mobile-connection.json
```

In another terminal, run `npm run mobile`, choose the simulator with Shift+i, and enter `http://127.0.0.1:8787` plus the token from that connection file. Open the same absolute Project path as desktop. Closing desktop leaves its daemon running; Ctrl+C in the bridge terminal disconnects mobile without stopping the daemon. If the daemon stops or an update restarts it, restart the bridge and pair using a new connection file.

This attaches clients without copying or migrating state. A desktop from before the shared-daemon change still owns an embedded runtime: close that older app cleanly before launching the current build with its existing profile. No command here replaces a running app or steals its locks. See [daemon recovery](local-daemon.md) if ownership fails.

### Separate daemon and bridge processes

For an isolated trial, close the chosen Project in other Milagre hosts first, or use a temporary Project. The separate daemon has its own profile and cannot open a Project already owned by desktop.

Run each command in a separate terminal, from this repository root:

```sh
# Terminal 1: use a separate profile, not desktop userData.
npm run daemon -- serve --data-dir /tmp/milagre-local-profile

# Terminal 2: connection-file must be a new file.
npm run daemon -- bridge --data-dir /tmp/milagre-local-profile --connection-file /tmp/milagre-local-connection.json

# Terminal 3: start the mobile app without demo defaults.
npm run mobile
```

Press Shift+i and choose your simulator. Enter `http://127.0.0.1:8787` and the token from `/tmp/milagre-local-connection.json`. Open an absolute Git Project folder on your Mac. Start a Chat with your installed, logged-in Codex or Claude provider; the model menu uses the provider's reported models and capabilities. Permissions default to **Ask approval**.

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

### Temporary HTTPS test without an account

A [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) can test the same path using only a temporary Project:

```sh
cloudflared tunnel --url http://127.0.0.1:8787 --http-host-header 127.0.0.1:8787 --loglevel info --no-autoupdate
```

Use the printed HTTPS origin in the app. Keep logging at info or higher; debug logging can include request headers. The random URL lasts only while that process runs. Stop it with Ctrl+C. The same TLS-provider trust boundary applies. For regular remote use, configure a stable private endpoint; the test does not install a background tunnel service.

## Standalone iOS simulator build

With Xcode 26.4 or newer and its simulator runtime installed:

```sh
cd apps/mobile
CI=1 npx expo prebuild --platform ios --clean
CI=1 npx expo run:ios --configuration Release --device generic --output /tmp/milagre-mobile-release --no-bundler
```

The clean prebuild regenerates only the ignored iOS project. App config enables the [Expo 57 scene lifecycle](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27) needed to launch Xcode 27 builds on iOS 27. Keep native configuration in app config so it survives regeneration.

This generates the ignored native project and produces `/tmp/milagre-mobile-release/MilagreLocal.app`. Install that app on the chosen iOS simulator and launch **Milagre Local**. Metro and Expo Go are not needed. Run `mobile:host`, enter its connection, and keep that host running. A physical-device build needs signing and a reachable HTTPS host; this simulator artifact cannot be installed on a phone.

## Boundaries

- The HTTP bridge binds only to `127.0.0.1`. Every request needs its token; browser Origins and unexpected Hosts are rejected. Only the mobile command allowlist is available. RPC bodies are capped at 1 MiB and concurrent requests at 16. File uploads use a separate authenticated 7 MiB envelope for at most 5 MiB of decoded content.
- Foreground snapshots poll once per second. PR status refreshes every 30 seconds on the focused, foreground screen with at most two requests in flight. Chat renders Markdown, expandable tool output, live activity, agent counts and PR blockers. The composer opens native model/effort/permission controls and Photo Library/Files pickers. Up to four attachments fit per message; photos are resized to 1024 pixels and capped at 160 KiB each, files at 5 MiB each. Persisted and agent-generated images are fetched through the bridge (see Images below). Large-history virtualization is still pending.
- Uploaded files stay in the host profile for Chat history. Failed sends preserve drafts; retrying may upload a file again. Abandoned-upload cleanup and upload reuse are pending.
- Local simulator and direct HTTPS host access are supported. An encrypted relay, push notifications and production background services come later.
- iOS works in Expo Go and a standalone simulator Release build. Android uses the same client; its host address is `http://10.0.2.2:8787`. Android runtime behavior still needs emulator validation. No physical-device or store build is claimed.
- Demo connection defaults are injected into a local development bundle. Never publish that bundle or use this mechanism for a real remote token. The real workflow enters the token in the app.

## Images

`GET /media?projectPath=<abs>&path=<abs>` streams an image file to the paired app through the same authenticated bridge (token, Host and Origin rules). It serves only png, jpeg, gif, webp and heic files (checked by extension and file header) up to 15 MiB, and only from inside the Project's Worktrees, the Project's `.milagre/images` folder, the host profile's `mobile-attachments` folder and the folders where agents save generated images. Paths are resolved through symlinks first. Anything else returns 403, a non-image returns 415 and a relative path returns 400.

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

Expo Doctor passes 20 of 21 checks. Its duplicate-React check sees desktop React 19.3.0 and mobile React 19.2.3. Both are intentionally retained to preserve the desktop and match Expo 57. The running iOS Metro source map contains only `apps/mobile/node_modules/react`; the simulator renders and handles hooks correctly. The standalone iOS simulator Release build also compiles and runs with these separate versions. See [Expo's duplicate-package guidance](https://docs.expo.dev/guides/monorepos/#duplicate-native-packages-within-monorepos).

### Opt-in real-provider check

```sh
node scripts/check-mobile-providers.cjs --run
```

This uses the installed Codex and Claude accounts for one short no-tool prompt each in an isolated temporary Project. It checks the full mobile HTTP/socket/core path, restarts the host and verifies the token, saved Chats, provider session IDs and replies. It is excluded from normal tests and CI because it consumes provider quota. The saved temporary Project path is printed for inspection.
