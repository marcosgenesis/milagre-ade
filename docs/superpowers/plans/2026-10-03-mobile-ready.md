# Usable mobile agent workflows

> Execute inline with superpowers:executing-plans. The user authorized continued overnight app work and draft PR updates with screenshots. This milestone takes priority over the queued audit. One fresh independent review follows the whole increment.

**Goal:** A functioning mobile app using real Milagre providers and existing agent workflows, ready to try in the morning.

**Spec:** https://github.com/marcosgenesis/milagre-ade/issues/138

**Base:** f9680b1, draft #137 on #131 on #126. Continue the mobile draft in the existing isolated worktree.

**Architecture:** Native Expo client, persistent separate daemon profile and token-protected loopback bridge. HTTPS endpoints can forward to that bridge through a separately configured TLS proxy/tunnel. Core remains the single writer. Platform secure storage holds the connection. Existing core commands supply models, Chats, Worktrees and changes.

## Constraints and review focus

- Preserve desktop identity, stored state and external dependency versions. Do not open the active development Project in a test host.
- Accept HTTPS remote origins or the existing loopback emulator HTTP origins; reject credentials, paths and plaintext remote origins. Tokens never enter logs, committed files or production bundle defaults. Forget deletes secure storage. Do not automatically replay mutations.
- No relay cryptography, new provider, voice, schedule, App Store submission, account creation or infrastructure purchase. A TLS tunnel is not end-to-end encrypted like the Paseo relay; document its trust boundary.
- Worktree mutations retain ownership and Delegation rules. Support the existing creation flow; do not expose Worktree removal.
- Async state cannot restore an old connection/Project or lose a draft. Saving/forgetting a connection must handle concurrent completion. Model capabilities drive effort and fast mode. Provider failures remain actionable.
- Keep screenshots current after visible changes, on the separate screenshots branch. Preserve audit Tasks 1, 2, then 3 and Claude Fable 5.1 handback as the next queued work.

## Task 1: Saved connections and HTTPS transport

Files: mobile client/tests, connection storage module/tests, session/connect UI, Expo config/dependency; daemon bridge tests and real-host launcher.

- [ ] Write failing tests for HTTPS validation, redirect/auth behavior, private connection-file reuse and secure-store save/load/forget ordering.
- [ ] Add Expo SecureStore, a remembered connection with explicit Forget, and HTTPS endpoint support. Keep tokens out of ordinary storage. Preserve manual reconnect and drafts.
- [ ] Add `mobile:host` using a separate persistent profile, private stable token file, optional absolute Project and clean shutdown. Existing daemon and bridge CLIs remain compatible. Keep loopback binding and explicit Host checks; document TLS proxy Host rewrite.
- [ ] Run mobile/daemon tests, typecheck, lint and real local startup/stop. Commit.

## Task 2: Existing Milagre controls on mobile

Files: mobile routes, shared native controls, composer/model helpers/tests; bridge allowlist tests.

- [ ] Add reported provider readiness/models/capabilities, effort and fast-mode controls and permission selection. Test payloads and unsupported option normalization.
- [ ] Group Chats by Worktree; support archived Chats, rename/archive, new Worktree and Chat in selected Worktree. Use existing core commands; test allowed/rejected RPC and asynchronous form behavior.
- [ ] Add changes list and readable per-file diff using existing read-only Git commands. Handle binary/large files and stale async results. Retain drafts across route changes and errors.
- [ ] Run mobile/daemon and root suites, then real simulator flows. Commit.

## Task 3: Real-provider, remote and standalone simulator validation

Files: real-provider opt-in smoke script, run docs, verification record and fixes.

- [ ] Verify installed Codex and Claude through the real mobile HTTP/socket/core path in an isolated Project. Test reconnect/restart and preserve stored Chat/provider IDs.
- [ ] Validate HTTPS using an available configured tunnel with only temporary test data, authentication checks and request inspection disabled. Stop the test tunnel afterward. If unavailable, record the exact setup requirement without weakening authentication.
- [ ] Build/install a standalone iOS simulator app with the available Xcode toolchain and verify saved connection, new Chat/reply, model settings, Worktrees/changes, approval/question/Stop and app restart. Keep Expo Go as a fallback if a concrete toolchain constraint blocks the build.
- [ ] Run root compatibility checks and packaging checks affected by dependency/config changes. One independent review, one RED-to-GREEN fix pass, update #137 and screenshot links, sync the draft stack and check CI.
- [ ] Leave a persistent real-host test Project and working simulator app, with exact start/stop instructions and limits. Stop only this session's simulator automation services.

## Rulings

The user's overnight request authorizes extending the working simulator slice without repeated design or publication approval. Continue the same mobile draft to avoid a chain of app-only PRs. Remote transport uses TLS through an existing configured tool rather than inventing a relay; this makes an internet path testable while retaining the documented third-party TLS trust boundary. Real provider checks use short no-tool prompts in isolated Projects. The existing desktop still embeds core, so opening its live Projects in the mobile daemon remains unsupported until desktop attaches to the daemon.
