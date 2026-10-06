# Named Project Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let desktop users select a named Link and run one shared Chat in one new Worktree per member Project.

**Architecture:** Persist named Links separately from existing canvas edges. Give shared Chats a Link scope, canonical state in the runtime profile, a durable Worktree preparation record and one provider session with access to all owned member Worktrees. Reuse transcript and lifecycle behavior through a scope adapter; ordinary Project state and existing canvas Delegation retain their contracts.

**Tech Stack:** Node CommonJS core, shared TypeScript/ES modules, Electron, React, existing Git client, Claude SDK 0.3.288 and Codex App Server. No new dependencies are planned.

**Spec:** https://github.com/the-ptf/milagre-ade/issues/200

## Global Constraints

- Import is a separate PR. No mobile Link UI or native changes.
- The daemon remains the sole writer.
- Each later new Chat creates a fresh set. Sending again, restarting, or handing over providers reuses that Chat's set.
- No extra Link heading in the Chat pane. Hide the four Project-specific selector actions while viewing a Link.
- Use shared ScrollArea, choice and dialog primitives. Real-run PR screenshots belong on the orphan screenshots branch.

## Review Focus

1. Two checkouts of one repository cannot become distinct Link members (Task 1).
2. Repeated sends and a lost acknowledgement cannot create duplicate Worktree sets (Tasks 2 and 4).
3. Crash recovery cannot delete a modified or ambiguous preparation Worktree (Task 2).
4. Alias paths cannot widen workspace permissions to unrelated repositories (Task 3).
5. Switching windows/scopes or receiving an oversized state cannot lose a reply or select another client's Chat (Task 4).

## File boundaries

New core modules: `project-groups.cjs` validates named Link membership; `link-store.cjs` owns atomic canonical state; `link-workspaces.cjs` prepares and recovers Worktree sets; `chat-scopes.cjs` routes state and execution context; `link-runtime.cjs` registers Link commands.

New desktop units: `LinkProjectDialog.tsx` creates a named Link; `ProjectAvatarStack.tsx` displays member icons; `link-scope.ts` supplies selection and member-Worktree helpers. Keep `App.tsx` responsible for wiring views, rather than putting persistence or preparation there.

## Task 1: Named Links and explicit Chat scopes

**Files:** Create `packages/core/src/project-groups.cjs` and its test, `packages/shared/src/chat-scopes.mjs` and `.d.mts`, and `packages/shared/src/chat-scopes.test.ts`. Modify `project-registry.cjs`, its test, `packages/shared/src/model.ts`, `packages/shared/package.json`, `GLOSSARY.md`; add `docs/adr/0005-shared-chats-own-worktree-sets.md`.

**Interfaces:** `ChatScope = {kind: 'project'; projectPath: string} | {kind: 'link'; linkId: string}`. `NamedProjectLink = {id: string; name: string; projectIds: string[]; createdAt: string}`. `WorktreeBinding = {projectId: string; projectPath: string; worktreePath: string; branch: string; base: string}`. `LinkChatSession` carries the existing Chat lifecycle fields, `workspacePath` and `worktrees: WorktreeBinding[]`, without a fake primary Project. `LinkState` owns its Chat counter, sessions, messages and preparations. `scopeKey(scope)`, `chatKeyForScope(scope, sessionId)` and `scopeFromChatKey(key)` preserve current Project keys and use `milagre-link:<uuid>#<id>` for Link Chats.

- [ ] Write failing membership/round-trip tests. Assert registry reload retains `projectGroups` and legacy `links`; reject empty names, fewer than two members, unknown IDs and duplicate membership sets. Assert checkouts resolving to one common Git directory count once, and Project paths containing `#` round-trip.

  Representative test: `named links survive registry reload without changing canvas edges`.

  ```js
  assert.deepEqual(reloaded.projectGroups, [created]);
  assert.deepEqual(reloaded.links, originalCanvasEdges);
  assert.deepEqual(scopeFromChatKey(chatKeyForScope(scope, 7)), scope);
  ```
