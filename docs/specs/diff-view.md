# Changes panel and diff view

Part of #11. Read-only first step: see what a chat's worktree changed, file by file. Accept/reject per hunk (#11) and line comments (#47) build on this later.

Modelled on Paseo (`getpaseo/paseo`): git CLI in the main process, our own patch parser, our own renderer. No diff library. Highlighting reuses `app/src/components/markdown/highlighter.ts` (shiki).

## UX

- A toggle button at the top right of the window (inside the 40px drag strip, `[-webkit-app-region:no-drag]`) and `⌘⇧D` open and close the **Changes panel**: a 320px column on the right of `<main>`, same card styling as the sidebar. Only in the chat view, only when the selected chat has a folder.
- Panel header: a mode picker (`Uncommitted` / `Committed`, using `primitives/Select` or `Picker`), the total `+N −M`, and a refresh button. `Committed` shows the base name under it, e.g. `main`.
- Below: a file tree. Folders collapse; a folder that holds a single folder is merged into one row (`src/components/Calendar`). Each file row: language-neutral file icon, name, `+N −M`, a status letter (A/M/D/R, colours as in `GitActionsDialog`). Folder rows show their summed `+N −M`.
- Clicking a file switches the main area from the chat to the **Diff view** and scrolls to that file. A **Back** button over the diff returns to the chat (there are no Chat/Diff tabs). The diff belongs to the chat it was opened for: switching chats or hiding the panel returns to the chat. The file last clicked in the tree stays highlighted.
- The Back bar sits on the traffic-light line, with the diff toolbar at its right. With the sidebar collapsed, `<main>` starts under the window controls, so Back shifts right to clear them (it tracks `<main>`'s left edge). It paints above the drag strip so its buttons stay clickable; only the button groups opt out of dragging, so the stretch between them still moves the window.
- The diff slides in from the panel's side and out again; the chat comes back once it has left. Only the bottom edge of the scroll area fades, while there is more below, and file headers pin with a corner fill so scrolled content doesn't show behind their rounded corners.
- Diff view: every changed file stacked, each with a sticky header (name, dim folder path, `+N −M`, collapse chevron). Toolbar at the top right: Unified/Split toggle, Wrap lines toggle, refresh. Both toggles persist in localStorage (`milagre:diff-layout`, `milagre:diff-wrap`).
- Unified: old and new line numbers in two gutters, `+`/`-` marker column, red/green row tint, darker tint on the changed words. Hunk headers (`@@ -12,7 +12,7 @@`) as dim separator rows.
- Split: old on the left, new on the right, removed/added lines paired row by row within each change block, empty filler on the shorter side.
- Big files: over 3,000 changed lines a file shows "This diff is large" and a "Show diff" button (the choice survives refreshes until the folder or mode changes). A patch over 1 MB (`tooLarge`) shows a message with no button. Binary files show "Binary file". Files load lazily as they scroll near the viewport (IntersectionObserver), at most 4 requests in flight.
- Refreshes when the panel opens, when the mode changes, on the refresh button, and when the chat's turn ends (the same moment `useWorktreeDiffs` refreshes). Every list refresh drops the cached patches (an edit can keep a file's line counts); files near the viewport load again.
- `Committed` on a branch with a base ref but no merge-base shows "This branch shares no history with <base>." instead of the empty text.

## Main process: `electron/git-diff.cjs`

`createGitDiff({ execFile, env })`, injectable like `git-actions.cjs`. Excludes `PATHSPEC` from `diffstat.cjs`. Two functions, registered in `git-ipc.cjs` through the existing `folder()` check:

```ts
type DiffMode = "uncommitted" | "committed";

// git:diff-files
listDiffFiles({ cwd, base, mode }): Promise<
  | { isRepo: false; message: string }
  | { isRepo: true; base: string | null; files: DiffFileEntry[]; message?: string }  // message: no shared history
>;
type DiffFileEntry = {
  path: string;            // new path
  oldPath?: string;        // renames only
  status: "added" | "deleted" | "modified" | "renamed";
  added: number;
  removed: number;
  binary: boolean;
  untracked?: boolean;
};

// git:diff-file
readDiffFile({ cwd, base, mode, path, oldPath, untracked }): Promise<{ patch: string; binary: boolean; tooLarge: boolean }>;
```

