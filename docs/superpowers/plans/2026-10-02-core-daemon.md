# Shared runtime and local daemon implementation plan

> **For agentic workers:** Use superpowers:executing-plans task by task. The user authorized the next phase and draft PRs; execute within this scope without repeating approval gates.

**Goal:** Run the existing Chat runtime in plain Node while preserving the desktop.

**Architecture:** Extract `@milagre/core` and inject host adapters. Desktop embeds it. An opt-in daemon serves the same commands and events over a private Unix socket. Both hosts acquire exclusive ownership before accessing persistent state.

**Tech Stack:** Existing Node 24+, npm workspaces, CJS, Electron and built-in Node sockets/tests. No new external dependencies.

**Spec:** [GitHub issue #127](https://github.com/marcosgenesis/milagre-ade/issues/127). The issue is the domain spec; this file records execution.

## Global constraints

- Preserve app identity, root scripts, update feed, stored Chat/provider identifiers, data formats and desktop userData paths.
- Keep desktop lifecycle unchanged. No remote listener, desktop transport switch, relay, mobile app or production daemon service in this phase.
- Daemon requires an explicit absolute data directory; tests use temporary Projects and deterministic provider fakes.
- Never silently remove another owner's lock. Fail closed after crashes and document recovery. Older app versions cannot honor the new locks.
- Keep PR #126 separate. Work on `milagre/extract-core-daemon-6edu`, stacked on the migration.

## Review focus

- Packaged core must resolve the SDK, YAML and unpacked skill resources without checkout paths.
- Shutdown and concurrent Project opens must not release ownership while a state write or command can still run.
- Real-path aliases must not permit competing writers; locks must not modify existing Chat data on failed acquisition.
- Client loss must retain running turns and pending approvals, with bounded socket buffering and explicit protocol errors.
- Desktop-only APIs must stay off the Node import graph; old IPC signatures and event payloads must remain compatible.

## Task 1: Extract the runtime and keep the desktop adapter

**Files:** `packages/core/**`, `apps/desktop/electron/main.cjs`, workspace manifests/lockfile, fixture imports and packaging config.

**Interfaces:** `createRuntime({ dataDir, version, cwd, emit, isFocused, keepAwake, environmentReady, createSession, agentCli, titleModels })` exposes `methods`, `invoke(method, args)`, `openProject(path)`, `resumeRecentProjects()`, `focused()`, `close()` and `environmentReady`. Existing method names and payloads stay intact. Host-specific callbacks receive observed agent events and waiting notices.

- [x] Write runtime integration tests for saved Chat/provider IDs, command dispatch, event/state changes and restart using temporary Projects. Run before extraction; expect missing core runtime.
- [x] Move Node modules and their tests/resources into core. Keep desktop-only adapters in Electron. Extract the composition root into the factory, inject version/data directory/host actions, and route old IPC through it.
- [x] Update imports, npm scripts, dependencies and asar unpacking. Run build, typecheck, agent/UI/release/monorepo tests and real desktop smoke. Expected: all pass with original behavior.
- [x] Commit the extraction.

## Task 2: Add ownership and a local daemon

**Files:** core ownership/runtime tests, `apps/daemon/**`, root scripts, ADR and daemon usage docs.

**Interfaces:** an exclusive lock retains an owner record until clean close. Daemon `serve --data-dir <absolute>` owns the runtime; `status`, `request <method> [JSON args]` and `stop` use its private socket. Protocol version 1 requests carry id/method/args; responses carry id/result or error; events carry channel/payload. No client disconnect invokes runtime close.

- [ ] Write failing tests for duplicate ownership, path aliases, lock retention after crashes, independent clients, errors, version mismatch, frame limits, disconnect/reconnect with a pending permission and graceful stop. Expected: missing ownership/daemon APIs.
- [ ] Implement locks, closing guards and command draining; private socket server/client and CLI with bounded buffering. Preserve existing recovery semantics and fail closed on stale ownership.
- [ ] Run focused tests and full agent suite. Expected: all pass without provider credentials or Electron.
- [ ] Document the refined ADR-0001 ownership, opt-in commands, platform/sleep limitations and crash recovery. Commit.

## Task 3: Verify packaging and publish the stacked draft

**Files:** affected Electron fixtures, packaging smoke, CI, README/CONTRIBUTING, this plan's verification record.

- [ ] Run clean install, build/typecheck, complete test suites and all existing Electron fixtures. Expected: no lost test coverage or behavior.
- [ ] Build the local Mac app, verify signature and archives, inspect core/skills/dependencies, and run the source/packaged saved-state smoke. Expected: retained identity and data compatibility.
- [ ] Run the CLI in a real temporary process through serve/status/request/stop. Expected: socket, locks and child process clean up after stop.
- [ ] Get one independent whole-branch review, resolve important findings with reproducing tests, commit, push and open a separate stacked draft PR. Check CI and record remaining release-only validation.
