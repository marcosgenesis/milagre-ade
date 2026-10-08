# Milagre Orchestration Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for native execution or `superpowers:subagent-driven-development` if the user selects task-by-task delegation. Steps use checkbox syntax to track completion.

**Goal:** Ship `/milagre`, `/milagre-advisor`, `/milagre-committee` and `/milagre-help` with host-owned cross-provider analysis, matching desktop/mobile activity and durable results.

**Architecture:** An advisor manager owns separate constrained provider sessions and publishes them as explicitly sourced Subagents of an existing Chat. The shared runtime supplies scope/account/model selection, a small read-only tool set and labeled completion delivery. Committee invokes the same advisor mechanism twice; the clients display and control its existing records.

**Tech Stack:** Node.js 24+, CommonJS core, existing Claude Agent SDK and Codex app-server adapters, Zod, shared TypeScript models, React/Electron and Expo/React Native. No new dependency.

**Spec:** https://github.com/the-ptf/milagre-ade/issues/292

## Global Constraints

- Canonical skills are `/milagre`, `/milagre-advisor`, `/milagre-committee` and `/milagre-help`; no `/advisor` alias. Existing workspace/user skill precedence stays in effect.
- Maximum two simultaneously running host-owned advisors per Chat. Follow-ups serialize per advisor; no recursive advisor launches or writable advisors, even with parent Full permissions.
- Default advisor uses the other provider. Default committee has one Claude and one Codex member; at most one comparison follow-up per member. Report unavailable members and unresolved disagreement.
- Every desktop behavior ships on mobile in the same task. Mobile changes are JS/TS only; verify the TestFlight fingerprint before editing mobile. Do not start a native build or publish an update.
- Keep the existing Project/Named Link Accounts and owned Worktree roots. Canvas-linked Worktrees use existing read-only linked queries; advisors cannot delegate changes or create Worktrees. Result messages cannot impersonate user input.

## Review Focus

1. Malicious inherited provider config exposes shells, external MCP or nested-agent tools: deny access or refuse launch before any work runs (Task 1).
2. Two concurrent launches both see a free slot, or a follow-up overlaps its preceding turn: serialize admissions and per-advisor turns (Task 2).
3. A completion arrives while the parent asks a human question or prepares a handoff: queue delivery without answering or cancelling the human interaction (Task 3).
4. Parent Stop, archive or shutdown races with startup/completion: cancel child work and reject late automatic resumption (Tasks 2 and 3).
5. A crash occurs after sending a result but before acknowledgement: preserve visible output, mark delivery uncertain and require manual inspection rather than replay (Tasks 2 and 3).

## Task 1: Constrained provider sessions and read-only tools

**Files:** Create `packages/core/src/advisor-reads.cjs`, `advisor-reads.test.cjs`, `agents/advisor-policy.cjs` and `agents/advisor-policy.test.cjs`. Modify `agents/claude-provider.cjs`, `agents/codex-provider.cjs` and their existing tests. Paths in this paragraph are relative to `packages/core/src` after the first explicit path.

**Interfaces:** `createAdvisorReads({ roots, referenceRoots, git })` returns provider-neutral tool definitions for `advisor_read_file({ root, path, start?, end? })`, `advisor_list_files({ root, path? })`, `advisor_search_files({ root, query, glob? })` and `advisor_git({ root, operation, staged?, path?, limit? })`. `advisorPolicy(provider, tools)` supplies the adapter's fixed analysis restrictions. Provider session constructors accept `analysisOnly: boolean` and a constrained `linked` tool transport; this is session identity, never a user permission-mode choice.

- [ ] **Step 1: Add failing tests.** Check realpath confinement, symlink/path escapes, unknown tool fields, option-looking paths, output limits and Git operations restricted to status/diff/log. In both provider suites assert that parent Full permissions cannot grant writes, shell execution, external MCP or recursive launches. Verify follow-up/resume uses the same restrictions.

```js
test("Codex analysis never allows writes or escalation", () => {
  const policy = advisorPolicy("codex", []);
  assert.equal(policy.sandbox, "read-only");
  assert.equal(policy.approvalPolicy, "never");
  assert.deepEqual(policy.sandboxPolicy, { type: "readOnly", networkAccess: false });
});
```

