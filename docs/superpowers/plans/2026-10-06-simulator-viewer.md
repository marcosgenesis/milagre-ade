# Simulator viewer implementation plan

**Goal:** View and control a running iOS simulator from the Simulator pill beside Subagents on desktop and phone.

**Design:** [Research and approved composer direction](../../research/remote-simulator-control.md), with [local validation](../../research/remote-simulator-local-spike.md). The user approved implementation on October 6. Use a daemon-owned pinned Expo Device Hub helper, WebRTC video, and explicit authenticated RPC for signaling and input. Share the browser receiver between an Electron iframe and the existing Expo DOM WebView. Simulators are machine-wide and labeled "On this Mac"; this version does not invent Worktree ownership.

**Constraints:** No native mobile dependency or configuration changes. Check the iOS fingerprint before and after. No native build, deployment or OTA publication. Reuse Ports pill styling with SmartphoneIcon on both clients. Closing a viewer never stops its simulator. Constrained/demo hosts cannot access simulators. Only one viewer controls each device; takeovers revoke old input. No arbitrary helper URL, process or shell access is exposed.

## Interface

All commands accept one object except `simulator:list` (no arguments). The daemon supplies a trusted connection identity outside the arguments. Viewer IDs are random capabilities, scoped to that connection; the phone bridge owns its daemon connection and does not expose other viewers' IDs.

- `simulator:list` -> `{ devices: SimulatorDevice[], supported: boolean, error?: string }`; device = `{ id, name, platform: 'ios', version }`, running devices only.
- `simulator:open({deviceId})` -> `{ viewerId, device, iceServers: {urls: string | string[], username?: string, credential?: string}[] }`.
- `simulator:offer({viewerId, sdp})` -> `{ type: 'answer', sdp }`.
- `simulator:status({viewerId})` -> `SimulatorStatus` and renews the viewer heartbeat.
- `simulator:control({viewerId, takeOver: boolean})` -> `SimulatorStatus`; claims a free controller or explicitly takes over.
- `simulator:input({viewerId, sequence, generation, event})` -> `{ accepted: boolean }`.
- `simulator:close({viewerId})` -> `null`.

`SimulatorStatus` = `{ width: number, height: number, orientation: 'portrait' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right', generation: number, controlling: boolean, ready: boolean }`.

Input = `{ kind: 'touch', phase: 'begin' | 'move' | 'end', points: {x:number,y:number}[] }` (one or two normalized raw-capture points), `{kind:'button',button:'home'}`, `{kind:'rotate',orientation: SimulatorStatus['orientation']}`, or `{kind:'key',phase:'down'|'up',usage:number,key?:string,shifted?:boolean}`. Reject stale generation, nonincreasing sequence, malformed values and input without control. Never replay input across reconnects.

## Tasks

1. **Host adapter and viewer ownership** (`packages/core/src/simulators*.cjs`): write failing lifecycle/security tests, implement lazy loopback helper, discovery, offer/close, HID adapter, orientation readback, bounded input, single controller, expiry and cleanup. Keep helper crashes isolated. Test wrong owner, unknown device, stale input, takeover, socket cleanup and shutdown.
2. **Shared receiver and clients** (`packages/shared/src/simulator*`, desktop SimulatorTrack, mobile simulator sheet): write receiver lifecycle/coordinate tests, implement WebRTC and bounded ordered input, state/retry/control UI, smartphone pill, selection, expand/close. Embed receiver HTML as JS and write a local cache file on mobile so assets travel in OTA. Stream only while open. Test letterboxing/rotation, cancellation, delayed replies and reconnect.
3. **Transport and packaging** (core runtime, daemon server/mobile bridge, desktop preload/types, package configuration): register the explicit methods, supply connection identity, release disconnected owners, deny demo hosts, pin the helper and unpack its native framework. Test denied calls and end-to-end RPC behavior.
4. **Real verification**: desktop and mobile typecheck/lint/tests, fingerprint equality, Electron UI screenshots and a local simulator run in a copied existing mobile binary. Confirm actual video and taps, orientation, close/reopen and control takeover. Use the simulator's onscreen keyboard if host key injection remains unreliable; document any limitation instead of claiming it passed.
5. **Review**: independent review of security, resource lifetime, packaging and both UI paths; fix material findings, rerun affected checks and report remaining hardware/network validation limits.

## Review focus

- Stale input after rotation, takeover or viewer replacement must not reach the simulator.
- Mobile backgrounding and abrupt network loss must release control and end gestures.
- Unauthenticated browsers and confined demo clients must never get helper access.
- Native framework loading must use unpacked paths in packaged Electron.
- The viewer must show a useful error for helper failure or unsuccessful WebRTC negotiation, with a retry that creates a fresh session.

