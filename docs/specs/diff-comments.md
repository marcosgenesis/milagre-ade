# Diff comments

Closes #47. Builds on the diff view (`docs/specs/diff-view.md`). Leave notes on lines of the diff, collect them, and send them all to the chat in one message.

Modelled on Paseo's inline review (`getpaseo/paseo`, `packages/app/src/review/`), with two differences: a comment can cover a range of lines, and the comments go out with their own button instead of riding along with the next message.

## UX

- **Start a comment:** hovering a diff row shows a small `+` button in its gutter (unified: left of the line numbers; split: in each half's gutter). Clicking it selects that line.
- **Range:** dragging from a `+` across rows selects every row passed over; shift-clicking another row's `+` extends the current selection. A range stays inside one file and one hunk; in split it stays on one side. Selected rows get an accent tint (`accent-tint`) over their diff tint.
- **Editor:** opens inline under the last selected row, full width of the card: a textarea (autofocus, 3 rows, grows), "Cancel" and "Comment" buttons. Esc cancels, ⌘Enter saves. "Comment" is disabled while the text is blank.
- **Saved comments:** render inline under their last row as a compact card: the line label (`L12` or `L12–15`), the body (clamped to 3 lines, expands on click), edit (pencil) and delete (trash) icons. Edit swaps the card for the editor, prefilled. Several comments may sit on the same rows.
- **Outdated:** when the diff changes so the comment's lines no longer match (the file left the diff, or the lines' text differs from the snapshot), the card shows "Outdated" in `text-ink-3` and the comment is not sent. It can still be deleted.
- **Send:** next to Back in the diff bar, a button "Send N comments" (`N` = comments that are not outdated) appears when N > 0, with an accent style (it is the bar's primary action). Clicking it sends one chat message (format below) through the same path as the composer's send (a running turn is steered, like every send), removes the sent comments, and goes back to the chat so the message is visible. Outdated comments stay.
- The panel tree shows a small comment count next to files that have comments.
- Comments belong to the chat: stored per chat key in localStorage (`milagre:diff-comments:<chatKey>`), so switching chats or restarting keeps them. Switching mode (Uncommitted/Committed) keeps them; the outdated check runs against whatever is shown.

## Message format

```
Review comments on the diff (uncommitted changes):

1. app/src/App.tsx, lines 209–214 (new):
```tsx
+  const changes = useChanges({
+    cwd: selectedWorktree?.path,
```
Rename this hook to useChangesPanel.

2. README.md, line 3 (old):
```md
-Old tagline
```
Keep the old tagline.
```

- Mode label: "uncommitted changes" or "committed changes against <base>".
- Line numbers are the selected side's: `new` for added and context rows, `old` for removed rows; a unified range mixing removed and added rows is labelled by the new side when it has new numbers, otherwise old, and its snippet keeps every selected row with its `+`/`-`/` ` marker.
- The fence language comes from `resolveCodeLanguage`; none when unknown. Snippets longer than 40 lines keep the first 40 and add `… (N more lines)`.

## Code

- `app/src/lib/diff-comments.ts` (pure, with `diff-comments.test.ts`): the `DiffComment` type `{ id, path, side: "old" | "new", start, end, snippet: string[] /* rows with markers */, body, createdAt }`; `selectionFromRows(hunk, fromRow, toRow, side)`; `isOutdated(comment, hunksForPath)` (find rows with the same side/numbers and compare marker+text); `labelFor(comment)`; `formatCommentsMessage(comments, { mode, base })`.
- `app/src/components/changes/useDiffComments.ts`: per-chat store (load/save localStorage, add/update/remove/removeMany), plus the current selection and open editor state.
- `DiffFile.tsx`: gutter `+`, drag/shift selection, inline editor and comment cards. Keep `memo(DiffFile)` effective: pass the file's own comments and stable callbacks.
- `ChangesChrome.tsx`: the Send button in `DiffBar`. `App.tsx`: wire send to `executeSend(message, permissionMode, [], [], true)` and `changes.closeDiff()`.
- Check: extend `scripts/test-diff-view.cjs` (or add `scripts/test-diff-comments.cjs` with `npm run test:diff-comments`): add a single-line comment, a drag range and a shift-click range, edit and delete, the Send button count, the sent message text (stub the send), outdated after the patch changes, persistence across a remount.
