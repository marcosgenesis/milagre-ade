import assert from "node:assert/strict";
import test from "node:test";
import { parsePatch } from "./diff-parse.ts";

const PATCH = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1,4 +1,4 @@ function x
 one
-two
+TWO
 three
 four
@@ -20 +20,2 @@
 keep
+extra
`;

test("numbers lines on both sides and keeps hunk metadata", () => {
  const hunks = parsePatch(PATCH);
  assert.equal(hunks.length, 2);
  assert.deepEqual([hunks[0].oldStart, hunks[0].oldLines, hunks[0].newStart, hunks[0].newLines], [1, 4, 1, 4]);
  assert.equal(hunks[0].header, "@@ -1,4 +1,4 @@ function x");
  assert.deepEqual(
    hunks[0].lines.map((l) => [l.kind, l.text, l.oldNumber, l.newNumber]),
    [
      ["context", "one", 1, 1],
      ["remove", "two", 2, undefined],
      ["add", "TWO", undefined, 2],
      ["context", "three", 3, 3],
      ["context", "four", 4, 4],
    ],
  );
});

test("a header without counts means one line", () => {
  const [, second] = parsePatch(PATCH);
  assert.deepEqual([second.oldLines, second.newLines], [1, 2]);
  assert.deepEqual(
    second.lines.map((l) => l.newNumber),
    [20, 21],
  );
});

test("ignores the no-newline marker", () => {
  const hunks = parsePatch("@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n");
  assert.deepEqual(
    hunks[0].lines.map((l) => l.kind),
    ["remove", "add"],
  );
});

test("tolerates CRLF without leaking the carriage return", () => {
  const hunks = parsePatch("@@ -1,2 +1,2 @@\r\n a\r\n-b\r\n+c\r\n");
  assert.deepEqual(
    hunks[0].lines.map((l) => l.text),
    ["a", "b", "c"],
  );
});

test("a removed line that looks like a file header stays a removal", () => {
  const hunks = parsePatch("@@ -1,2 +1,1 @@\n--- not a header\n keep\n");
  assert.deepEqual(
    hunks[0].lines.map((l) => [l.kind, l.text]),
    [
      ["remove", "-- not a header"],
      ["context", "keep"],
    ],
  );
});

test("an empty context line that lost its space is still context", () => {
  const hunks = parsePatch("@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n");
  assert.deepEqual(
    hunks[0].lines.map((l) => l.kind),
    ["context", "context", "remove", "add"],
  );
});

test("binary notices and empty patches have no hunks", () => {
  assert.deepEqual(parsePatch(""), []);
  assert.deepEqual(parsePatch("diff --git a/x b/x\nBinary files a/x and b/x differ\n"), []);
});
