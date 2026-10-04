# Mobile Push Notifications Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. The user approved the design and requested the complete PR; execute inline, with one independent branch review.

**Goal:** Notify paired phones of waiting Chats and turn results, and open the right Chat from the alert.

**Architecture:** The daemon persists registrations and consumes core events. A bounded Expo sender delivers notifications and checks receipts. Mobile owns opt-in settings, permission/token lifecycle, focus leases and validated navigation.

**Tech Stack:** Node 24, Expo SDK 57, expo-notifications, Expo Push Service, existing authenticated HTTP bridge.

**Spec:** https://github.com/marcosgenesis/milagre-ade/issues/159

## Global Constraints

- Preserve desktop notification behavior, single-runtime ownership and existing bridge authentication.
- Native APIs follow the versioned Expo 57 documentation; do not hand-edit generated native projects.
- Credentials never enter push payloads or logs. Registry files are atomically written with mode 0600.
- Notifications are best effort; agent turns never wait for delivery. Cancellation never alerts.
- PR screenshots come from a real native run and live only on the screenshots branch.

## Review Focus

- Late registration/unregister writes or reset must not revive an old token or send queued notifications to it.
- A focus lease must expire after suspension and be specific to one device, computer and Chat.
- Duplicate/resolved requests and duplicate terminal events must not produce extra alerts.
- Cold start, concurrent notification taps and later user navigation must not restore stale selection.
- Offline Forget must retain a private unregister retry without keeping a forgotten computer available for navigation.

### Task 1: Daemon notification service and transport

**Files:** create `apps/daemon/src/mobile-push.cjs`, `apps/daemon/src/expo-push.cjs` and matching tests; modify `server.cjs`, `phone.cjs`, `mobile-bridge.cjs` and their tests.

**Interfaces:** `createMobilePush({dataDir, send, context, now, onError})` produces `load/register/unregister/focus/observe/clear/close`. RPC names are `push:register`, `push:unregister`, `push:focus`. Register takes `{deviceId, token, hostId, notifyWhenWaiting, notifyOnCompletion}`; focus takes `{deviceId, chatId}` and expires after 15 seconds. Sender takes `(message, isCurrent)` and produces a delivery promise; receipt invalidation removes only the matching token generation.

- [ ] Write and run failing tests for event parity, duplicate/resolved events, stale focus, device-specific preferences, persistence, invalid registration, reset and rotation.
- [ ] Implement atomic registry persistence, capped desktop-like payloads and event tracking.
- [ ] Write and run failing sender tests for retries/timeouts, invalid tokens, receipts and stale queued messages.
- [ ] Implement a bounded sender using only the fixed Expo HTTPS endpoints; keep queue and retries out of the event loop's agent path.
- [ ] Add real socket/HTTP tests for authenticated registration and daemon-originated delivery after clients disconnect; wire reset/disable cleanup.
- [ ] Run `npm run test:daemon` and commit the backend.

### Task 2: Mobile settings and notification lifecycle

**Files:** create `apps/mobile/src/push-store.ts`, `push-controller.ts`, `push-native.ts`, `push.tsx`, `app/notifications.tsx` and tests; modify root layout, Computers, Chat and session integration; install SDK-compatible expo-notifications, expo-device and expo-crypto.

**Interfaces:** durable secure settings hold installation ID, enabled flags and pending unregisters. Controller registers saved hosts using Task 1 RPCs, reports viewed Chat every 10 seconds while foreground, unregisters when disabled/forgotten and validates notification targets against saved hosts. Root push provider exposes settings/status/actions and validated navigation; session exposes a current navigation generation.

- [ ] Write and run failing tests for secure persistence, permissions, token rotation, unregister retries, foreground suppression, unknown targets and tap races.
- [ ] Implement pure storage/controller helpers and native adapter following SDK 57 docs.
- [ ] Add Notifications controls with shared native UI primitives, permission/setup errors and a link from Computers; tap handling reconnects then opens the current Project/Chat.
- [ ] Run mobile tests, lint, typecheck and iOS export; commit the client.

### Task 3: Native verification, review and PR

**Files:** update `docs/mobile-local.md`; add reproducible checks when needed. Images stay outside this branch.

- [ ] Run daemon/mobile/shared/core/desktop checks and desktop build. Record credential/device validation limits.
- [ ] Run the native app in a dedicated simulator; verify Notifications states, permission/disabled flows and target navigation. Capture real screenshots outside the repository.
- [ ] Dispatch one independent whole-branch reviewer. Address important findings with failing regression tests and rerun affected suites.
- [ ] Push images to an isolated screenshots worktree; reference their exact commit in the PR body.
- [ ] Restore the pre-existing lockfile edits, push the feature branch and create the PR. Check CI and report its URL plus any live-delivery prerequisites.