## Evidence

Baseline iOS fingerprint: `64b0bb9aecd3e78a5aab6ea06a990fb26b4c293a`, matching latest finished TestFlight build 22 (`482a4c7b-b863-4214-8a7d-585a4f85753c`). Research-only changes existed before implementation.

Implementation, independent code review and local integration verification are complete. Remote-network release gates remain below.

- Automated checks: core 913 passed, 7 skipped; daemon 171 passed, 3 skipped; desktop UI 216 passed; mobile unit 125 passed and mobile UI 77 passed. The final simulator/transport/mobile UI group has 124 passing tests. Desktop build/typecheck and mobile typecheck/lint pass.
- Real Electron rendering confirms the phone-icon pill beside Subagents, count, device chooser, expanded and narrow viewers, close cleanup, Escape, and light/dark themes. Production CSP permits the exact bundled receiver and rejects an unrelated inline script. An ad-hoc packaged desktop app loads the native addon from its unpacked package and preserves its sibling framework.
- Full local daemon plus authenticated phone bridge plus browser receiver decoded live video. Three taps and a drag delivered four pointerdown/up pairs and eight pointer moves to the Safari fixture. Landscape input also delivered pointerdown/up. Rotation returns to portrait; the first immediate post-rotation portrait tap was not observed, so it is not counted as passed.
- The actual mobile app ran current JS in a copied existing simulator binary, using its existing demo connection mode against the isolated real daemon. Its native DOM WebView showed live video, delivered a tap to the source fixture, and its Home button returned the source to SpringBoard. No native rebuild was used. The chooser initially covered its header; native header/body boundaries and explicit chooser insets fix the sheet layout. Final native screenshots confirm the header, and closing the viewer returns to the Chat and terminates its helper process. Reopening in the same app process reconnects video and control.
- Native iOS 27 initially ignored touch and Home despite accepted HID calls. Restarting only the test simulator restored input. Half-black rotation frames were also present in native source screenshots and settled later. No automatic restart or arbitrary delay was added. After visual review, the footer uses centered icon-only controls with accessible labels and hover titles; visible status and troubleshooting copy were removed. Troubleshooting remains in the setup documentation. Rotate uses portrait/landscape because iPhones ignore upside-down portrait.
- The final iOS fingerprint is unchanged. No mobile native dependency, configuration, build, OTA publication or production deployment was made. Physical TestFlight phones, cellular/forced TURN, automatic TURN credentials and sustained performance remain release gates. Local ad-hoc signing does not prove distribution signing/notarization.

Run evidence and screenshots are outside the repository under `/private/tmp/milagre-simulator-build/`. See [phone setup](../../mobile-local.md#view-a-running-simulator-or-emulator) for operation and TURN configuration.

The isolated daemon, fixture server, helper and UI automation were stopped after verification. Only the two test simulators booted for this task were returned to Shutdown; other running simulators were left alone.


## Android and theme follow-up (October 6)

The approved extension adds running Android emulators to the existing picker and uses the pinned Device Hub scrcpy/WebRTC backend. Discovery excludes offline and physical devices and does not start capture. Each Android device has its own supervised helper; input still passes the controller lease, generation and sequence checks. Back is Android-only. Desktop and mobile show the platform/version and share the icon toolbar.

The toolbar uses the selected app palette, including live changes without reconnecting. Desktop reads CSS tokens; mobile resolves its native appearance to raw theme colors for the WebView. Simulator video retains its own colors.

Local validation: real Android video, touch opening a Settings detail screen, Back returning to Settings, Home returning to the launcher, rotation in both directions, and live theme updates passed through the real daemon and shared browser receiver. Initial saved-snapshot emulator state caused intermittent ADB socket-probe timeouts. A manual cold boot of only the task emulator cleared them; three consecutive opens/closes passed. No automatic reboot was added. Tests cover Android routing, pointer identity, controller validation, per-device helper cleanup, theme changes without reconnecting, and verified preparation of the capture binary.

The native phone app also streamed Android using refreshed JS in the existing simulator binary. A native touch opened an Android Settings detail page; the viewer's Home icon returned Android to its launcher. Changing the iOS appearance while viewing updated the controls bar from light to dark without losing control or reconnecting. Current captures are in the HTML review outside the repository.

Final Android/theme checks: core 920 passed, 7 skipped; shared receiver, transport and mobile UI 101 passed; packaging/monorepo 4 passed; desktop build, desktop/mobile typechecks, mobile lint, Electron theme-switching checks and production CSP checks passed. Mobile fingerprint remains `64b0bb9aecd3e78a5aab6ea06a990fb26b4c293a`. No native build or OTA was published. Signed desktop distribution and physical-phone/cellular tests remain outstanding.
