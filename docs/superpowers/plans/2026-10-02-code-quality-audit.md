# Code quality audit: findings and remediation plan

> **For agentic workers:** Use superpowers:executing-plans task by task. Each task is one PR. Base every task on the monorepo layout (PR #126, then the core extraction from issue #127), never on today's flat tree. When the work is done, hand it back as described in **Handback**.

**Goal:** Remove the duplication and the hot paths found in the 2026-10-02 audit without changing behavior, so the daemon and mobile phases start from modules that are deep, tested and owned by one package.

**Audit date:** 2026-10-02, on main at `419730a` (#124), by Claude (Fable 5.1). Five sweeps: main-process performance, renderer performance, maintainability and tests, DRY (with `jscpd`), Clean Code smells, module depth. Every finding below was verified by reading the code; counts come from grep or the detector.

**Already shipped:** PR #128 (`84c54cc`): `lib/modal.ts` as the one place that decides whether a modal is open (fixes dead ⌘K/⌘N/⌘F while an approval or question card showed), plus a stable `onUpdateCli` so finished message cards stay out of the typing render path.

**In flight, owned by the Codex session:** PR #126 (npm workspaces: `apps/desktop`, `packages/shared`) and issue #127 (`@milagre/core` with `createRuntime`, ownership lock, local daemon). Victor decided on 2026-10-02: monorepo first, then these refactors.

## Path map

File references below use today's main. After #126 and #127 Task 1 they live at:

| Today | After |
| --- | --- |
| `app/src/**` | `apps/desktop/app/src/**` |
| `electron/main.cjs`, `preload.cjs`, desktop-only adapters | `apps/desktop/electron/**` |
| `electron/*.cjs`, `electron/agents/**` (Node runtime) | `packages/core/src/**` |
| `electron/shared/*.mjs`, `app/src/model.ts` | `packages/shared/src/**` (`@milagre/shared/*`) |
| `scripts/test-*.cjs` | unchanged |

## Global constraints

- Behavior-preserving. No feature changes, no dependency upgrades, no data-format changes except where a task says so (Task 3 images).
- TDD: a failing test first for every change, including a source guard test (the pattern of `no-native-select.test.ts`) wherever a task introduces a primitive that must be the only way to do something.
- ADR-0001 holds: main (soon `@milagre/core`) is the only writer of Chat state. ADR-0002 holds: a GitClient keeps reads separate from writes.
- One concern per PR, conventional commit titles, screenshots on the `screenshots` branch when anything visible changes (AGENTS.md).
- Never edit another session's worktree. Coordinate through PRs and this document.
- Verify with `npm run typecheck`, `npm run test:agent`, `npm run test:ui`, `npm run test:release` and every `scripts/test-*.cjs` (all 21 pass on main today, about 80 s in sequence).

## Handback

When the tasks you took are merged, or you stop:

1. Open a new Milagre chat in a **new worktree** (not the one this plan was executed in), with Claude, model Fable 5.1.
2. First message: "Code quality audit handback. Plan: `docs/superpowers/plans/2026-10-02-code-quality-audit.md`." Then the list of PRs with numbers, which tasks they cover, what was skipped and why, and any finding you believe is wrong.
3. Claude reviews against the acceptance lines of each task and the appendices, and closes the loop with Victor.

## Task order

1. Task 1 GitClient and Task 2 shared contract are independent of each other; both are the smallest high-value PRs. Start there.
2. Task 3 (state as the unit of change) is the largest performance win; it touches `ChatHost` and `ProjectStates`, so land it after #127 Task 1 (the `createRuntime` extraction) to avoid a second move.
3. Task 4 renderer quick wins can go any time after #126.
4. Task 5 ChatStore needs a design conversation first (see the task). Do not start it cold.
5. Tasks 6 to 9 are cleanup; take them when a feature PR touches the area, or as filler.

---

## Task 1: One GitClient in `@milagre/core`

**Strength:** Strong. The only candidate where duplication already produced a correctness gap.

**Files:** `electron/git-actions.cjs`, `git-diff.cjs`, `diffstat.cjs`, `worktrees.cjs`, `worktree-cleanup.cjs`, `worktree-files.cjs`, `project-files.cjs`, `project-image.cjs`, `pull-request.cjs`, `editors.cjs:99`, `main.cjs:103,459,482`, `git-ipc.cjs`.

**Evidence:**
- Nine git runners across 13 spawn sites. Timeouts: none, 3 s, 5 s, 10 s, 15 s, 20 s, 30 s, 5 min. `diffstat.cjs:18`, `main.cjs:103` and `worktrees.cjs:13` have none. Buffers: 64 KB, 1 MB, 16 MB, 32 MB, 256 MB.
- The env that stops git prompting for credentials is set in 3 of 9 (`git-actions.cjs:80`, `git-diff.cjs:29`, `worktrees.cjs:22`).
- `resolveBase` is copied verbatim at `git-actions.cjs:172` and `git-diff.cjs:51` ("Same rules as git-actions"); only the git-diff copy rejects refs starting with `-`.
- `refExists` exists 4 times (`git-actions:143`, `git-diff:48`, `diffstat:22`, `worktree-cleanup:28`); only the last passes `--end-of-options`.
- `diffstat.cjs:35 diffBase` picks the base by a third rule (upstream, then `origin/HEAD`, then `HEAD`), so the sidebar hover card and the Changes panel can measure the same Worktree against different bases.
- `git worktree list --porcelain` is parsed in `main.cjs:101` and `worktree-cleanup.cjs:82`.
- `knownFolders` (`main.cjs:482`) runs `git worktree list` for every open Project on every git IPC call, including each patch load in `useDiffFiles` (up to 4 in flight).
- Error shapes: `{ ok, kind, message }` (git-actions, git-diff), `Error(stderr)` (worktrees, cleanup), raw throw (diffstat).

**Steps:**
- [x] Write failing tests for `createGit({ execFile, env })`: `run` with named limit profiles (`READ` about 10 s / 16 MB, `NETWORK` about 30 s, `REMOVE` about 5 min), the no-prompt env always set, one error shape, `refExists` with `--end-of-options`, `resolveBase` with the leading-`-` guard, `worktreeList`, `commonDir`.
- [x] Implement `packages/core/src/git/client.cjs`. Pure, injected `execFile`, no Electron imports.
- [x] Move the six git modules onto it one at a time, deleting their private runners, `refExists` and `resolveBase` copies. Decide with Victor whether `diffstat` keeps its different base rule; if not, it uses `resolveBase` too.
- [x] Replace `knownFolders`' git spawn with the Worktrees already in `ProjectStates` (or a cache cleared in `readProject`).
- [x] Guard test: no file outside `git/` calls `execFile("git", ...)` or `promisify(execFile)` for git.

**Acceptance:** one runner, one base rule, one error shape; `test:agent` and the diff and sidebar Electron checks pass; the no-prompt env is present on every git spawn (assert in the test by inspecting the injected `execFile` calls).

**ADR note:** keep write operations (`commit`, `push`, `worktree remove`) on a separate surface from reads so a future read-only `linked_git` tool (spec 003) cannot write.

---

## Task 2: One shared contract in `@milagre/shared`

**Strength:** Strong. Half done by #126 (the `.d.mts` files no longer import from the renderer).

**Files:** `app/src/model.ts`, `app/src/electron.d.ts`, `electron/preload.cjs`, `lib/git-dialog.ts:84-87`, `git-actions.cjs:10-15`, `usePastedImages.ts:5-7,48-50`, `image-input.cjs:1-9`, `lib/handover.ts:6`, `usage/format.ts:8`, `agents/handover.cjs:20`, `shared/attention.mjs:5`, `agents/events.cjs:47`, `shared/agent-runs.mjs:71`, `agents/events.cjs:114`, `useWorktreePullRequests.ts:63`, `useChanges.ts:32`.

**Evidence:**
- Image limits (4 images, 5 MB, allowed types, 3 error strings) are written on both sides of the bridge.
- Git blocker codes `NO_ORIGIN`, `DETACHED`, `DETACHED_COMMIT`, `GH_MISSING` are defined identically in `lib/git-dialog.ts` and `git-actions.cjs`; `WORKTREE_CHANGED` is detected by `raw.includes(...)` (`archive.ts:88`).
- Provider display names live in 5 tables plus 13 inline `=== "codex" ? "Codex" : "Claude..."` ternaries, spelled "Claude" in some and "Claude Code" in others (`App.tsx:162-167`, `Settings.tsx:109`, `ChatComposer.tsx:145,148`, `PromptComposer.tsx:363,387`). The provider order list exists 5 times.
- The turn-end predicate exists 4 times: `isTurnEnd` (shared), `isTerminal` (events.cjs), inline in two hooks.
- Five error conventions cross the bridge: `{ ok, kind, message }`, `{ ok, error }`, `null` on failure, `null` on success with an error string otherwise (`editor:open`), and throwing. About 81 call sites swallow the result (53 `.catch(() => {})`, 13 `.then(_, () => {})`, 15 empty `catch {}`). Rename, mark unread and archive-subagent fail silently (`App.tsx:347-359`).
- The "Error invoking remote method" regex is copied 6 times under 4 names.
- `model.ts` mixes wire types, UI copy (`PERMISSION_MODES` descriptions, `EFFORT_COPY`), the model catalog, and dead spec-001 fields (`Connection`, `Event`, `approvals`, `artifacts`, `outputs`, `conflicts`).
- The `AgentEvent` union is typed in `model.ts:342` and documented as a comment in `events.cjs:1-40` that already misses four event types; the `quit` flag `chat-host.cjs:61` adds is not in the type.

**Steps:**
- [x] `packages/shared/src/providers.mjs` (+ `.d.mts`): `PROVIDERS`, `providerName(p)` ("Claude"), `cliName(p)` ("Claude Code"). Replace the 5 tables and 13 ternaries. Keep the unit tests that assert "Claude Code" messages passing.
- [x] `packages/shared/src/limits.mjs`: image limits and messages; both `usePastedImages` and `image-input` read them.
- [x] `packages/shared/src/git-codes.mjs`: blocker codes; `git-actions` returns codes, the dialog maps codes to copy.
- [x] Export `isTurnEnd` once; `events.cjs` re-exports it; delete the two inline copies.
- [x] One `Result<T, { code, message }>` type and one `ipcErrorMessage()`; migrate handlers one per PR if needed, starting with `editor:open` (its null-means-success is the most surprising).
- [x] Move UI copy and `MODEL_CATALOG` out of `model.ts` into `apps/desktop/app/src/lib/`; delete the dead spec-001 fields from the type and from `emptyState` (keep tolerating them on read).
- [x] Add `// @ts-check` to `apps/desktop/electron/main.cjs` and `preload.cjs` with a `tsconfig.electron.json` (`checkJs`); fix what it finds.
- [x] Guard test: no `=== "codex" ? "` ternary outside `providers.mjs`; no `Error invoking remote method` regex outside the helper.

**Acceptance:** a limit, a code or a name changes in one file; `tsc` covers main and preload; the swallowed-error count drops and the three silent chat actions surface a notice on failure.

---

## Task 3: The Project state stops being the unit of change

**Strength:** Strong. The biggest performance finding. Land after #127 Task 1 so it is done once, in `@milagre/core`.

**Files:** `electron/shared/agent-runs.mjs:183-197`, `electron/agents/chat-host.cjs:59-80`, `electron/project-states.cjs:35-58`, `electron/project-store.cjs`, `electron/main.cjs:137-150,385`, `electron/agents/subagents.cjs`, `electron/agents/codex-provider.cjs:263-315`, `app/src/App.tsx:306-309`.

**Evidence:**
- Every `subagent-update` returns `changed: true` (a new `updatedAt` each time), so each one runs `JSON.stringify(state, null, 2)` for the whole Project to disk and sends the full state to every window. A Claude subagent emits one per content block, tool result and progress note; a 50-tool-call subagent means about 100 full saves and broadcasts in one turn.
- Pasted images are stored as base64 inside the state (`chat-host.cjs:157`). The file for the `agent-sessions-pr2` Project is 4.9 MB; the `milagre-ade` one is 224 KB for 28 messages, 70 KB of it one screenshot.
- `project-states.cjs:45` awaits the disk write inside the per-project queue and `chat-host.cjs:73` publishes only after it resolves, so a slow save in one Chat stalls the 50 ms text batches of every other Chat in the same Project.
- `project-store.cjs` keeps a second per-project queue that `ProjectStates` makes redundant; `savesSettled` is used only by its own test; `project-state.cjs:65` stringifies the full state twice on every read.
- Codex subagent polling (`codex-provider.cjs:263-315`) calls `thread/read` with full history every 1.5 s per child and stringifies all turns twice for a fingerprint.
- In the renderer, `receiveState` (`App.tsx:306`) swaps in the whole object, so every message and step gets a new identity and every `MessageSection` memo misses.
- Related, lower: `diff-refresh.cjs:35-39` refreshes every Worktree of every read Project on window focus with no concurrency cap and 4 to 7 git spawns each; `ports.cjs:201-221` runs `ps -axo` every 3 s for ten minutes after the last turn.

**Steps:**
- [x] Failing test: a `subagent-update` must not call `save`; the agent's transcript is still visible to a window that connects later (served from memory like `runs`).
- [x] Keep subagent transcripts in memory; persist a compact summary at turn end only. Publish just the changed agent to windows.
- [x] Failing test: an image attached to a message is stored under `<project>/.milagre/images/<id>.<ext>` and the message carries a path; old messages with `dataUrl` still render.
- [x] Write-behind saves: update memory synchronously, save on a trailing debounce (about 250 ms), keep `flush()` for quit. Drop the `null, 2` indent. Delete `project-store`'s queue and `savesSettled`.
- [x] Renderer: reconcile incoming state against the previous one by message id so unchanged messages keep their identity (or send deltas).
- [x] Codex polling: page with `thread/turns/list` from the last seen turn; compare item ids, not JSON.
- [x] Diff refresh: cap concurrency at 4, refresh only the Project on screen on focus, ignore `kind: "thinking"` steps. Ports: back off to 15 s when no turn runs.

**Acceptance:** a streaming turn with an active subagent writes the state file at most once per 250 ms; a 4.9 MB Project file shrinks to its text; a token batch in Chat A is not delayed by a save in Chat B (test with an injected slow `save`).

---

## Task 4: Renderer render-path quick wins

**Strength:** Strong, small. Each item is a few lines.

**Files:** `app/src/App.tsx`, `lib/agent-runs.ts`, `useWorktreePullRequests.ts`, `SidebarNav.tsx`, `sidebar/ChatRow.tsx`, `agents/message-scroller.tsx`, `ThinkingIndicator.tsx`, `ChatComposer.tsx`, `motion/PreviewRail.tsx`.

**Evidence (per keystroke or per 50 ms streamed batch):**
- `chatsRunning` returns a new `Set` each call, so the `chats` memo (`App.tsx:314-343`) recomputes on every batch: it filters every message once per session, sorts, and runs `pullRequestRefs` regexes over every saved shell step in the Project.
- `pathsKey` (`useWorktreePullRequests.ts:25`) flatMaps all messages, builds a Set, sorts and stringifies on every App render, unmemoized.
- The composer draft lives in App (`App.tsx:96`), so each keystroke re-renders the sidebar, the transcript, the preview rail and rebuilds the `commands` array (`App.tsx:770`).
- `ChatRow` is not memoized; `chatActions` is a new object each render; `onPick` is an inline closure.
- The navigation rail's `MutationObserver` (`message-scroller.tsx:301`) rescans every message's `textContent` on any DOM change, and `ThinkingIndicator` ticks every 100 ms inside that subtree, so the rescan runs ten times a second for the whole turn.
- The streaming reply is re-parsed in full by react-markdown on every batch (`ChatComposer.tsx:74`), O(n²) over a turn; the growing code block is re-tokenized synchronously up to 40k characters.
- `PreviewRail` renders one `motion.span` per message with a new `animate` object per render.
- Nothing is virtualized; `content-visibility: auto` on message articles and diff file sections is the cheap fix.

**Steps:**
- [ ] Return the previous `Set` from `chatsRunning`/`chatsWaitingForUser`/`chatsAskingUser` when members are unchanged; group messages by session once per `state`.
- [ ] `useMemo` for `pathsKey`.
- [ ] Move the draft into `PromptComposer` (or a tiny external store) and read it on send.
- [ ] `memo(ChatRow)`, stable `chatActions` via refs, `onPick(id)`.
- [ ] Render the elapsed timer outside the observed subtree (or write its text through a ref); resync the rail on `childList` changes only and cache previews for finished messages.
- [ ] Split the streaming answer at top-level block boundaries outside fences; memoize finished blocks; lower the highlight cap while streaming.
- [ ] `content-visibility: auto` with `contain-intrinsic-size` on message articles and diff sections.

**Acceptance:** with React DevTools' highlight-updates on, typing in the composer re-renders the composer only; a streaming batch re-renders the streaming section and the sidebar row of that Chat only.

---

## Task 5: A ChatStore in the renderer

**Strength:** Strong, but design first. Hold a grilling session (superpowers:brainstorming or /grilling) with Claude before writing code; record the agreed interface in `docs/superpowers/specs/`.

**Files:** `app/src/App.tsx`, `components/useAgentRuns.ts`, `lib/agent-runs.ts`, `lib/archive-flow.ts`, `components/changes/useChanges.ts`, `components/useWorktreePullRequests.ts`.

**Evidence:**
- App has 31 `useState`, 10 `useRef`, 23 `useEffect`, 39 direct `window.milagre` calls; `chatKey(project.path, selectedSession.id)` is rebuilt 14 times; `messages.filter(m => m.session_id === id)` 9 times across the tree.
- Project states arrive by three paths (`adoptProject`, `onProjectState`, the `onState` callback from agent events). The selection is set in 15 places with 5 guards against the Project changing underneath.
- `useAgentRuns` needs two callbacks back into App (`onState`, `modelFor`) because it cannot see the states; `archive-flow` takes 12 inputs (10 callbacks) because nothing repairs the selection against the latest state.
- A text delta reaches 4 separate renderer subscribers (`useAgentRuns`, `App.tsx:462`, `useChanges`, `useWorktreePullRequests`), three of which write their own "did the turn end" check.
- A Chat has three names: `AgentSession` (type), `sessionId` (number), `chatId` (string key). Five IPC handlers take `(projectPath, sessionId)` and seven take the key.

**Shape to discuss, not decided:** one module owns every Project's state, the runs (sequence dedupe and optimistic answers included), the selection repaired against the latest state, the per-chat marks, one subscription point, and the chat commands (send, interrupt, answer). It stays a read-only projection of core (ADR-0001). Design it so a mobile client can host the same store over the daemon's event feed. Rename on the way: `chatId` → `chatKey`, `sessionId` → `chatId`, `AgentSession` → `Chat`, `SidebarRecent` → `ChatListItem`; `ChatComposer` → `ChatView` with grouped props (it forwards 26 of 59 props unchanged to `PromptComposer`).

**Acceptance:** App.tsx holds layout, shortcuts and dialogs only; the store has `node:test` coverage with a fake event feed and no Electron; `archive-flow` loses `applyRemoval`, `currentProjectPath` and `getState`.

---

## Task 6: Renderer primitives and the shortcut table

**Strength:** Worth exploring. Each primitive is small; the value is in the guard tests.

**Files:** `Select.tsx:70-96`, `ChatRow.tsx:572-590,644-658`, `SidebarNav.tsx:247-260,424-434,466-477`, `PromptComposer.tsx:206-218,284-295`, `ChatComposer.tsx:266-273`, `useAnchoredPopover.ts:33-49`, `GitActionsDialog.tsx:261-286`, `Handover.tsx:109-144`, `FindBar.tsx:131-139`, `CommandPalette.tsx:86-88`, `shortcut-hints.ts`, 11 `Icon` wrappers, `App.tsx:98-103`, `SidebarNav.tsx:116-123`, `DiffView.tsx:14-23`, `useDiffComments.ts:8-24`, `useWorktreePullRequests.ts:8-20`.

**Evidence:**
- Popover dismissal (outside click and Escape) is hand-rolled 5 times plus the hook; copies differ in capture vs bubble, `ref.contains` vs `closest()`, and whether Escape is handled on the window or the element. The element ones let Escape reach App, which stops the running turn, whenever focus is outside the popover.
- Menu keyboard navigation (`moveFocus`) is identical in `WorkspaceMenu` and `ChatMenu`; ChatRow's first-row focus lacks `:not(:disabled)`.
- The dialog focus trap and Escape handling are copied between `GitActionsDialog` and `Handover`.
- Five global keydown listeners; shortcut labels written in 7 tooltips and the palette, which parses the label back into a key; Mac detection 4 times (one exported helper unused by the other three).
- `localStorage`: 9 keys under 3 prefixes (`milagre-`, `milagre.`, `milagre:`); effort, ultracode and fast mode bypass `lib/settings` and its try/catch, each with its own "on"/"off" encoding.
- `Icon`/`IconData` redefined in 11 files with 4 default sizes; the `pop-in 180ms ...` animation string inlined in 6 files; `cubic-bezier(0.16, 1, 0.3, 1)` inlined 3 times although `ease.ts` exports it.
- Two components named `Notice` (a toast in `editor-links.tsx`, a card in `Notice.tsx`), aliased on import in App.

**Steps:**
- [ ] `useDismiss({ open, onDismiss, inside, escape })`; `useAnchoredPopover` uses it; migrate the 5 copies; guard test against `addEventListener("mousedown"|"pointerdown"` outside it.
- [ ] `useMenuKeys(menuRef, onClose)` or a `<ContextMenu>` primitive; `useDialog(panelRef, onClose)` for the trap.
- [ ] `SHORTCUTS` table with `matchShortcut`, `shortcutLabel`; one window listener; tooltips and the palette read labels from it. `lib/modal.ts` (already landed) stays the only modal check.
- [ ] `primitives/Icon.tsx`; motion tokens in `ease.ts` or CSS variables; guard tests like `no-native-select.test.ts`.
- [ ] `lib/storage.ts` owning the key prefix and safe read/write; fold effort, ultracode and fastMode into `AppSettings` with a migration like `LEGACY_THEME_KEY`. Keep the raw keys the Electron checks assert (`test-sidebar-resize:55,75`, `test-diff-view:155`, `test-sidebar-pr:120`) or update those checks in the same PR.
- [ ] Rename the toast to `Toast` and the card to `NoticeCard`; name the two durations.

**Acceptance:** Escape precedence is decided in one place; about 250 lines deleted across 10 files; each primitive has a guard test.

---

## Task 7: Write down the provider session seam

**Strength:** Strong. Coordinate with #127: the daemon plan injects `createSession`; this task gives it a written contract.

**Files:** `electron/agents/session-manager.cjs`, `claude-provider.cjs`, `codex-provider.cjs`, `events.cjs`, the FakeSessions in `session-manager.test.cjs:6` and `chat-host.test.cjs:9`, `git-text.cjs:188`, `worktree-name.cjs:32`, `handover.cjs:100`, `chat-title.cjs:69`, `usage.cjs:176-242`.

**Evidence:**
- The interface both adapters satisfy is written nowhere: constructor `{ cwd, resumeId, command, emit, tldrEnabled }`, `startTurn` → `{ turnId, steered }`, `interrupt`, `respondToPermission`, `answerQuestion`, `setPermissionMode`, `close`, the `closed`/`turnActive`/`nativeId`/`pid` fields, and the `error.sessionClosed` retry contract.
- The two FakeSessions implement different subsets (8 methods vs 4).
- Drift: `sessionClosedError` copied verbatim (`claude-provider:54`, `codex-provider:55`); Claude checks `closed` at the top of `startTurn` (line 86), Codex does not; `markEnded` vs `markTurnEnded`; sync vs async `finishTurn`.
- The one-shot Claude SDK call config is copied in `git-text.cjs` and `worktree-name.cjs`; the `createXModels({ cli, clientVersion })` factory is copied in `handover.cjs` and `chat-title.cjs`.
- The Codex app-server handshake (initialize, initialized, `account/read`) is written 5 times; `usage.cjs` hand-rolls its own JSON-RPC line reader and spawns bare `codex` from PATH instead of the command `agentCli` resolves.

**Steps:**
- [ ] `packages/core/src/agents/agent-session.d.mts` (or JSDoc typedef) with the contract above; one `FakeSession` in `test-helpers.cjs` used by every test.
- [ ] A conformance suite that runs against Claude, Codex and the fake (start, steer, interrupt, close, closed-session retry).
- [ ] Extract the shared turn-lifecycle core (turn ready/ended plumbing, steer-cancel path, interrupt grace timer, `finishTurn`, settle subagents) with provider I/O hooks. Optional; do it only if the conformance suite shows the drift matters.
- [ ] `openCodex({ command, cwd })` on top of `CodexRpc`; `usage.cjs` uses it with `agentCli("codex")`. One `oneShotClaude({ system, prompt })` for naming and git text.

**Acceptance:** the contract file exists and both providers typecheck against it under `checkJs`; one fake; the conformance suite passes for all three.

---

## Task 8: One UI-check harness, and the checks in CI

**Strength:** Worth exploring. 110 of the 121 `jscpd` clones are here.

**Files:** `scripts/test-*.cjs` (21 files, 4,099 lines), `.github/workflows/ci.yml`, `package.json` scripts.

**Evidence:**
- About 1,100 lines (27%) are harness: the Vite fixture server, Electron spawn and exit tail (758 lines measured), `waitFor` in 20 scripts, a screenshot helper in about 16, the BrowserWindow preamble in all 21. Fixtures are JSX in template strings, untyped. 9 scripts hand-write their own `window.milagre` stub, 5 behind a Proxy that answers any unknown method with null.
- Six scripts write screenshots to `/tmp` unconditionally (`chat-layout:99`, `chat-attachments:204`, `command-palette:65,158,165`, `diff-view:91`, `sidebar-pr:103,113,151,198`, `sidebar-resize:50`), against AGENTS.md.
- CI runs `test:agent` and `test:release` only; `test:ui` (which holds the UI-rule guard tests) and the 21 Electron checks never run in CI; `build` already runs `tsc`, so the typecheck step runs twice. There is no `npm test`.
- Fixed sleeps before geometry asserts: `test-chat-layout.cjs:119` (450 ms), `:133` (350 ms), `test-sidebar-resize.cjs:47` (400 ms).

**Steps:**
- [ ] `scripts/lib/ui-check.cjs`: `runFixtureCheck({ slug, fixture, size }, async ({ window, evaluate, waitFor, shot, key }) => ...)`; `shot` honors `MILAGRE_SCREENSHOT_DIR` and does nothing otherwise.
- [ ] One typed fake `window.milagre` backed by the shared reducer and a scriptable event feed (the pattern added to `test-command-palette.cjs` in #128: `agentHandlers` plus `agentEvent`).
- [ ] Migrate the 21 scripts; delete the `/tmp` writes.
- [ ] `npm test` = typecheck + `test:agent` + `test:ui` + `test:release`; `test:e2e` runs the 21 checks; CI runs `npm test` on ubuntu and `test:e2e` on macOS (about 80 s).

**Acceptance:** a new check is under 60 lines of fixture plus assertions; CI fails when a UI-rule guard test fails.

---

## Task 9: Deletions, packaging and docs

**Strength:** Strong for the first two bullets (free), Worth exploring for the rest.

- [ ] Delete `PromptBar.tsx` (124 lines, no importers; `docs/plans/2026-10-01-models-environment.md:134` already calls it unused).
- [ ] `SidebarNav.tsx:57-64,391`: remove the design-system leftovers (`WORKSPACE = "Creamery Ops"`, `DEFAULT_RECENTS` "Subway surfing", `demoActiveTitle`), the unused `variant` prop and the always-true `fill` branch.
- [ ] Unused exports: `isAttachableImage`, `LARGE_DIFF_LINES`, `HANDOVER_BRIEF_NAME`, `deleteNote`, `rowText`, `pickEditor`, `projectInitial`, `useResolvedTheme`, `CODE_LANGUAGES`.
- [ ] `main.cjs:502`: the comment "Opening a chat reads it..." belongs to `chat:set-open` at `:515`.
- [ ] Packaging: `app.asar` is 121 MB; 77 MB is `@hugeicons/core-free-icons` shipped as raw `node_modules` although Vite bundles it into `dist` (5.8 MB). Move react, react-dom, react-markdown, remark-gfm, motion, `@hugeicons/*` and shiki to the desktop workspace's devDependencies and drop the `!shiki` patterns from `build.files`. Verify with `package:mac:local` and the saved-state smoke in `scripts/test-desktop.cjs`.
- [ ] Four atomic JSON writers (`project-store.cjs:30`, `recent-projects.cjs:64`, `project-settings.cjs:41`, `usage-cache.cjs:47`) → one `json-file.cjs` with serialized `update()`; only two delete the temp file on failure today.
- [ ] Five "is this path inside the folder" checks (`worktree-cleanup.cjs:62`, `agents/permissions.cjs:139`, `editors.cjs:76-81`, `project-image.cjs:36`, `worktree-files.cjs:141`, plus `git-diff.cjs:21`) → one tested `isInside(root, target)`. The `startsWith("..")` one skips a real file named `..env`.
- [ ] Rename `project-state.cjs` / `project-states.cjs` / `project-store.cjs` by role (schema, cache, file) if they survive #127 as separate modules.
- [ ] Docs: `design.md` (Portuguese) describes a green theme, a 280 px sidebar and a 360 px context panel that do not exist; mark it superseded. `GLOSSARY.md` defines Link, Delegation, Negotiation and a canvas with no code behind them; add a status to those terms and to ADR-0002. Plans live in `docs/plans` and `docs/superpowers/plans`; pick one.
- [ ] Add ESLint with only `@typescript-eslint` recommended and `react-hooks` rules, plus Prettier; run in CI. 44 JSX lines exceed 300 characters (11 in `PromptComposer.tsx`, the worst 1,013 characters at `:455`); `DiffComments.tsx:64` has an `eslint-disable` comment nothing reads.

---

## Appendix A: Clean Code observations not covered above

- Longest functions: `App` 919 lines, `GitActionsDialog` 380, `createGitActions` 364, `PromptComposer` 356 (13 `useState`, 6 effects), `MessageScroller` 324, `SidebarNav` 310, `ChatComposer` 217, `QuestionCard` 192, `ChatMenu` 176, `ChatRow` 169. `GitActionsDialog.run` sequences commit, push and PR inside the component; move the runner to `lib/git-dialog.ts` or to core (Task 5 candidate 8 in the audit: make archive and git steps single core commands).
- Boolean-flag parameters: `executeSend(body, mode, images, files, preserveComposer)` called as `(..., [], [], true)`; `start(target, extend, drag)`; `load(file, force)`; `ClaudeProvider.start(model, mode, effort, ultracode, fastMode)`. Use option objects.
- Turn settings (model, effort, ultracode, fastMode, replies, tldrEnabled) are spelled out by hand in 7 places (`model.ts`, `App.executeSend`, `App.handover`, `ChatHost.send`, `SessionManager.startTurn`, both providers' `beginTurn`); App decides them across 3 refs and 3 effects. Spec 003 needs core to start a Chat with no renderer involved, so a single resolver on the core side is the eventual home.
- Effect lifecycles copied with timings inlined: the 30 s / focus polling loop appears twice inside `useWorktreePullRequests.ts` (56-74, 115-125); `Settings.tsx` repeats "load, refetch on focus, debounced save (600 ms twice), flush on unmount" for two fields. 14 effects use the hand-rolled `cancelled` flag; the recent-projects list and the Project image are each fetched twice (App and SidebarNav).
- Vocabulary vs GLOSSARY.md: "session" appears in about 7 user-facing strings, "workspace" in 3 strings and about 62 identifiers; the code calls a Chat a session throughout (489 session-named identifiers). Tackle with Task 5's renames.

## Appendix B: Already good, leave alone

- `electron/project-states.cjs`: five methods hide serialization, lazy reads, no-op detection and save retry; its read/save seam is used by four test files.
- `electron/shared/agent-runs.mjs`: one reducer for both processes with a 445-line test; `updateStep` replaces only the changed step so other `StepRow` memos hold.
- `electron/agents/session-manager.cjs`: 50 ms batching per Chat, output capped at 20k characters, idle close, provider swap, closed-session retry behind a small surface.
- `useDiffFiles` (patch cache, bounded queue, stale-read invalidation), `useDiffComments`, `usePastedImages`, `lib/git-dialog.ts dialogMode`, `lib/settings.ts`, `PickerPanel`/`PickerRow`, `chatTitle` in `shared/chats.mjs`.
- Shiki and each grammar load lazily; highlighting is memoized per block; `Markdown` is memoized on its text.
- Process cleanup: detached process groups, `killTree` TERM then KILL, quit capped at 5 s, suspend/resume of running Chats.
- No TODO/FIXME, no commented-out code, no `any`, strict TypeScript in the renderer, comments explain why. 48 of 53 main-process modules and 29 of 39 renderer lib files have a test next to them (898 tests, 19 s).

## Appendix C: Numbers from the detector

`npx jscpd --min-tokens 40 --min-lines 5` over `app/src`, `electron`, `scripts` (tests and fixtures excluded): 121 clones, 5% of lines. `electron` + `scripts` 8.7%, `tsx` 1.7%, `ts` 0.45%. Real-code pairs, largest first: `ChatComposer.tsx:202-221` ↔ `PromptComposer.tsx:65-84` (identical prop declarations), `SidebarNav.tsx:245-260` ↔ `ChatRow.tsx:642-658` (menu keys), `git-actions.cjs:173-188` ↔ `git-diff.cjs:53-72` (`resolveBase`), `git-text.cjs:188-200` ↔ `worktree-name.cjs:32-44` (SDK call), `GitActionsDialog.tsx:258-286` ↔ `Handover.tsx:107-144` (focus trap), `project-settings.cjs:18-28` ↔ `recent-projects.cjs:32-41` (strict read), `lib/notice.ts:8-16` ↔ `lib/settings.ts:69-77` (subscribe), `claude-provider.cjs` ↔ `codex-provider.cjs` (4 pairs), `QuestionCard.tsx:186-192` ↔ `tool-approval.tsx:198-204` (pending footer), `PortTrack` ↔ `TaskTrack` ↔ `SubagentTrack` (popover boilerplate).
