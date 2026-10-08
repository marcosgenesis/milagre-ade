# Main branch sync

Date: 2026-10-08. Status: approved design, awaiting spec review.

## Goal

Before Milagre creates a new Worktree, it brings the Project's main branch up to date with its remote, the
way Orca and Paseo keep the base current. Local `main` fast-forwards to `origin/main`, and when the main
checkout has `main` checked out and is clean, its files update too. Nothing is ever merged, rebased or
stashed: anything that isn't a clean fast-forward is skipped and reported.

Today the only fetch happens in `resolveStartRef` (`packages/core/src/worktrees.cjs:16`). It moves
`refs/remotes/origin/main` so new Worktrees can start from it, but local `main` and the main checkout stay
wherever they were, and nothing in the codebase ever pulls.

## Decisions

| Question | Decision |
| --- | --- |
| What gets updated | Local main branch ref, plus the files of the Worktree that has it checked out when that Worktree is clean. |
| When it runs | Only right before a new Worktree is created (`worktree:create`). No timer, no focus trigger, no manual button. |
| Which bases trigger it | Every new Worktree, whatever base was picked. When the base is main, the Worktree starts from the synced commit. |
| Default | A global default (off) plus a per-Project override (on, off, or follow the default). |
| Feedback | A status line in Project settings with the last result. No toasts, no notifications. |
| Platforms | Desktop and mobile in the same PR. Mobile is JS only and ships over the air. |

## Domain

"Main branch" joins `GLOSSARY.md`: the branch a Project's remote names as its default (`origin/HEAD`), falling
back to `main`, then `master`, exactly as `resolveBase` already decides (`packages/core/src/git/client.cjs:112`).
It is a branch, not a Worktree; "the main checkout" stays the name for the Project's first Worktree.

## Sync algorithm

New module `packages/core/src/main-sync.cjs`, exporting `syncMainBranch(projectPath, { git })`. It resolves to
a result and never throws:

```js
type MainSyncResult = {
  at: number;            // epoch ms
  outcome: "updated" | "up-to-date" | "skipped" | "failed";
  branch: string;        // e.g. "main"
  commit?: string;       // short SHA local main points at afterwards
  message?: string;      // why it skipped or failed, shown to the user
};
```

Steps:

1. **Name the branch.** `resolveBase(projectPath)` gives `name`. If `refs/heads/<name>` doesn't exist, the
   result is `skipped` with "No local <name> branch".
2. **Find its upstream.** `for-each-ref --format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:short)`
   on `refs/heads/<name>`, as `resolveStartRef` does. No upstream, or an upstream that is a local branch (`.`):
   `skipped`, "<name> has no remote branch".
3. **Fetch.** `git fetch --quiet <remote> +<remoteRef>:refs/remotes/<tracking>` with the `NETWORK` profile
   (30 s). Failure: `failed`, with git's first stderr line ("Could not reach origin" when it is a network error).
4. **Compare.** Local and tracking point at the same commit: `up-to-date`. Local isn't an ancestor of tracking
   (`merge-base --is-ancestor`): `skipped`, "<name> has commits that aren't on <remote>".
5. **Find the checkout.** `git for-each-ref --format=%(worktreepath) refs/heads/<name>` names the Worktree that
   has the branch checked out, or nothing.
6. **Not checked out anywhere:** `git update-ref refs/heads/<name> <new> <old>`. The old value makes it a
   compare-and-swap, so a commit that lands in between makes it fail (`skipped`, "<name> moved during sync").
