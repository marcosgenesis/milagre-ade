# Project Accounts Implementation Plan

> Execute the approved Pencil design. UI tasks run independently using the fixed RPC contract below; the primary agent owns routing and integration.

**Goal:** Persist independent Claude/Codex selections for each Project and named Link, with explicit computer-default inheritance.

**Architecture:** Credentials stay in host-managed private profiles. Account overrides live in the account store, keyed by canonical scope. Every provider call resolves its scope; model/status/usage caches are account-specific. Running provider processes retain their original account.

**Tech Stack:** CommonJS core, shared TypeScript contracts, React desktop, Expo 57 mobile.

**Spec:** Approved conversation and Pencil Project Accounts screens. Separate Accounts and Project Accounts; native mobile header; compact choices; Project photos and stacked Link photos.

## Constraints and review focus

- No native dependencies, new builds, deployment, or changes to saved live account selections.
- Missing/removed explicit accounts fail closed, never borrow another account.
- Inheritance follows computer defaults dynamically; explicit selections remain pinned.
- Late responses after changing scope must not display another scope's models or usage.
- Existing turns and active subagents keep their process; subsequent idle turns use the assigned account and resume history.

## Contracts

`accounts:scopes` returns `{key,name,kind,projects:[{id,path,name}]}[]`.
`accounts:scope(key,refresh)` and `accounts:assign(key,provider,id|null)` return `{scopeKey,providers:[{provider,accountId,effectiveId,defaultId,accounts}]}`. Null means inherit, `default` means the connected CLI profile explicitly. Account IDs refer to saved profiles; removals retain broken overrides until deliberately changed.
Provider discovery and usage commands accept an optional scope key. Omitted means computer defaults.

## Tasks

- [x] Core: tests for two independent scopes, inheritance, persistence, invalid scope/account, removed account and sign-out. Watch failures; implement selection and RPC validation.
- [x] Runtime: resolve Chat scope for turns, titles, handovers and recovery; partition model/status/usage caches by effective accounts. Test concurrent scope routing and active-turn retention.
- [x] Desktop: new tab/selector; scope-aware discovery and usage; interaction and screenshot verification.
- [x] Mobile: native route, photo selectors, scope-aware discovery/usage; UI tests, lint, typecheck and unchanged fingerprint.
- [x] Integration: update domain docs, run core/daemon/shared and UI checks, inspect desktop screenshots, independent final review.
- [ ] Mobile visual verification: simulator runtime blocks mounting the updated app, as recorded below.

## Execution ledger

- Existing worktree already contains the approved sign-in fix and account icon changes. Preserve them.
- User explicitly requested implementation after reviewing and refining the design; proceed without another approval gate.
- Desktop and mobile workers own disjoint files. Primary owns core, shared contracts, daemon and docs.
- Core suite: 965 passed, 7 skipped. Daemon suite: 177 passed, 3 skipped. Shared suite: 154 passed. Runtime suite: 18 passed. Final focused routing/account tests: 15 passed.
- Desktop and mobile typechecks pass. Desktop Electron account flows pass; screenshots are outside the repo at `/tmp/milagre-project-accounts`.
- Independent review found three races: removed scoped accounts failed to notify, mobile reauthentication could refresh a stale scope, and desktop CLI updates could apply unscoped status. All three have regression coverage and fixes.
- Mobile runtime fingerprint remains `64b0bb9aecd3e78a5aab6ea06a990fb26b4c293a`, matching the installed TestFlight runtime. No native changes or builds.
- Mobile visual check is blocked: Milagre Local opens its old bundle; Expo Go fails before mount with missing `ExpoAsset` and `ExponentConstants`. Automated mobile checks pass, but native visual behavior remains unverified. Temporary Metro and device services were stopped.
- No live account assignments changed, commits created, or updates deployed.