- [ ] **Step 2: Run the new tests.** `node --test packages/core/src/advisor-reads.test.cjs packages/core/src/agents/advisor-policy.test.cjs`. Expect missing modules/functions, not fixture errors.
- [ ] **Step 3: Implement the interfaces.** Resolve real paths before reads, use the existing Git read client with fixed argument arrays, and cap file/search/Git output at 40,000 characters. Use existing Git file listing/search support, with validation before execution. Allow skill references through explicit reference roots only.
- [ ] **Step 4: Constrain and verify adapters.** Codex uses `sandbox: "read-only"`, `{ type: "readOnly", networkAccess: false }`, no escalation and only advisor MCP tools. Disable shell/nested-agent/code execution and inherited external tools using APIs verified against the installed CLI protocol/config. Claude uses an explicit built-in tool set, advisor-only MCP, no inherited config hooks/plugins, and a deny-by-default permission policy. Prefer host tools for reads on both. Check installed SDK types and CLI-generated schemas before pinning fields; a provider unable to enforce the restrictions fails launch. Run existing provider tests plus real provider tool-discovery/denial probes in a temporary Project. Verify the temporary Project stays unchanged.
- [ ] **Step 5: Commit after passing checks.** `git commit -m "feat: add constrained advisor provider sessions"` with only Task 1 files staged.

## Task 2: Advisor ownership, lifecycle, tool definitions and persistence

**Files:** Create `packages/core/src/advisors.cjs`, `advisors.test.cjs`, `advisor-tools.cjs`, `advisor-tools.test.cjs`, `advisor-store.cjs` and `advisor-store.test.cjs`. Modify `packages/shared/src/model.ts`, `packages/shared/src/agent-activity.ts` and relevant tests; keep persistence outside client components.

**Interfaces:** `createAdvisors({ states, store, contextFor, providersFor, launch, publish, completed, now })` returns `providers(chatId)`, `create(chatId, input)`, `followup(chatId, advisorId, prompt)`, `read(chatId, advisorId)`, `stop(chatId, advisorId)`, `retry(chatId, advisorId)`, `stopChat(chatId)`, `reconcile(chatId)` and `close()`. `advisorToolDefinitions(chatId, manager)` exposes exactly the five tools named by spec #292. `createAdvisorStore({ dataDir })` returns `read(chatId)`, `update(chatId, fn)`, `flush()` and `close()` using atomic durable records.

**Shared record:** Extend `Subagent` with optional `source: "milagre-advisor"`, `provider`, `model` and `retryable`; provider-native children keep their existing records. Manager-private records include `id`, `chatId`, `scopeIdentity`, `launchIdentity`, `nativeId`, `turnNumber`, `queuedPrompts`, `output`, `completionId` and `delivery: "pending" | "sending" | "delivered" | "uncertain"`. Never persist credentials or environment values. Use namespaced `advisor:<uuid>` IDs.

- [ ] **Step 1: Add failing tests.** Assert omitted provider chooses the opposite parent provider; unavailable provider or unsupported model/effort launches nothing. Assert concurrent create calls cannot exceed two active slots, cross-Chat IDs cannot inspect/control a child, prompts/titles are bounded and unknown fields fail. Assert follow-ups serialize and retain history, source/provider metadata survives storage, and archived/replaced scope identity rejects further work.
- [ ] **Step 2: Run tests.** `node --test packages/core/src/advisors.test.cjs packages/core/src/advisor-tools.test.cjs packages/core/src/advisor-store.test.cjs`. Expect missing implementation.
- [ ] **Step 3: Implement manager and tool schemas.** Pin account/model/environment at launch through host context ports; persist before process startup. Use strict Zod schemas: title 1 to 120 characters, prompt 1 to 40,000 characters, known provider enum, provider-reported model/effort. Default to the recommended reported model, else the first reported model; reject an empty reported catalog. Use its reported default effort when available, otherwise omit effort. Explicit effort must be reported for the chosen model. Serialize Chat admissions and advisor turns; cap each advisor's waiting follow-ups at four with an actionable error. Publish initializing/running/terminal activity using shared Subagent records. Assemble tool adapters around manager methods; they cannot accept Chat/cwd/command/account overrides.
- [ ] **Step 4: Implement termination/recovery tests and pass them.** Stop cancels pending startup, current work and queued follow-ups, closes its provider process, suppresses stale generation events and releases the slot once. Recover interrupted records as cancelled/retryable, retain completed output and mark sending deliveries uncertain without replay. Retry validates current scope and pinned Account still exist, restarts one turn with history and preserves the advisor ID. Store failures prevent launch/delivery and do not leak processes. Run the new suites and affected shared-model/activity tests.
- [ ] **Step 5: Commit after passing checks.** `git commit -m "feat: manage durable cross-provider advisors"` with only Task 2 files staged.

