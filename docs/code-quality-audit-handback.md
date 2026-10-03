Code quality audit handback. Plan: `docs/superpowers/plans/2026-10-02-code-quality-audit.md`.

Review Tasks 1, 2 and 3 against their acceptance lines and the plan appendices, then close the loop with Victor. These are draft PRs, not merged. Victor clarified that the audit starts after the app phases run, without waiting for parent merges.

| PR | Work | Base |
| --- | --- | --- |
| #126 | Monorepo migration | main |
| #131 | Shared core runtime and daemon, #127 Task 1 | #126 |
| #137 | Minimal native mobile app and simulator verification | #131 |
| #139 | Audit Task 1: shared GitClient and one base rule | #137 |
| #140 | Audit Task 2: shared contracts, bridge types and error notices | #139 |
| #141 | Audit Task 3: streaming state, storage, reconciliation and polling | #140 |

Tasks 4 through 9 were not taken because Victor requested 1, 2, then 3. No dependencies were upgraded by these audit tasks. The mobile phase separately moved its Expo/React Native versions to the verified SDK 57 setup; desktop dependencies were preserved.

Disputed or amended plan findings:

- The plan calls ADR-0002 Git read/write separation. The actual ADR-0002 governs Delegation. Existing ADRs remain intact; the Git boundary is recorded in ADR-0004.
- Mobile now consumes model labels, capabilities, permission and effort copy. They remain in separate shared modules, with the desktop facade preserved.
- Complete child transcripts remain in immutable sidecars; compact summaries go in coordination.json. The extra reference preserves history rather than discarding old transcript entries. Missing sidecars retain their reference. Old versions are not garbage-collected.
- Explicit user sends, question answers, Chat edits and quit retain durability flushes outside the memory queue. Streaming changes coalesce on the 250 ms debounce.
- Current Codex 0.160 supports opaque forward/reverse pagination cursors, not a since-turn parameter. The implementation includes the last active turn so same-ID reply growth is not dropped.

The full ruling record is `docs/code-quality-audit-progress.md`. Mobile verification and remaining scope are in `docs/mobile-verification-2026-10-03.md` and `docs/mobile-local.md`.

A standalone Release app is installed in the Milagre Ready iOS 27 simulator and the Milagre Local iOS 26.2 simulator. Both use bundle com.milagre.mobile. The running host and separate Morning trial Project live at `/Users/victor/.milagre-mobile-trial-20261003`; its README has restart instructions. Never post `profile/mobile-connection.json` or its token. Real Codex/Claude host checks and a real iOS 27 Codex reply passed. Keep that host running. Remote HTTPS was tested with a temporary tunnel, now stopped. Stable remote hosting, Android and physical phones remain unverified.

Screenshots are in every visible PR description using immutable links to the orphan screenshots branch. Do not commit screenshots to code branches. Do not merge without Victor's authorization.

The single independent review of the audit stack found two Critical and five Important issues. The fix pass added regression checks and corrected migration writes outside the single writer, failed Git discovery clearing Chats, stale event publication after saves, rejected input leaving phantom runs, failed-quit cleanup/retry, partial sidecar writes, and recovery references lost during child updates. The Git discovery fix was also backported into #139 and propagated forward. No second review was requested; please review the final fixes during this handback.

Deferred minors: mobile agent-controls still has provider labels/order literals; background-only save failures reach the console until an explicit save boundary, while dirty memory is retained and failed quit now has a blocking retry screen. Sidecar retention and untrusted raw Git command exposure remain separate designs. These rulings and their costs are in the implementation record.

Handback status: Milagre native UI automation repeatedly timed out, including the running app's exact path, so this message has not been submitted to a Claude Chat. A separate Git Worktree will be prepared with this file. Use Claude Fable 5.1 in a new Milagre Chat there and send this file's contents. Do not claim the handback happened until that Chat is visible.
