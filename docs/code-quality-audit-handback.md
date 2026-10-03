Code quality audit handback. Plan: `docs/superpowers/plans/2026-10-02-code-quality-audit.md`.

Victor authorized merging the completed stack so Claude can continue from `main`. After #142 and #139/#140/#141 merge, start from current `origin/main`, verify those PRs are included, and review Tasks 1-3 against the plan acceptance lines. Do not start from the old handback Worktree without updating its base.

The completed stack contains the monorepo migration (#126), shared core and daemon (#131), native mobile app (#137), canvas (#136), shared desktop host (#142), and audit Tasks 1-3 (#139/#140/#141). The audit integration preserves the mobile review fixes, Project registry, canvas recovery and shared-host snapshot paging.

Tasks 4 through 9 were not taken because Victor requested 1, 2, then 3. No dependencies were upgraded by these audit tasks. The mobile phase separately moved its Expo/React Native versions to the verified SDK 57 setup; desktop dependencies were preserved.

Disputed or amended plan findings:

- The plan calls ADR-0002 Git read/write separation. The actual ADR-0002 governs Delegation. Existing ADRs remain intact; the Git boundary is recorded in ADR-0004.
- Mobile now consumes model labels, capabilities, permission and effort copy. They remain in separate shared modules, with the desktop facade preserved.
- Complete child transcripts remain in immutable sidecars; compact summaries go in coordination.json. The extra reference preserves history rather than discarding old transcript entries. Missing sidecars retain their reference. Old versions are not garbage-collected.
- Explicit user sends, question answers, Chat edits and quit retain durability flushes outside the memory queue. Streaming changes coalesce on the 250 ms debounce.
- Current Codex 0.160 supports opaque forward/reverse pagination cursors, not a since-turn parameter. The implementation includes the last active turn so same-ID reply growth is not dropped.

The full ruling record is `docs/code-quality-audit-progress.md`. Mobile verification and remaining scope are in `docs/mobile-verification-2026-10-03.md` and `docs/mobile-local.md`.

A standalone Release app is installed in the Milagre Ready iOS 27 simulator and the Milagre Local iOS 26.2 simulator. Both use bundle com.milagre.mobile. The running host and separate Morning trial Project live at `/Users/victor/.milagre-mobile-trial-20261003`; its README has restart instructions. Never post `profile/mobile-connection.json` or its token. Real Codex/Claude host checks and a real iOS 27 Codex reply passed. Keep that host running. Remote HTTPS was tested with a temporary tunnel, now stopped. Stable remote hosting, Android and physical phones remain unverified.

Screenshots are in every visible PR description using immutable links to the orphan screenshots branch. Do not commit screenshots to code branches. Victor authorized the completed stack merges; remaining implementation scope still needs its own task selection.

The single independent review of the audit stack found two Critical and five Important issues. The fix pass added regression checks and corrected migration writes outside the single writer, failed Git discovery clearing Chats, stale event publication after saves, rejected input leaving phantom runs, failed-quit cleanup/retry, partial sidecar writes, and recovery references lost during child updates. The Git discovery fix was also backported into #139 and propagated forward. No second review was requested; please review the final fixes during this handback.

The mobile provider-label duplication was removed during integration. Deferred minor: background-only save failures reach the console until an explicit save boundary; dirty memory is retained and failed quit has a blocking retry screen. Sidecar retention and untrusted raw Git command exposure remain separate designs. These rulings and their costs are in the implementation record.

Handback status: no Claude Chat was created or given this document. Milagre native UI automation timed out during the earlier handback attempt. The old prepared Worktree at `/Users/victor/.codex/worktrees/milagre-audit-handback-claude` is stale. Victor's latest direction is for Claude to continue from merged `main`, with this document as context.

Remaining work includes mobile Tasks 4 and 5, the relay and production service installation, Android/physical-device verification, authorized retrieval of stored host images, upload reuse/cleanup, and large-history virtualization. Audit Tasks 4-9 are a separate unimplemented scope. Check the issue tracker and mobile/shared-host plans before selecting the next task; no pending milestone is claimed complete by these merges.

The earlier Paseo maintenance schedule `361d56a6` was configured to check the draft stack hourly through October 10 at 01:31 UTC. Its current status was not changed or verified by the integration pass. Before relying on it, check whether it should be retired now that work is moving to `main`.