## Task 3: Runtime integration and labeled result delivery

**Files:** Create `packages/core/src/advisor-delivery.cjs` and `advisor-delivery.test.cjs`. Modify `packages/core/src/runtime.cjs`, `agents/chat-host.cjs`, `agents/chat-subagent-recovery.test.cjs`, `project-state.cjs`, `linked-worktrees.cjs` and relevant runtime/account/scope tests. Add a shared `AdvisorResultContext` in `packages/shared/src/model.ts` and shared presentation helpers/tests in `advisor-result.ts` and `advisor-result.test.ts`.

**Interfaces:** `createAdvisorDelivery({ store, contextFor, isBlocked, send, note })` returns `enqueue(chatId, completion)`, `drain(chatId)`, `stop(chatId)` and `close()`. `ChatHost.send` accepts `context.kind === "advisor-result"` through its existing message/context path. The context has `advisorId`, `completionId`, `title`, `provider` and `outcome`; its visible label is supplied by a shared helper. Host commands `advisor:stop(chatId, advisorId)` and `advisor:retry(chatId, advisorId)` route to the same manager as the MCP tools.

- [ ] **Step 1: Add failing delivery/integration tests.** Exercise active-parent steering, idle-parent continuation and delivery into the current provider after a handoff. Check waiting human questions/approvals and preparing handoffs defer delivery. Assert duplicated completion IDs do not duplicate replies, explicit parent Stop never resumes it and uncertain restart delivery stays inspectable. Add Project and Named Link account/root selection tests plus cross-Chat command rejection.
- [ ] **Step 2: Run tests.** `node --test packages/core/src/advisor-delivery.test.cjs packages/core/src/agents/chat-subagent-recovery.test.cjs` plus new runtime integration tests. Expect missing interfaces and previously unclassified advisor results.
- [ ] **Step 3: Connect runtime ports.** Resolve Chat roots/instructions through existing Project/Named Link state, active parent provider through `ChatHost.turnSettings` or stored Chat state, and Accounts/models through `routing` and existing CLI/model services. Expose advisor definitions via `createLinkedWorktrees.extraTools` for main Chats, and only read definitions in advisor sessions. A separate per-advisor MCP endpoint has its own identity/token and cannot call main-Chat mutation tools. Publish Subagent events through `chats.receive` with durable advisor state flushed first. Exclude host-owned IDs from native Codex recovery and prevent parent completion from automatically hiding undelivered advisor output.
- [ ] **Step 4: Connect delivery and shutdown.** Persist pending completion before routing, mark sending before a provider call and record delivered only after acceptance. A labeled result is app-owned context, not user-authored input; it carries output as data for synthesis. Drain after questions/approvals/handoffs settle. Integrate parent Stop, Chat archival/deletion, scope removal, daemon shutdown, keep-awake and pending-work tracking. Re-check scope before every delivery. Do not hold host/state mutation queues while waiting on provider completion. Run manager, delivery, runtime, account, shared result/reducer and native subagent recovery tests.
- [ ] **Step 5: Commit after passing checks.** `git commit -m "feat: return advisor results to their owning chats"` with only Task 3 files staged.

## Task 4: Four bundled skills and shipped product references

**Files:** Create `packages/core/src/bundled-skills/milagre/SKILL.md`, `milagre-advisor/SKILL.md`, `milagre-committee/SKILL.md` and `milagre-help/SKILL.md`. Add maintained topic references under `milagre-help/references/` and tool/access guidance under `milagre/references/` only when too detailed for the entrypoint. Modify `packages/core/src/skills.test.cjs` and `docs/desktop-guide.md`. Paths after the first skill are relative to `packages/core/src/bundled-skills`.

**Interfaces:** The skills invoke the real tool names from Task 2 and reference one shared Milagre contract. Their frontmatter contains canonical `name` and a concise trigger/description. Help references explain the shipped desktop, local host, Accounts, phone pairing, handoff, advisor and troubleshooting flows without requiring a source checkout.