- [ ] Run `node --test packages/core/src/project-groups.test.cjs packages/core/src/project-registry.test.cjs` and the shared test suite; confirm the new behavior fails before implementation.
- [ ] Implement registry `listProjectGroups()` and `createProjectGroup({name, projectIds})`, returning a persisted `NamedProjectLink`. Do not prune missing-member Links or migrate canvas edges. Add types and scope-key helpers. Document direct edits only within the new Chat's owned set, preserving ADR-0002 elsewhere.
- [ ] Run those tests and shared typecheck; commit this independently tested model change.

## Task 2: Durable preparation and canonical storage

**Files:** Create `packages/core/src/link-store.cjs`, `link-workspaces.cjs` and their tests. Modify `worktrees.cjs`, `worktree-setup.cjs`, `project-state.cjs`, `project-state.test.cjs` and `project-content.cjs` only where existing functions need explicit storage/ownership inputs.

**Interfaces:** `createLinkStore({dataDir})` exposes `get(linkId)`, `update(linkId, change)`, `flush(linkId?)` and `close()`. `prepareLinkChat({link, chatId, prompt, operationId}) -> Promise<{workspacePath, worktrees: WorktreeBinding[]}>`; `recoverLinkPreparations(linkId)` reconciles saved operations. Inject repository ownership, Git creation/status/removal, setup and the store for tests. Preparations persist `reserved`, `creating`, `setup`, `ready` or `failed` plus per-member completion and retained paths.

- [ ] Write real temporary-repository tests: a two-member Chat gets exactly two Worktrees; a second Chat gets different paths; repeating one operation gets the original set. Fail the second creation and a setup step; assert no provider starts and modified created paths are retained. Simulate restart after the first completed member; assert recovery never blindly recreates it or force-removes it.

  Representative test: `retrying a prepared Chat reuses its exact Worktrees`.

  ```js
  assert.equal(first.worktrees.length, 2);
  assert.deepEqual(retried.worktrees, first.worktrees);
  assert.equal(createdPaths.size, 2);
  ```
- [ ] Run `node --test packages/core/src/link-store.test.cjs packages/core/src/link-workspaces.test.cjs` and confirm the new tests fail.
- [ ] Implement atomic Link state/sidecar storage under `<dataDir>/links/<id>/`, durable preparation before Git writes, repository ownership before mutations, default-base resolution and existing global Worktree placement. Use safe unique workspace aliases, symlinks or Windows directory junctions and a membership manifest. Only automatically roll back verified untouched objects created by that operation.
- [ ] Add shared-Chat ownership references during Project reconciliation. Assert it creates no independent starter Chat for an owned Worktree and never drops readable shared history because a member is missing.
- [ ] Run preparation, storage, reconciliation and existing Worktree/setup tests; commit.

## Task 3: Provider sessions with multiple owned roots

**Files:** Modify `packages/core/src/agents/session-manager.cjs`, `claude-provider.cjs`, `codex-provider.cjs`, `permissions.cjs`, `events.cjs` and their tests.

**Interfaces:** Extend internal provider creation/turn context with `workspaceRoots: string[]` and `workspaceInstructions: string`. `insideWorkspace(roots, files)` classifies resolved member paths, leaving existing one-root behavior intact. Session reuse compares the canonical root set as well as provider and cwd.

- [ ] Write provider tests asserting Claude receives `additionalDirectories`, Codex receives all `writableRoots`, and start/resume/handover use the same complete set. Assert Ask/Auto decisions treat member paths as workspace edits while unrelated paths and escaping aliases keep their existing approval behavior. Test root-set changes replace a provider session rather than reusing stale permissions.

  Representative test: `provider roots include all owned members and exclude other repositories`.

  ```js
  assert.deepEqual(claudeOptions.additionalDirectories, memberRoots);
  assert.deepEqual(codexTurn.sandboxPolicy.writableRoots, [workspacePath, ...memberRoots]);
  assert.equal(await insideWorkspace(memberRoots, [unrelatedFile]), false);
  ```
- [ ] Run affected provider, permission and session-manager tests; confirm new assertions fail.
- [ ] Pass only the prepared Worktrees and the per-Chat workspace as owned roots. Extend `milagreInstructions(tldrEnabled, workspaceInstructions)` in `events.cjs` to explicitly distinguish this Chat's owned Worktrees from external canvas-linked Worktrees; permit edits only within the former under the selected permission mode. Require reading member instructions before editing. Do not merge provider Project configuration or grant the member main checkouts as writable roots. Keep existing external canvas tools read-only.
- [ ] Run the affected tests and commit.

