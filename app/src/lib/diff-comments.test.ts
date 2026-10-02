import assert from "node:assert/strict";
import test from "node:test";
import { parsePatch } from "./diff-parse.ts";
import { formatCommentsMessage, isOutdated, labelFor, locateComment, selectionFromRows, type DiffComment } from "./diff-comments.ts";

const PATCH = "@@ -1,4 +1,4 @@\n a\n-b\n-c\n+B\n+C\n d\n";
const [hunk] = parsePatch(PATCH);
const comment = (selection: NonNullable<ReturnType<typeof selectionFromRows>>, body = "note"): DiffComment => ({ id: "1", path: "src/a.ts", body, createdAt: 0, ...selection });

test("a unified range keeps every row and takes the new side's numbers", () => {
  assert.deepEqual(selectionFromRows(hunk, 1, 3), { side: "new", start: 2, end: 2, snippet: ["-b", "-c", "+B"] });
  const selection = selectionFromRows(hunk, 0, 3)!;
  assert.deepEqual([selection.side, selection.start, selection.end, selection.snippet], ["new", 1, 2, [" a", "-b", "-c", "+B"]]);
});

test("removed rows alone are labelled by the old side", () => {
  const selection = selectionFromRows(hunk, 2, 1)!;
  assert.deepEqual([selection.side, selection.start, selection.end, selection.snippet], ["old", 2, 3, ["-b", "-c"]]);
});

test("a split range keeps only its own column", () => {
  const selection = selectionFromRows(hunk, 0, 5, "new")!;
  assert.deepEqual([selection.side, selection.start, selection.end, selection.snippet], ["new", 1, 4, [" a", "+B", "+C", " d"]]);
  assert.deepEqual(selectionFromRows(hunk, 1, 2, "new"), undefined);
});

test("a comment finds its rows again and goes outdated when they change", () => {
  const mixed = comment(selectionFromRows(hunk, 1, 3)!);
  assert.deepEqual(locateComment(mixed, [hunk]), { hunk: 0, lines: [1, 2, 3] });
  assert.equal(isOutdated(mixed, [hunk]), false);
  assert.equal(isOutdated(mixed, parsePatch("@@ -1,4 +1,4 @@\n a\n-b\n-c\n+X\n+C\n d\n")), true);
  assert.equal(isOutdated(mixed, []), true);
  // The same text on other line numbers is a different place.
  assert.equal(isOutdated(comment(selectionFromRows(hunk, 3, 3)!), parsePatch("@@ -5,4 +5,4 @@\n a\n-b\n-c\n+B\n+C\n d\n")), true);
});

test("a split column comment still matches with the other column's rows between", () => {
  const column = comment(selectionFromRows(hunk, 0, 5, "new")!);
  assert.equal(isOutdated(column, [hunk]), false);
});

test("labels", () => {
  assert.equal(labelFor({ start: 12, end: 12 }), "L12");
  assert.equal(labelFor({ start: 12, end: 15 }), "L12–15");
});

test("formats the message with fences, sides and the mode", () => {
  const first = comment(selectionFromRows(hunk, 0, 3)!, "Rename this.");
  const second: DiffComment = { id: "2", path: "README.md", side: "old", start: 3, end: 3, snippet: ["-Old tagline"], body: "Keep it.", createdAt: 0 };
  assert.equal(formatCommentsMessage([first, second], { mode: "uncommitted" }), [
    "Review comments on the diff (uncommitted changes):", "",
    "1. src/a.ts, lines 1–2 (new):", "```typescript", " a", "-b", "-c", "+B", "```", "Rename this.", "",
    "2. README.md, line 3 (old):", "```markdown", "-Old tagline", "```", "Keep it.",
  ].join("\n"));
  assert.ok(formatCommentsMessage([second], { mode: "committed", base: "main" }).startsWith("Review comments on the diff (committed changes against main):"));
});

test("long snippets keep the first 40 rows", () => {
  const long: DiffComment = { id: "3", path: "x.unknown", side: "new", start: 1, end: 50, snippet: Array.from({ length: 50 }, (_, i) => `+l${i}`), body: "b", createdAt: 0 };
  const lines = formatCommentsMessage([long], { mode: "uncommitted" }).split("\n");
  assert.equal(lines[3], "```");
  assert.equal(lines[4 + 40], "… (10 more lines)");
  assert.equal(lines.filter((line) => line.startsWith("+l")).length, 40);
});
