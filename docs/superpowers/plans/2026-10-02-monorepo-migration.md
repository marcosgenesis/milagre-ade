# Monorepo migration implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan. Track completion with the checkboxes below.

**Goal:** Put the existing desktop app and shared domain code in npm workspaces without losing existing behavior or data compatibility.

**Architecture:** Move the renderer and Electron code together into `apps/desktop`. Extract the existing pure shared modules and model into `packages/shared`. Keep root commands and release tooling as compatibility entry points; agent ownership remains in Electron for this phase.

**Tech Stack:** Existing Node.js 24+, npm, Electron, React, Vite, TypeScript, electron-builder, and semantic-release. No dependency upgrades.

**Spec:** The first-phase scope approved in this conversation on 2026-10-02: monorepo structure, shared-code extraction, and verified desktop packaging, preserving everything already implemented. The later daemon, relay, iOS, and Android work is outside this migration.

## Global constraints

- Preserve the desktop package name `milagre`, product name `Milagre`, app ID `com.milagre.app`, version behavior, and GitHub update feed.
- Preserve `.milagre/coordination.json`, Electron userData, recent Projects, settings, handovers, bundled skills, and worktree locations. No data migration.
- Keep every existing root npm command, including installer argument forwarding and root `release/` output. Keep direct `node scripts/test-*.cjs` checks usable.
- Preserve dependency versions and every existing source file, asset, and test. Prefer moves and import changes over logic changes.
- Do not start agent turns or use real Projects to test. Keep test state and screenshots outside the repo.

## Review focus

- Electron app identity and persistent-data paths must be identical after the directory move.
- Hoisted and linked workspace dependencies must be included in the packaged app without relying on this checkout.
- Installer architecture, version, signing, and notarization flags must survive root command forwarding.
- Vite, Tailwind, fixtures, and the launcher must resolve paths from both root and workspace commands.
- Shared modules must load in Node, Electron CommonJS, and Vite without depending on desktop source.

## Task 1: Move the desktop app and extract shared code

**Files:** `package.json`, `package-lock.json`, `.gitignore`, `apps/desktop/**`, `packages/shared/**`, root Vite/TypeScript compatibility configs, `scripts/launch-electron.cjs`, affected `scripts/test-*.cjs`, `scripts/monorepo.test.cjs`, and CI checks.

**Interfaces:** Root scripts continue accepting their existing arguments. `milagre` is the desktop workspace; `@milagre/shared` exports model types and the existing shared modules. Release scripts remain at the repository root and installers remain under `release/`.

- [x] Run the existing build, agent, UI, and release tests as a baseline. Record failures before editing.
- [x] Add migration contract tests for workspace discovery, unchanged app identity/update settings, dependency resolution, and forwarded packaging arguments. Run before the move; expect missing-workspace failures.
- [x] Move desktop source and its configs. Keep root command/config entry points where existing scripts need them. Update launcher paths while preserving the repository launch cwd.
- [x] Move pure shared source and tests into `packages/shared`; replace cross-directory imports with package exports and retain a renderer model re-export.
- [x] Regenerate the lockfile without changing resolved dependency versions. Verify clean installation, typecheck, build, agent/UI tests, migration contracts, and release safeguards.

## Task 2: Prove packaging and document the new layout

**Files:** `scripts/test-desktop.cjs`, packaging checks as needed, `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `docs/agents/ui.md`, and this plan's verification record.

**Interfaces:** Uses the workspaces and root commands from Task 1. Runs the real desktop renderer/main/preload with temporary settings and a temporary Project; packaging runs without publishing.

- [x] Run the existing Electron fixture checks from root; compare failures against the baseline when necessary.
- [x] Verify a real desktop launch reads an existing-format transcript and settings through the preload bridge. Verify shared exports and bundled skills in the packaged app.
- [x] Build an ad-hoc signed local macOS installer through the existing root command. Inspect the application archive and launch the packaged app with isolated data. Report the limit that production signing/notarization requires CI credentials.
- [x] Audit the original tracked-file inventory against the moved files, inspect dependency changes, update current documentation paths, and verify the working diff.
- [x] Request one independent review under the executing-plans skill, fix material findings, and record final checks. Leave the branch ready for review without merging or publishing.

## Verification record

- Clean `npm ci` succeeds. Dependency version/resolution comparison found no added, removed, or upgraded external packages.
- Original file inventory: 337 files accounted for, 299 byte-identical at their new paths. Product-source changes are package imports only; the SDK test resolves its dependency through Node.
- `npm run build`: passes, including shared and desktop typechecks.
- `npm run test:agent`: 45 shared tests and 853 desktop tests pass (898 total, matching baseline).
- `npm run test:ui`: 210 pass. `npm run test:release`: 15 pass. `npm run test:monorepo`: 3 pass.
- All 21 existing Electron fixture scripts pass from root.
- `npm run package:mac:local`: builds the Apple Silicon DMG and ZIP. Packaged metadata keeps the original app identity and update feed; shared modules and unpacked bundled skills are present.
- Ad-hoc app signature verification, DMG checksum verification, and ZIP integrity verification pass. The root TypeScript config also passes `npx tsc --noEmit`.
- `npm run test:desktop -- --packaged release/mac-arm64/Milagre.app`: source and packaged app both open the same temporary existing-format Chats, provider ID, handover draft, Project settings, and UI preferences. Transcript remains unchanged after quitting.
- Production Developer ID signing, notarization, Intel packaging, and update installation are not exercised locally; existing CI release safeguards remain in place.

Independent review: no findings. Confirmed all original root commands remain, all 1,067 external lockfile entries retain version/resolution/integrity, and the packaged app has no links back to the checkout. Production signing/notarization, Intel execution, and update installation remain CI/release validation; daemon, relay, and mobile behavior belong to later phases.