## Task 4: Shared Chat lifecycle and additive transport

**Files:** Create `packages/core/src/chat-scopes.cjs`, `link-runtime.cjs` and tests. Modify `runtime.cjs`, `runtime.d.cts`, `agents/chat-host.cjs`, `chat-images.cjs`, `packages/shared/src/agent-runs.d.mts`, `apps/daemon/src/server.cjs`, `protocol.cjs`, `mobile-bridge.cjs`, `apps/desktop/electron/daemon-runtime.cjs`, `preload.cjs`, and their applicable tests.

**Interfaces:** The scope store adapter exposes `has(scopeKey)`, `owners()`, `get(scopeKey)`, `update(scopeKey, change)`, `flush(scopeKey?)`, `storageDirectory(scope)` and `executionContext(scope, sessionId) -> {cwd, workspaceRoots, workspaceInstructions}`. Register `link:list`, `link:create`, `link:open`, `link:snapshot` and `link:send`. A Link send carries `{linkId, sessionId: number|null, operationId, body, prompt, images, files, provider, model, permissionMode, ...preferences}`. Expose scope-aware patch, resume and handover while retaining legacy Project command forms. Emit `link:state` and include loaded Link states in desktop snapshots.

- [ ] Write runtime/host tests proving one canonical transcript, first-message preparation before provider launch, no additional creation on subsequent sends, scope switching during a turn, Stop, steering, archive/title/unread updates and restart/resume. Test unavailable members keep history readable and block new turns with the affected Project named. Assert provider handover retains Worktree bindings.

  Representative test: `resuming a Link Chat keeps one transcript and its original Worktree set`.

  ```js
  assert.equal(restored.messages.filter(message => message.body === reply).length, 1);
  assert.deepEqual(restored.sessions[chatId].worktrees, originalBindings);
  assert.equal(worktreeCreationCalls, 2);
  ```
- [ ] Write transport tests for two clients with independent selected scopes and large paged Link state. A reconnect snapshot plus later events must show the completed reply once. Existing mobile Project snapshots must omit unsupported Link state.
- [ ] Run targeted host/runtime/daemon/desktop-bridge tests; confirm the new behaviors fail.
- [ ] Introduce the scope adapter and route lifecycle, attachments, automatic titles, provider history recovery, notification labels and image storage through it. Reuse existing transcript reducers through a common transcript-state interface rather than cloning ChatHost. Canonical shared Chat references in Project/canvas views route to `link:open`; they never allocate a local editable Chat. Return explicit errors for unsupported external Delegation into a shared set instead of selecting a member starter Chat.
- [ ] Extend state-page hydration/reconnect by scope kind. Keep old desktop/Project clients compatible and preserve daemon ownership/flush boundaries. Run all affected suites; commit.

## Task 5: Sidebar Link selector and shared Chat view

**Files:** Create `apps/desktop/app/src/components/LinkProjectDialog.tsx`, `ProjectAvatarStack.tsx`, `lib/link-scope.ts` and its tests. Modify `SidebarNav.tsx`, `sidebar/ChatRow.tsx`, `App.tsx`, `electron.d.ts`, `lib/project-list.ts`, relevant state/draft/selection helpers and UI tests.

**Interfaces:** Desktop bridge exposes `listNamedLinks()`, `createNamedLink({name, projectIds})`, `openNamedLink(linkId)`, `sendLinkMessage(request)` and a Link-state subscription. `SelectedScope` is the shared `ChatScope`; `linkChatRows(state)` supplies canonical shared Chat IDs, titles and member counts. A scope-aware draft is keyed by scope, never by a member Project path.

- [ ] Write selection/draft tests proving Project and Link drafts and remembered Chats are separate; duplicate Project names resolve by stable IDs. Add UI coverage for picker search, validation, keyboard dismissal, selected Link, switching back to a Project and a long scrollable Project list.

  Representative test: `Link selection keeps the sidebar scope and removes Project-only actions`.

  ```js
  assert.equal(selector.textContent.includes('Link'), true);
  assert.equal(menu.textContent.includes('Copy project path'), false);
  assert.equal(chatPane.textContent.includes('RDFood / Link'), false);
  assert.equal(menu.textContent.includes('Import project'), false);
  ```
