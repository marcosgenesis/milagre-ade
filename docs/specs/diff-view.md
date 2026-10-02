# Changes panel and diff view

Part of #11. Read-only first step: see what a chat's worktree changed, file by file. Accept/reject per hunk (#11) and line comments (#47) build on this later.

Modelled on Paseo (`getpaseo/paseo`): git CLI in the main process, our own patch parser, our own renderer. No diff library. Highlighting reuses `app/src/components/markdown/highlighter.ts` (shiki).

## UX

- A toggle button at the top right of the window (inside the 40px drag strip, `[-webkit-app-region:no-drag]`) and `⌘⇧D` open and close the **Changes panel**: a 320px column on the right of `<main>`, same card styling as the sidebar. Only in the chat view, only when the selected chat has a folder.
- Panel header: a mode picker (`Uncommitted` / `Committed`, using `primitives/Select` or `Picker`), the total `+N −M`, and a refresh button. `Committed` shows the base name under it, e.g. `main`.
- Below: a file tree. Folders collapse; a folder that holds a single folder is merged into one row (`src/components/Calendar`). Each file row: language-neutral file icon, name, `+N −M`, a status letter (A/M/D/R, colours as in `GitActionsDialog`). Folder rows show their summed `+N −M`.
- Clicking a file switches the main area from the chat to the **Diff view** and scrolls to that file. A two-tab strip above the main area (`Chat` / `Diff`) switches back. The Diff tab only exists while the panel has been used for this chat; closing the panel returns to Chat.
- Diff view: every changed file stacked, each with a sticky header (name, dim folder path, `+N −M`, collapse chevron). Toolbar at the top right: Unified/Split toggle, Wrap lines toggle, refresh. Both toggles persist in localStorage (`milagre:diff-layout`, `milagre:diff-wrap`).
- Unified: old and new line numbers in two gutters, `+`/`-` marker column, red/green row tint, darker tint on the changed words. Hunk headers (`@@ -12,7 +12,7 @@`) as dim separator rows.
- Split: old on the left, new on the right, removed/added lines paired row by row within each change block, empty filler on the shorter side.
- Big files: a file over 3,000 diff lines or 1 MB of patch shows "This diff is large" and a "Show diff" button. Binary files show "Binary file". Files load lazily as they scroll near the viewport (IntersectionObserver), at most 4 requests in flight.
- Refreshes when the panel opens, when the mode changes, on the refresh button, and when the chat's turn ends (the same moment `useWorktreeDiffs` refreshes).

## Main process: `electron/git-diff.cjs`

`createGitDiff({ execFile, env })`, injectable like `git-actions.cjs`. Excludes `PATHSPEC` from `diffstat.cjs`. Two functions, registered in `git-ipc.cjs` through the existing `folder()` check:

```ts
type DiffMode = "uncommitted" | "committed";

// git:diff-files
listDiffFiles({ cwd, base, mode }): Promise<
  | { isRepo: false; message: string }
  | { isRepo: true; base: string | null; files: DiffFileEntry[] }
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
- `committed`: resolve the base as `resolveBase` does in `git-actions.cjs` (recorded base, then `origin/HEAD`, then main/master); `mergeBase = git merge-base <ref> HEAD`; diff `mergeBase HEAD`. `base` in the reply is the branch name. No base ref: empty file list, `base: null`.
- File list: `--name-status -z -M` plus `--numstat -z -M`, joined by path. Binary when numstat reports `-\t-`. Cap at 1,000 files.
- Patch: `git diff --no-color --no-ext-diff -M -U3 <refs> -- :(literal)<path>` (and `:(literal)<oldPath>` for renames). `tooLarge` when the output passes 1 MB; then `patch` is empty.
- Paths come from git's list; `readDiffFile` rejects a `path` that is absolute or contains `..` segments.

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
- `useDiffFiles.ts`: loads the list and the patches, caches patches per `(cwd, mode, path, added, removed)`.

Window API: `window.milagre.git.diffFiles(request)` and `window.milagre.git.diffFile(request)`, in `preload.cjs` and `electron.d.ts`.

Styling: tokens from `styles.css` only (`bg-surface`, `text-ink-3`, `text-green`, `text-red`, `border-line` …). Add `--diff-add`, `--diff-add-word`, `--diff-remove`, `--diff-remove-word` CSS vars for light and dark. Mono 12px, line height 20px.

UI check: `scripts/test-diff-view.cjs` (pattern of `test-sidebar-pr.cjs`), `npm run test:diff-view`. Stubs `window.milagre.git.diffFiles/diffFile` and checks: tree renders with merged folders and counts, clicking a file opens the Diff tab, unified shows both gutters, split pairs rows, large file shows the button, mode switch refetches.
