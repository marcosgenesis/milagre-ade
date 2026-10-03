# Local mobile simulator implementation plan

> **For agentic workers:** Use superpowers:executing-plans task by task. The user authorized a working local simulator app today; execute inline, then perform one independent whole-branch review.

**Goal:** Connect an iOS simulator to the local daemon, list/open Chats and send/receive a message.

**Architecture:** Expo mobile workspace calls a token-protected loopback HTTP bridge. The bridge forwards an explicit command subset to the existing private socket; core remains the only state writer. Foreground snapshot polling recovers after disconnect without replaying mutations.

**Tech Stack:** Expo 57, React Native, TypeScript, existing shared domain types, Node HTTP and tests.

**Spec:** https://github.com/marcosgenesis/milagre-ade/issues/130

## Constraints

- Keep desktop identity, scripts, stored state and external dependency versions compatible. Stack on the core/daemon draft.
- Bridge binds only 127.0.0.1, authenticates every request and does not own a second runtime.
- No relay, production pairing, public listeners or phone provisioning in this increment.
- Run a dedicated iOS simulator and temporary demo Project. Do not interfere with other devices or live Projects.
- Real screenshots live on the screenshots branch, never in this feature's commits.

## Review focus

- Missing/wrong tokens, hostile Origin/Host, oversized bodies and unsupported methods cannot execute a command.
- Lost connections do not stop a turn or automatically resend text. Reconnect reads current state.
- Slow and failed sends preserve drafts and release busy state; background polling stops.
- Permission requests and agent questions remain actionable from mobile. Interrupted state stays resumable.
- Demo credentials/data remain local and ignored; Expo dependencies do not break desktop packaging or React resolution.

## Task 1: Authenticated loopback bridge

**Files:** apps/daemon/src/mobile-bridge.cjs, its tests, CLI, core runtime snapshot handler/test.
**Interfaces:** startMobileBridge({dataDir, port, token}) returns {url, close}; POST /rpc {v:1, method, args} returns {v:1,result|error}. GET /snapshot?projectPath=... returns {project, runs}. Both require Authorization: Bearer token. Project snapshot reads existing cached state without opening or reconciling it.

- [x] Add failing tests for token/Origin/Host/method/body guards, real socket RPC, snapshot and bridge disconnect preserving the daemon.
- [x] Implement loopback listener, allowlist, 1 MiB request limit, 16 in-flight requests, constant-time token comparison, bounded timeouts and explicit errors. Write CLI connection details to an exclusive 0600 file when requested.
- [x] Run daemon/core tests and commit.

## Task 2: Minimal Expo client and reproducible demo

**Files:** apps/mobile/{package.json,app.json,src/app/*,src/*}, scripts/mobile-demo.cjs, root scripts and lockfile.
**Interfaces:** client call(method,args) performs one authenticated request, with no mutation retry; snapshot(projectPath) reads Project and live runs. Shared model types supply Chat, transcript, run and approval shapes.

- [x] Test client error/timeout/version handling and local endpoint validation before implementation.
- [x] Add workspace with connection, Project/Chat list, transcript, composer, stop/resume, approval and question controls using shared native primitives. Poll only while foregrounded, preserve drafts on error and reconnect manually.
- [x] Add a temporary demo Project with deterministic provider events and a real runtime/socket/bridge. Start Metro with local connection defaults; label demo responses. Separate documented real-provider workflow.
- [x] Run mobile typecheck/tests, iOS bundle export, dependency compatibility check and commit.

## Task 3: Simulator verification and draft

**Files:** docs/mobile-local.md, README/CONTRIBUTING, this verification record and relevant fixes.

- [x] Use a dedicated iOS simulator with Expo Go; verify connect, list/open Chat, send/receive, approval, stop, reconnect and bad token through real UI. Capture screenshots outside the repo.
- [x] Run root typecheck/build/tests and packaged desktop smoke after the mobile dependency additions.
- [x] Perform one independent review, fix important findings with reproducing checks, upload immutable screenshots and publish a stacked draft PR. Check the stack for conflicts and CI.
- [x] Leave the simulator and demo available for the user with exact restart/stop instructions. Keep audit Tasks 1, 2, then 3 queued for new worktrees and the specified Claude Fable 5.1 handback.

## Rulings

The user already authorized progressing through phases and testing a local simulator today. The implementation continues without repeated approval gates. iOS is the default on this Mac while the platform preference question remains unanswered. Expo Go keeps the first run free of provisioning; a development build can follow when native capabilities require it. Local polling is sufficient for this minimal slice; internet transport and delta streaming remain later work.


## Verification record

The local iOS slice runs in Expo Go on the dedicated Milagre Local simulator (iPhone 17 Pro, iOS 26.2). Real UI checks cover connection, Project/Chat lists, existing and new Chat send/reply, approval after reconnect, question answer, Stop and a wrong-token error. The restarted demo used a new temporary Project; the earlier saved demo was retained.

Automated checks pass for mobile transport, deferred-request UI regressions, demo through the real bridge/socket/core, daemon guards, root and mobile typechecking, mobile lint, desktop build, agent/UI/release/workspace suites and iOS export. Desktop source and local ad-hoc packaged smoke verify saved Chats, provider session IDs, handover drafts, Project settings, bundled skills and UI preferences. Main #132 dragging, #133 translucency and #134 per-model fast mode changes are preserved through the stack. The ad-hoc DMG/ZIP and packaged smoke were checked through #133; after #134, the root/mobile suites, source smoke and updated Chat-layout fixture were rerun. No existing external dependency version, resolved URL or integrity changed when adding the mobile workspace.

One independent review of 6af67b2..0994cf8 found two Important issues and no Critical or Minor findings. The single fix pass first reproduced a late previous-Project poll and a new-Chat draft lost during its first send. Selection identity now rejects stale polls; remaining text moves to the created Chat before navigation. The same tests cover disconnect during a pending connection, successful draft clearing and failed-send recovery. All five UI checks pass. No second review was run.

Scope rulings: Android runtime, native development/release builds, physical devices, remote access/pairing and richer transcript rendering remain later work. The core beyond the read-only snapshot handler had its own phase 2 review. Cost: those surfaces have no new mobile validation here. No live provider-account turn was performed; the simulator and end-to-end checks use the explicitly labeled demo agent. Production desktop signing/notarization and update installation remain release checks.

Expo Doctor passes 20/21 checks. The warning is the intentionally separate desktop React 19.3.0 and mobile React 19.2.3 installations. The running iOS bundle resolves only mobile React. This preserves desktop dependencies and matches Expo 57; native builds still need their own resolution check. Metro uses IPv4-first DNS because this Mac otherwise binds localhost to ::1 while Expo advertises 127.0.0.1. The installed eslint CLI runs the Expo config because Expo's lint launcher could not resolve workspace-local eslint from its hoisted CLI.

The mobile draft is stacked on #131, which is stacked on #126. Screenshots are immutable images on the separate screenshots branch. Start with `npm run mobile:demo`, press Shift+i and select Milagre Local. Ctrl+C stops the demo and Metro. The demo is left running for the local trial. Audit Tasks 1, 2, then 3 remain queued in separate worktrees, followed by the plan's Claude Fable 5.1 handback in a new Chat and Worktree.
