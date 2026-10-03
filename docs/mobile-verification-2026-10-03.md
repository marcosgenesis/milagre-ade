# Mobile readiness verification, 2026-10-03

The native simulator app controls real Milagre agents without Metro. The original readiness checks below were recorded at `a9452ca` (CI `37094244399`). The native composer update is based on main after #126, #131 and #136 merged; its implementation at `73b26e7` passed CI `37122974145`.

## Verified

- Installed Codex 0.160.0 and Claude Code 2.1.288 completed through mobile HTTP/socket/core. The opt-in `scripts/check-mobile-providers.cjs --run` verified provider IDs, Chats, replies and the private token survive host restart.
- Standalone local and HTTPS send/reply, questions, approvals, Stop, secure-store restart and Forget passed. The temporary Cloudflare tunnel was stopped. Missing/wrong token returned 401; browser Origin returned 403.
- Worktree creation, draft transfer, model controls and real Git diff passed in the native app. Rename/archive/restore also passed in Expo Go. The asynchronous form regression suite covers late completion after navigation and prompt edits during Worktree creation.
- The Release artifact built with Xcode 27.0 launches on iOS 26.2 and 27. A real Codex follow-up and saved-connection restart passed on iOS 27. Expo 57's documented scene support fixed a reproduced native startup trap on iOS 27.
- Mobile tests (24), types, lint, export, daemon and root compatibility suites passed. Mac arm64 DMG/ZIP packaging, signature/archive checks, source/packaged saved-state smoke and the sidebar CI fixture passed. Existing dependency versions, sources and integrity values remain unchanged.

## Trial left ready

The dedicated Milagre Ready iPhone 17 Pro simulator (iOS 27) has Milagre Local installed and connected to the separate Morning trial Project. The older Milagre Local simulator (iOS 26.2) also has the final build. Host and restart instructions are under `~/.milagre-mobile-trial-20261003/README.md`; the private connection file is not committed. Only this session's automation services were stopped and its temporary Argent secret removed.

Remote HTTPS needs a configured running endpoint; the test tunnel is no longer running. Desktop and mobile cannot own one Project simultaneously yet. Android, physical phones, store distribution, encrypted relay, QR pairing, push, voice and background service installation remain outside this milestone. Notarization, Intel packaging and installed updater behavior are unverified.

## Independent review

One fresh reviewer inspected the whole mobile-readiness increment. Both Important findings were reproduced in failing tests and fixed in one pass: stale form completion after navigation and loss of a newer draft while creating a Worktree. No second review was dispatched. The final native scene fix was verified by the executor on both simulator runtimes.

## Rulings, in order

- Ruling: Continue #137 in this isolated worktree under the user's overnight authorization; no repeated design/publish gates. Cost if wrong: split the increment later.
- Ruling: Support an existing TLS proxy/tunnel rather than a new encrypted relay. Cost: TLS provider can see traffic, documented; no claim of Paseo E2EE.
- Ruling: Prioritize real app readiness before the audit as the user requested overnight. Audit Tasks 1/2/3 and Claude Fable 5.1 handback remain queued.
- Ruling: A configured TLS proxy must rewrite Host to loopback; no additional public HTTP host/listener is accepted by the bridge. Cost if wrong: proxy setup must be corrected; auth remains fail-closed.
- Ruling: Share the existing diff types between desktop and mobile instead of duplicating the wire contract. Cost if wrong: revise the shared export; runtime payloads unchanged.
- Ruling: Render at most 600 diff lines with an explicit full-diff-on-computer message, retaining server binary/1 MiB limits. Cost: large diffs require desktop review.
- Ruling: Task 3 simulator-only native compilation overlapped the end of Task 2 UI verification; it did not install or change the simulator. Cost if source changes later: rebuild the release bundle before final validation.
- Ruling: The configured ngrok endpoint was occupied (ERR_NGROK_334); left it untouched and used an account-free Cloudflare Quick Tunnel against only the temporary demo Project. Cost: random endpoint changes each run, TLS terminates at Cloudflare. Tunnel stopped after authenticated HTTPS status/snapshot, 401 missing/wrong token, 403 browser Origin, and native send/reply passed.
- Final: Ruling: upstream #135 CI behavior was excluded by reviewer; retain upstream implementation and verify its existing sidebar fixture. Cost if wrong: upstream CI regression needs a separate fix.
- Final: Ruling: Android and physical-device behavior were not reviewed; keep both explicitly unverified, with iOS simulator as this milestone. Cost: device-specific work remains.
- Final: Ruling: native responsiveness, screenshots and persistent host handoff require executor verification because reviewer was read-only. Complete real-run checks and document any limits; cost: no second independent UI run.
- Ruling: XcodeBuildMCP and Argent expose no simulator-create operation; Device Hub UI timed out. Used simctl only to discover/create a fresh dedicated simulator, retaining the original device and other projects' devices. Cost: one extra disposable simulator. The iOS26.2 service returned Mach server-died after in-place reinstall; sample showed app main/JS threads idle, and home-screen AX also timed out.
- Ruling: Add SDK-compatible expo-build-properties for the reproduced iOS27 startup crash. Cost: one config plugin dependency and native regeneration; existing dependency versions remain unchanged. Native crash is the RED reproduction, both iOS26.2/27 launches are the required GREEN checks. This is executor-discovered verification work, not another review pass.

## Deferred minors

- Final: minor (deferred): returned Worktree setupNote is not surfaced when configuration was ignored; use desktop setup details for this warning.
- Final: minor (deferred): iOS27 still offers its system Save Password dialog despite autofill off; chose Not Now. App Remember/Forget is verified platform secure storage.

## Native composer pass

Added semantic light/dark colors, system controls, model/effort/permission sheet, photo/file attachment menu, Markdown, expandable tool output, live activity, agent counts and PR blockers. Shared desktop reply/streaming/PR helpers keep their behavior.

Verified on iOS 26.2: rebuilt standalone Release app installs without clearing saved credentials, reconnects to Morning trial and renders its existing real replies. Native Files picker opens and cancels. Expo Go opens the native model menu, selects and compresses a Photo Library image, sends it through the real HTTP/socket/core demo, and displays the stored photo and reply. The labeled demo's tool response exercises Markdown and failed-tool state; it uses no provider account. Native source tests cover upload privacy/bounds and failed-send draft retention.

Final checks at `73b26e7`: 38 mobile tests, mobile types/lint, desktop build, 1,009 shared/core/desktop/daemon tests, 232 UI tests, 3 workspace checks, 15 release checks, and the standalone iOS Release build pass. One earlier full-suite run hit the existing 300 ms process-start timing assumption in worktree-setup; its 12 focused tests and the complete rerun passed without a code change.

Independent review found three issues fixed before merging: reused empty Chats now keep destination drafts; PR polling is deduplicated and capped at two requests on focused foreground screens; path-only photos after the persistence audit show a filename and desktop-view hint. The image-fetch route and abandoned-upload cleanup remain pending. The running Morning trial host predates PR-status/upload routes, so the updated app correctly shows PR status unavailable there until that host is restarted from current code. Its live process was preserved.
