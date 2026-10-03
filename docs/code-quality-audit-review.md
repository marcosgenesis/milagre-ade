# Audit Tasks 1-3: final review and fix record

One independent review covered `9d3fef0..fa87838` using GPT-6 Astra (high). It returned **not ready to merge** with two Critical and five Important findings. All seven were accepted, then addressed in one regression-test and fix pass. There was no second independent review. Victor now wants Claude to continue from merged main; no Claude Chat was created.

| Grade | Finding at reviewed revision | Fix and regression evidence |
| --- | --- | --- |
| Critical | `project-store.cjs:24`: read-time migration could overwrite an acknowledged edit during concurrent startup resume. | Reads no longer save coordination.json. Runtime migration runs through ProjectStates. Read-only migration test failed first, then passed. |
| Critical | `runtime.cjs:109`: Git discovery failure became an empty Worktree list and deleted Chats during reconciliation. | Discovery errors reject the refresh and preserve state. Real Git fixture failed first, then passed. Backported to #139 as `bc68f75`, propagated through #140/#141. |
| Important | `chat-host.cjs:95,166` and `runtime.cjs:150`: explicit flushes published stale snapshots and event order `1,2,4,5,3`. | Input is staged durably, then the current run is split and published without a disk await. Explicit edits publish before flush. Slow-save/concurrent-turn test failed first, then passed. |
| Important | `chat-host.cjs:153`: a rejected send/answer retained undelivered input and a phantom or split run. | Rejection removes pending input and restores staged session metadata without changing concurrent tokens. Rejected-send and concurrent-answer tests failed first, then passed. |
| Important | `runtime.cjs:545`: quit failure skipped agent shutdown and cached a permanently rejected close. Desktop quit anyway. | Agents stop; dirty state and ownership remain until retry. Close can retry. Desktop shows a blocking retry dialog; daemon stop rejects and permits retry. Runtime, daemon and quit-controller tests failed first, then passed; real App retry dialog captured. |
| Important | `project-content.cjs:24`: partial final-file writes poisoned subsequent saves. | Complete temporary files are published by exclusive hard link. Failed partial writes are removed and retry succeeds. ENOSPC regression failed first, then passed. |
| Important | `agent-runs.mjs:193`: live child updates dropped missing transcript references. | Updates retain references; restored full entries take precedence over compact summaries. Temporarily missing history plus new output survives save/reload. Regression failed first, then passed. |

The deferred mobile provider-label duplication was removed during stack integration. The existing console-only reporting of background save failures remains deferred; dirty state is retained, explicit saves reject, and quit provides visible recovery. No retention cleanup was introduced for immutable sidecars.

The reviewer set aside arbitrary untrusted Git arguments, sidecar garbage collection, and Tasks 4-9. Those remain separate work: fixed query APIs must precede untrusted Git access, retention needs its own policy, and Victor requested only Tasks 1-3. Full rulings and compatibility costs remain in `code-quality-audit-progress.md`.

Final verification after the fix pass: shared 52, core 697, desktop 231, daemon 8, UI 219, release 15, mobile 24 and monorepo 3 pass. Desktop/main/preload/mobile types and build pass. All 22 Electron scripts pass. Screenshot links in #141 show legacy/current images, child deltas, saved desktop Chats and failed-quit recovery.
