# Windows Readiness Implementation Plan

> Execution: inline, as authorized by Victor; proceed without per-correction confirmation. Use the repository testing skills and regression tests, then a fresh whole-branch review.

**Goal:** Repair demonstrated Windows readiness gaps and deliver a reviewed draft PR with final-commit native evidence.

**Architecture:** Preserve the existing core/daemon/Electron boundaries and saved formats. Serialize forced port reads, cancel optional PR metadata during runtime close, and make NSIS request authenticated shutdown before replacing files.

**Tech stack:** Node 24, CommonJS, Electron 44, electron-builder/NSIS, PowerShell, GitHub Actions.

**Spec:** [Readiness audit](../../windows-readiness.md), [#413](https://github.com/the-ptf/milagre-ade/issues/413), [#414](https://github.com/the-ptf/milagre-ade/issues/414), and Victor's delegated constraints.

## Constraints

- Isolated branch from updated main; preserve the original checkout and concurrent work.
- Draft PR with `pedro`; no merge, release, OTA, credentials provisioning or public installer publication.
- No sandbox bypass or local host-security changes; Linux cannot certify Windows.
- Existing behavior and regression corrections, no broad rewrite. Keep shared daemon behavior consistent for desktop and phone.

## Tasks

- [x] Audit installation/startup, IPC, PTY, Git paths, providers/processes and installer lifecycle; distinguish requirements from new verification.
- [x] Reproduce forced-poll overlap, refused stops and Terminal-shell ancestry with failing tests; implement minimal fixes and rerun ports.
- [x] Reproduce optional PR reads obstructing close; cancel the reader before draining commands; test a real child plus retained-write/failed-save regressions.
- [x] Test installer stop waiting for save/disconnect, absent host, failed save, auth refusal and timeout; implement the installer-owned helper and NSIS hook.
- [x] Add opt-in Windows-only native installation/reinstallation/uninstallation coverage, default-profile live host and installed PTY checks, without triggering the publication workflows.
- [x] Run required checks on final changes; record PASS/FAIL/SKIP accurately. Focused regressions: 143/143; typecheck/lint/format/knip pass. Full Linux suite: 3,250 pass, 8 fail, 1 cancelled, 12 skipped; bounded at 180 seconds. Electron check blocked by the local sandbox configuration.
- [x] Fresh review and fix findings: restore NSIS process-info dependencies and pin POSIX port fixtures to their intended platform (simulated Windows: 17/17). Draft delivery and CI are recorded in the PR.
- [ ] Verify final-SHA Windows native and NSIS jobs; diagnose recoverable failures before finishing.

## Review focus

- Older in-flight listener reads must not overwrite a stop's forced refresh.
- PID identity refusal must not claim a successful stop or kill a reused PID.
- Stop Port must leave a Chat's interactive Terminal shell available.
- Shutdown must cancel optional network metadata while retaining accepted writes and failed-save ownership.
- NSIS must stop and save a retained default-profile host, fail closed on errors, and preserve data through Unicode-path reinstall/uninstall.