- `uncommitted`: `git diff -M HEAD` (staged and unstaged together; empty tree `4b825dc…` before the first commit) plus untracked files from `git ls-files --others --exclude-standard -z`. An untracked file's patch is `git diff --no-index -- /dev/null <path>` (exit code 1 is success there).
- `committed`: resolve the base as `resolveBase` does in `git-actions.cjs` (a recorded base starting with `-` is ignored; recorded base, then `origin/HEAD`, then main/master); `mergeBase = git merge-base <ref> HEAD`; diff `mergeBase HEAD`. `base` in the reply is the branch name. No base ref: empty file list, `base: null`. A base ref without a merge-base: empty list, `base` set, plus `message`.
- File list: `--name-status -z -M` plus `--numstat -z -M`, joined by path. A copy entry (`C`) is reported as `added` with no `oldPath`. Binary when numstat reports `-\t-`. Cap at 1,000 files.
- Patch: `git diff --no-color --no-ext-diff --no-textconv -M -U3 <refs> -- :(literal)<path>` (and `:(literal)<oldPath>` for renames). `tooLarge` when the output passes 1 MB; then `patch` is empty.
- Paths come from git's list; `readDiffFile` rejects a `path` that is absolute or contains `..` segments.
- `untracked: true` from the renderer is not trusted. Before `--no-index`, the path must appear in `git ls-files --others --exclude-standard -z -- :(literal)<path>` (so ignored files and `.milagre` are out) and `realpath(cwd/path)` must stay inside `realpath(cwd)` (so symlinked folders are out); otherwise the reply is an empty patch.

Tests in `electron/git-diff.test.cjs` against a real temporary repo (see `diffstat.test.cjs` for the pattern): modified, added, deleted, renamed, untracked, binary, committed vs base, no commits yet.

## Renderer

Pure logic in `app/src/lib/`, each with a `node:test` sibling:

- `diff-parse.ts`: `parsePatch(patch): DiffHunk[]` with `{ header, oldStart, oldLines, newStart, newLines, lines: { kind: "context" | "add" | "remove", text, oldNumber?, newNumber? }[] }`. Ignores `\ No newline at end of file`. Tolerates CRLF.
- `diff-tree.ts`: `buildDiffTree(files)` → nested folders with summed counts, single-child folder chains merged, folders before files, alphabetical.
- `diff-layout.ts`: `splitRows(hunk)` pairs removes with adds inside each change block; `wordChanges(oldText, newText)` returns changed ranges for both sides (token LCS over `\w+|\s+|[^\w\s]`, skipped when the line pair is over 500 chars or under 40% similar).

Components in `app/src/components/changes/`:

- `ChangesPanel.tsx`: header, mode picker, tree.
- `DiffView.tsx`: toolbar plus the stacked files.
- `DiffFile.tsx`: header plus unified or split body. Syntax colours: highlight the reconstructed old and new texts per hunk with `highlight()` (language from the path via `resolveCodeLanguage`), map tokens back to line numbers, render tokens as `.code-token` spans like `CodeBlock.tsx`. Word-change ranges are applied as a background layer over the tokens.
- `useDiffFiles.ts`: loads the list and the patches, caches patches per `(cwd, mode, path, added, removed)` and drops them all on every list refresh.

Window API: `window.milagre.git.diffFiles(request)` and `window.milagre.git.diffFile(request)`, in `preload.cjs` and `electron.d.ts`.

Styling: tokens from `styles.css` only (`bg-surface`, `text-ink-3`, `text-green`, `text-red`, `border-line` …). Add `--diff-add`, `--diff-add-word`, `--diff-remove`, `--diff-remove-word` CSS vars for light and dark. Mono 12px, line height 20px.

UI check: `scripts/test-diff-view.cjs` (pattern of `test-sidebar-pr.cjs`), `npm run test:diff-view`. Stubs `window.milagre.git.diffFiles/diffFile` and checks: tree renders with merged folders and counts, clicking a file opens the diff, Back returns to the chat, unified shows both gutters, split pairs rows, large file shows the button, mode switch refetches.
