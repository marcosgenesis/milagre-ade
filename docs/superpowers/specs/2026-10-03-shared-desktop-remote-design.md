# Shared desktop runtime and persistent remote access

The user authorized outstanding items 1 and 2 in the existing draft PRs: control the desktop's existing Chats from mobile, and keep a stable HTTPS connection available outside the local network. Preserve every existing Chat, provider identifier, profile path and desktop feature. The running development app and unrelated ngrok endpoint must remain untouched.

## Shared runtime

Desktop becomes a client of the private Unix-socket daemon using its existing Electron userData directory. It attaches to a compatible daemon or launches a detached one with the bundled runtime. Electron retains dialogs, images, editors, notifications, updates and renderer storage. The daemon owns core and its exclusive Project locks. No state is copied or independently reconciled by a client. Older desktop instances must exit before the new daemon can own their Projects.

Daemon startup advertises desktop capability and command names. An incompatible daemon fails with a useful restart instruction. Startup never steals a lock or removes a stale socket. Concurrent desktop launches converge on one owner. Packaged launch must resolve daemon/core resources inside the application, without checkout paths or a separately installed Node.

Each desktop socket records its own viewed Project, Chat and focus. Opening a Project on mobile cannot change the desktop's current view or cause the wrong Chat to be marked read. Waiting notices and existing core events are forwarded to Electron. The daemon implements activity-based keep-awake on macOS; remote service mode can keep the machine awake while available. Closing a laptop lid remains outside this guarantee.

Desktop quit flushes accepted changes and disconnects without stopping agents. Explicit host stop drains and saves resumable turns. Disconnects reject pending requests without replay. Reconnect refreshes Project/run/port snapshots and preserves the renderer's unsent draft. The renderer shows a connection notice while disconnected. Updates cannot silently connect to an incompatible daemon.

## Persistent remote access

The mobile host can attach to the same desktop profile's daemon instead of creating a competing runtime. Closing a bridge that attached to an existing daemon leaves it running. Tokens remain private and stable across restarts. The bridge keeps its loopback binding, Host/Origin checks, command allowlist and mutation semantics.

A macOS user LaunchAgent installs and starts a managed host at login using explicit absolute paths. Status and uninstall commands are provided. The managed service does not overwrite another installation, log tokens, expose a plaintext public listener or remove ownership locks automatically. Restart after an ordinary clean stop preserves history and pairing. An unclean crash with retained ownership fails visibly and requires the existing verified-owner recovery procedure.

Persistent HTTPS uses a dedicated configured tunnel endpoint, with its credentials kept outside the repository and command output. The existing ngrok endpoint serves another Project and cannot be reused. Support a managed ngrok endpoint or a named Cloudflare tunnel configuration; a reverse proxy maintained elsewhere may also target the loopback bridge. No tunnel provider account, paid resource or DNS change is invented. The endpoint choice is pending the user's answer; local shared-runtime work proceeds independently.

This increment does not build an encrypted relay, background mobile execution, push notifications, QR pairing, voice, physical-phone distribution or Android validation. TLS terminates at the configured tunnel provider. Internet access requires the Mac and tunnel online.

## Delivery and acceptance

Core/desktop changes update #131; host/service changes update #137. Propagate each parent update through #139, #140 and #141 while retaining all audit fixes. No new PR and no merge into main. Add real screenshots of shared Chat control and connection states to immutable commits on the screenshots branch.

Prove a saved desktop Chat and native provider ID survive the transport change; desktop and mobile observe one Chat/approval; closing desktop preserves the turn; reconnect restores current state without duplicate sends; focus remains per client; failed saves prevent a claimed successful flush; all ownership, auth and compatibility tests pass. Exercise managed service start/status/stop with a temporary profile, verify packaged desktop behavior, and rerun a native mobile smoke against the final audit stack. A permanent internet endpoint is only claimed after a real authenticated HTTPS test at that endpoint.