- [ ] **Step 1: Add failing discovery/expansion tests.** Assert the four canonical names appear as bundled Milagre skills with an empty user home, workspace/user overrides still win and requested instructions/reference directories survive prompt expansion. Check linked resources resolve outside an Electron archive and docs contain no invented Paseo commands or unimplemented profiles.
- [ ] **Step 2: Run tests.** `node --test packages/core/src/skills.test.cjs`. Expect the four bundled skills to be absent.
- [ ] **Step 3: Write skills and references.** Use the skill-creator guidance for brief entrypoints and topic-based references. Advisor prepares a self-contained analysis briefing, discovers providers, launches asynchronously and synthesizes after notifications. Committee preflights both providers, launches independent members and permits one comparison follow-up without forced consensus. Reference documents schemas/limits, accounts, cancellation and recovery. Help verifies affected desktop/host/phone topology, performs relevant read-only diagnosis and redacts credentials; state changes follow the user's authorization.
- [ ] **Step 4: Verify workflows.** Run discovery/expansion tests and scenario checks for opposite-provider advice, one missing committee provider, conflicting recommendations, a forwarded skill requesting edits, and a packaged-app phone connection question. Verify each skill asks for real tools and preserves analysis restrictions. Update the desktop guide to describe the four skills and their actual shipped behavior.
- [ ] **Step 5: Commit after passing checks.** `git commit -m "feat: bundle Milagre orchestration and help skills"` with only Task 4 files staged.

## Task 5: Desktop/mobile presentation and final verification

**Files:** Modify `apps/desktop/app/src/components/agents/SubagentTrack.tsx`, `SubagentCanvas.tsx`, `components/ChatComposer.tsx`, `components/LinkedMessage.tsx`, `components/LinkWorkspace.tsx` and `App.tsx`; wire host commands through `apps/desktop/electron/preload.cjs` and `apps/desktop/app/src/electron.d.ts`. Modify `apps/mobile/src/subagent-item.tsx`, `app/agents.tsx`, `app/chat.tsx`, appropriate message-presentation helpers and `apps/daemon/src/mobile-bridge.cjs`. Extend `scripts/test-subagents.cjs`, `test-prompt-skills.cjs`, `test-skills-settings.cjs` and `mobile-ui.test.cjs`; add a mobile advisor fixture if needed by the real-run harness.

**Interfaces:** Shared advisor source/provider fields drive role/provider labels on both clients. Subagent controls accept `onStop(id)` and `onRetry(id)` for host-owned advisors only; provider-native archive behavior stays as it is. `advisor:stop` and `advisor:retry` require explicit Chat identity and host ownership validation. Shared `advisorResultLabel(context)` labels the app-owned message on both clients; existing Link headers exclude that new context kind.

- [ ] **Step 1: Check mobile compatibility before editing.** Read the installed Expo major and matching official docs for any native UI/API touched. Run the iOS fingerprint and compare it with the latest finished TestFlight runtime as `apps/mobile/AGENTS.md` instructs. A mismatch needs investigation before any native change; do not introduce native dependencies/config or start a build.
- [ ] **Step 2: Add meaningful failing UI checks.** Cover initializing/running/completed/failed/interrupted advisor rows, provider identification, Stop, Retry, readable output and labeled results on desktop and mobile. Verify unknown/failed host calls show errors and preserve records. Assert the four skills appear in both slash menus/Settings and a new context kind is not misclassified as a linked Delegation.
- [ ] **Step 3: Implement presentation and controls.** Reuse desktop ScrollArea/Select/useDismiss and mobile ActivityItem/PageScroll/native controls. Keep provider metadata, result labels and action availability shared. Pass callbacks through Project and Named Link Chat views. Add bridge methods to its explicit allowlist with existing confinement rules. Run relevant unit/mobile checks and typechecks as each interface is connected.
- [ ] **Step 4: Run required verification.** `npm run typecheck`, `npm run typecheck:mobile`, `npm run lint`, `npm test -- --unit`, then `npm test -- --only subagents`, `npm test -- --only prompt-skills` and `npm test -- --only skills-settings`. Use `MILAGRE_SCREENSHOT_DIR` outside the repo for screenshots from real Electron runs; verify mobile through its real-run fixture/simulator and capture added states. Repeat the mobile fingerprint comparison. Run both real provider directions in an isolated temporary Project and verify denied side effects and intact files. Run a fresh whole-branch review and address findings before claiming completion.
- [ ] **Step 5: Commit and report evidence.** `git commit -m "feat: show and control advisors on desktop and mobile"` after checks pass. If opening a PR, publish screenshots on the separate screenshots branch and link their immutable commit URLs; keep images out of the feature commits. Report checks, provider-probe results and any remaining limitation. Do not merge or publish an OTA as part of this task.

## Execution handoff

The spec is approved. Review this implementation plan and choose native implementation in this Chat or task-by-task subagents before product edits. Native execution is recommended because all five tasks depend on the same provider, lifecycle and shared-model interfaces; one final independent review checks the branch.