7. **Checked out:** in that Worktree, `git status --porcelain=v1 --untracked-files=no` must be empty and no
   merge, rebase, cherry-pick or bisect may be in progress (check for `MERGE_HEAD`, `rebase-merge`,
   `rebase-apply`, `CHERRY_PICK_HEAD`, `BISECT_LOG` in its git dir). Otherwise `skipped`, "The main checkout has
   uncommitted changes" (or "... is in the middle of a merge/rebase"). Clean: `git merge --ff-only --quiet
   <tracking>`. If git refuses (an untracked file would be overwritten), `skipped` with git's message.
8. Success: `updated`, with the new short SHA.

All git calls go through `createGit()` (ADR-0004). `fetch`, `update-ref` and `merge` use `client.write`;
reads use `client.read`. `GIT_TERMINAL_PROMPT=0` and SSH `BatchMode=yes` already keep git from prompting.

### Concurrency

The runtime holds one in-flight promise per Project path. A second `worktree:create` for the same Project while
a sync runs awaits that promise instead of starting another one.

### Interaction with `resolveStartRef`

`resolveStartRef` stays as is. After a successful sync, local `main` equals `origin/main`, its fetch is a cheap
no-op, and its ancestor check returns the tracking ref, which points at the same commit. When sync is off or
skipped, behavior is exactly today's.

## Settings

Stored daemon-side in `<dataDir>/project-settings.json` (`packages/core/src/project-settings.cjs`), because the
renderer's `localStorage` settings are out of the daemon's reach.

```json
{
  "defaults": { "syncMain": false },
  "projects": {
    "/path/to/repo": {
      "syncMain": true,
      "mainSync": { "at": 1760000000000, "outcome": "updated", "branch": "main", "commit": "a1b2c3d" }
    }
  }
}
```

- `defaults.syncMain`: global default, `false` when absent.
- `projects[path].syncMain`: per-Project override. Absent means "follow the default"; saving "default" deletes it,
  so an entry left empty is still removed as today.
- `projects[path].mainSync`: last result. Written after every sync, so the status survives restarts.

`read()` keeps accepting files without `defaults`. `update()` must preserve `defaults` when it rewrites the file.

New store methods:

- `getMainSync(projectPath)` returns `{ override: boolean | null, defaultValue: boolean, enabled: boolean, last: MainSyncResult | null }`.
- `setMainSyncOverride(projectPath, value: boolean | null)`.
- `setMainSyncDefault(value: boolean)`.
- `recordMainSync(projectPath, result)`.

## Daemon commands and events

In `packages/core/src/runtime.cjs`, next to the `worktree-setup:*` handlers:

| Command | Arguments | Returns |
| --- | --- | --- |
| `main-sync:read` | `projectPath` | `getMainSync` result, plus the resolved branch name |
| `main-sync:save` | `projectPath, override` (`true`, `false` or `null`) | `getMainSync` result |
| `main-sync:default:read` | none | `{ syncMain: boolean }` |
| `main-sync:default:save` | `value` | `{ syncMain: boolean }` |

`worktree:create` calls the sync after `environmentReady` and before `createWorktree`, when `enabled` is true.
After each sync the runtime records the result and emits `main-sync:status` with `{ projectPath, last }`.

Phone access: add the four commands to `METHODS` in `apps/daemon/src/mobile-bridge.cjs` and to the rules in
`apps/daemon/src/confine.cjs` (`([projectPath]) => [projectPath]` for the per-Project two, `none` for the
default pair). The phone doesn't get `main-sync:status`: the bridge only forwards events for subscribed Projects,
so the phone's Project settings screen re-reads `main-sync:read` whenever it gains focus.

## UI

Copy is shared between platforms.

**Global default**
- Desktop: Settings > General, a switch labeled "Sync main branch before new Worktrees", with the hint "Fast-forwards
  main from its remote. Skipped when main has local changes or commits."
- Mobile: same switch and hint in `apps/mobile/src/app/settings.tsx`.

**Per Project**
- Desktop: a "Main branch" group in `ProjectSettings` (`apps/desktop/app/src/components/Settings.tsx:1032`), with a
  `primitives/Select` offering "Default (On|Off)", "On" and "Off". The label names the branch: "Sync main before
  new Worktrees".
- Mobile: the same three choices in `apps/mobile/src/app/project-settings.tsx`, using the native menu the screen
  already uses.
- Below the control, the status line, refreshed by `main-sync:status`:
  - `updated`: "Synced main 3 min ago (a1b2c3d)"
  - `up-to-date`: "main was up to date 3 min ago"
  - `skipped`: "Skipped 3 min ago: The main checkout has uncommitted changes"
  - `failed`: "Couldn't sync 3 min ago: Could not reach origin"
  - none yet: "Not synced yet"

## Error handling

- Sync never fails `worktree:create`. Any thrown error inside the module becomes `outcome: "failed"`.
- The worst-case delay a sync adds is the 30 s network timeout when the remote is unreachable, the same bound
  `resolveStartRef` already has.
- `project-settings.json` write failures while recording a result are logged and ignored.

## Testing

Unit tests (`packages/core/src/main-sync.test.cjs`), each against a temporary repo with a bare remote:

1. Main not checked out anywhere, behind: ref fast-forwards, `updated`.
2. Main checked out in a clean main checkout, behind: files and ref fast-forward.
3. Already up to date: `up-to-date`, no write.
4. Local main has its own commit: `skipped`, ref unchanged.
5. Main checkout has a modified tracked file: `skipped`, files unchanged.
6. Main checkout mid-merge: `skipped`.
7. Remote unreachable: `failed`, nothing changes.
8. No upstream: `skipped`.
9. Untracked file in the way of the fast-forward: `skipped` with git's message.

Settings tests (`project-settings.test.cjs`): default precedence, override set and cleared, `defaults` kept across
per-Project saves, old files without `defaults`.

Runtime test: `worktree:create` runs the sync when enabled, skips it when disabled, and still creates the
Worktree when the sync fails.

Electron check for the Settings screen (General switch, Project group, status line). Mobile checked on a
simulator: both switches save, and the status line shows the last result.

## Out of scope

- Periodic or focus-triggered syncs, and a "Sync now" button.
- Syncing branches other than main, or updating other Worktrees.
- Notifications or toasts for sync results.
