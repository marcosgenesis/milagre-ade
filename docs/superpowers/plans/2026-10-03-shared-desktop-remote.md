# Shared desktop and remote host implementation plan

> **For agentic workers:** Use superpowers:executing-plans task by task. The user authorized implementation in the existing PRs. Continue within that scope without repeating approval gates; ask only for missing endpoint configuration.

**Goal:** Desktop and mobile control the same persistent daemon, with managed startup and a configured stable HTTPS endpoint.

**Architecture:** Reuse the private socket and existing profile. Keep per-client view/focus in the daemon server; keep native UI adapters in Electron. The mobile host attaches to this daemon and a macOS LaunchAgent manages the host/tunnel lifecycle.

**Tech Stack:** Existing Node 24+, Electron, CJS, npm workspaces, macOS launchd, installed tunnel clients. No dependency upgrades.

**Spec:** `docs/superpowers/specs/2026-10-03-shared-desktop-remote-design.md`.

## Landing status (2026-10-03)

The later user request to merge the implemented work into main supersedes the original draft-only delivery instructions below. Tasks 1 and 2 are implemented in this increment. Task 3 (managed remote host/service/tunnel) and the full mobile integration in Task 4 remain pending. This does not migrate or restart the user's live desktop.

Recovery now bounds queued events, skips deleted Projects, and never replays failed mutations. Explicit desktop updates stop and save the daemon before replacing its bundle; normal quit retains the host and does not install an update. The canonical Project resolver and registry from merged core #131 are preserved.

## Global constraints

- Preserve existing data paths, Chat/provider IDs, desktop IPC and audit fixes. Never edit live coordination state or steal locks.
- Update #131 and #137, propagate through #139/#140/#141, keep drafts. Do not merge main or force-push.
- Reconnect snapshots, never replay commands. Desktop quit disconnects; explicit daemon stop saves and stops agents.
- Keep tokens private, HTTP loopback-only, and the unrelated ngrok endpoint intact. No provider account or endpoint is assumed.
- Verify with temporary Projects/profiles; retain the user's working trial until its replacement is verified.

## Review focus

- Two clients view different Chats; completion/read state and reconnect must follow the correct client.
- A mutation outlives a broken connection; no implicit retry or false acknowledgement.
- Packaged Electron starts a daemon without checkout files or an external Node runtime.
- Concurrent launch, stale locks, failed saves and incompatible daemons must fail without duplicate owners or lost state.
- Service paths contain spaces; existing service definitions and tunnel credentials must not be overwritten or exposed.

## Task 1: Daemon client sessions and bootstrap (#131)

**Files:** `apps/daemon/src/{server,cli,bootstrap,power}.cjs`, daemon tests and package exports; `packages/core/src/runtime.cjs`, `agents/chat-host.cjs` and tests.

**Interfaces:** `ensureDaemon({dataDir,version,cwd,worktreeRoot,executable,entry,env})` returns a connected socket client. Status includes `capabilities: ['desktop-v1']` and `methods`. `daemon:focus` takes `{focused,projectPath,chatId}` for that socket. `daemon:flush` invokes runtime flush without closing. Runtime `focused(view?)` and `flush()` preserve the embedded defaults. `isChatFocused(chatId)` supports multiple focused clients.

- [x] Write failing socket tests for per-client view/read state, notifications, flush, two concurrent attach/start calls, compatibility and preserved live turns after disconnect. Run `node --test apps/daemon/src/*.test.cjs`; expect new assertions to fail.
- [x] Implement the advertised contract, per-client view state, detached bootstrap and macOS activity blocker. Keep startup ownership fail-closed.
- [x] Run daemon and core suites; expect all pass. Commit the tested change.

## Task 2: Desktop daemon adapter and recovery (#131)

**Files:** `apps/desktop/electron/{main,daemon-runtime,preload}.cjs`, desktop package, renderer connection/snapshot handlers, `scripts/test-desktop.cjs`, adapter tests.

**Interfaces:** `connectDesktopRuntime(options)` returns the runtime facade plus `setFocused(boolean)`; its `close()` flushes/disconnects. It forwards `runtime:connection` and `runtime:snapshot` events. Snapshot includes current Projects, runs and ports; renderer restores them without clearing draft/selection. Main's OS callbacks remain local.

- [x] Write failing adapter tests for real socket events, disconnect/reconnect, no mutation replay, per-client Project selection and quit retaining the daemon. Run focused tests; expect missing adapter failures.
- [x] Replace desktop embedded runtime with the facade; add connection notice and snapshot subscriptions. Advertise the existing profile in host documentation. Update ADR-0003 for the authorized transport switch.
- [ ] Run types/build, agent/UI/release/monorepo tests and real desktop saved-state smoke. Test packaged spawn/attach. Expect all pass and saved Chat/provider ID unchanged. Commit and update #131, then merge it into #137.

## Task 3: Persistent shared host and macOS service (#137)

**Files:** `scripts/mobile-host.cjs`, `apps/daemon/src/{host,service}.cjs` and CLI, host/service tests, mobile transport if tunnel headers are required, docs and root scripts.

**Interfaces:** host startup reuses `ensureDaemon`; attached shutdown never stops another owner. `service install|status|uninstall --data-dir ...` manages one user LaunchAgent with explicit executable/entry/profile and optional tunnel configuration. Connection file remains 0600 and token stable. Tunnel arguments are arrays, never interpolated shell.

- [ ] Write failing tests for attach/close preserving desktop turns, token reuse, service path escaping, owned-file checks, install rollback, and tunnel validation/redaction. Run focused tests; expect failure.
- [ ] Implement managed host/service and dedicated configured tunnel startup. Keep endpoint activation pending actual configuration. Document start/stop/recovery and provider TLS trust.
- [ ] Run host/daemon/mobile/types tests, real launchd lifecycle with a temporary profile, and authenticated HTTPS when an endpoint is supplied. Expect retained Chat and token on restart and 401/403 failures for unauthorized clients. Commit and update #137.

## Task 4: Integrate, verify and refresh existing PRs

**Files:** affected audit declarations/merge resolutions, `scripts/test-desktop-mobile.cjs`, verification records and PR descriptions.

**Interfaces:** preserve Task 3 audit write-behind and durable flush/retry while adopting the new runtime facade. New lifecycle tests run against the complete stack.

- [ ] Merge updated parents into #139, #140 and #141 in order. Resolve type/quit/flush changes while retaining audit regression tests.
- [ ] Run complete types/build/agent/UI/release/mobile/monorepo suites, all Electron fixtures, packaged desktop and native mobile against the same temporary Project. Capture real shared Chat and connection-state screenshots. Expect preserved data, one runtime owner and no duplicate command delivery.
- [ ] One fresh whole-increment review, one regression-test fix pass for accepted Important/Critical findings; record deferred minors. Update all affected draft descriptions/screenshots and verify CI/mergeability on exact heads.
- [ ] Refresh Claude handback files with new PR scope and remaining endpoint or live-app migration constraints. Keep the user's host trial available.