- [ ] Run the new tests and confirm failures.
- [ ] Match the retained Pencil views: Projects/Links sections, existing Project icons, stacked member icons for a Link, selected checkmark and sidebar `Link` label. Hide the four Project-specific actions for Link scope. Keep Open project and add Link project, with no Import action. Reuse ScrollArea and existing dialogs/menus.
- [ ] Wire first send to preparation, preserve the draft on failure, show its named Project error, and display one shared transcript. The Chat row shows Worktree count; add no Link heading to the Chat pane. Ordinary Project selection remains unchanged.
- [ ] Run desktop/shared typechecks, UI primitive checks and affected selection/Chat tests; commit.

## Task 6: Git, editor and existing canvas behavior

**Files:** Modify `App.tsx`, existing Git dialog integration under `apps/desktop/app/src/lib/`, `CanvasView.tsx`, core `git-ipc.cjs`, `editors.cjs` and tests. Add a focused member-Project choice component if the existing dialog cannot host that choice.

**Interfaces:** `memberWorktreeForAction(linkState, sessionId, projectId) -> WorktreeBinding` validates the requested member. Existing Git operations receive that binding's real path/base. Shared workspace editor actions receive `workspacePath`; per-Project actions receive the chosen member path.

- [ ] Write tests that Git changes/commit/push/PR target the selected member Worktree and reject unrelated paths. Assert a canvas/shared-Chat reference opens its Link and that no ordinary starter Chat can be opened or created in that shared Worktree. Keep existing canvas edges and Delegation tests intact.

  Representative test: `Git actions use the chosen member instead of the aggregate workspace`.

  ```js
  assert.equal(commitRequest.path, merchantBinding.worktreePath);
  assert.notEqual(commitRequest.path, sharedSession.workspacePath);
  assert.equal(openedScope.kind, 'link');
  ```
- [ ] Run new routing assertions and confirm they fail.
- [ ] Add the member chooser when a Git action needs a target and display its Project in the existing workflow. Do not treat the aggregate workspace as a repository. Support opening the shared workspace or one member in an editor. Keep new named Links separate from canvas edges.
- [ ] Run relevant Git, editor, canvas and Delegation regressions; commit.

## Task 7: Real local run, screenshots and PR

**Files:** Create `scripts/test-project-links.cjs`; modify `package.json` to expose `test:project-links`. Add a development-only profile override to `apps/desktop/electron/main.cjs` only if required to open the isolated local demo without attaching to the installed app's host.

**Interfaces:** `npm run test:project-links` exercises actual temporary Git repositories and the real Electron UI. `MILAGRE_SCREENSHOT_DIR` saves snapshots outside the repository. A temporary local development profile uses an isolated Worktree root and real providers; the installed app's state is not its test fixture.

- [ ] Add an Electron check for Link creation, both selector modes, shared Chat scope, first-message preparation, switching, failure copy and missing-member history. Assert there is no Link-only Chat heading or Import action. Capture those states through the existing screenshot convention.
- [ ] Run `npm run typecheck`, `npm run test:agent`, `npm run test:ui`, `npm run test:project-links`, `npm run test:canvas-links` and `npm run test:delegation`. Fix failures attributable to this change; report unrelated failures precisely.
- [ ] Launch the dev app with two small temporary Projects. With Claude and Codex, run a shared Chat that changes a small file in both Worktrees; verify the main checkouts remain unchanged, one transcript persists, and restarting reuses the same paths. Keep the demo window available for the user to inspect.
- [ ] Publish real-run screenshots to the orphan screenshots branch without adding images to this PR's commits. Create the Link-only PR referencing #200, with validation evidence and pinned screenshot links. Exclude Import and native/mobile changes.

## Execution and handoff

Recommended method: implement in this Chat using `superpowers:executing-plans`, in the existing isolated Worktree, followed by the required independent final review. All tasks share scope/lifecycle interfaces, so sequential implementation keeps those contracts in one context. The user has requested a local run; keep that as part of completion.

This plan awaits review before product code or dependency installation begins.
