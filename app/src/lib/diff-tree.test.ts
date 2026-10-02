import assert from "node:assert/strict";
import test from "node:test";
import { buildDiffTree } from "./diff-tree.ts";

const f = (path: string, added = 1, removed = 0) => ({ path, added, removed });

test("merges a chain of single-child folders into one row", () => {
  const tree = buildDiffTree([f("packages/app/src/Calendar/A.tsx", 4, 1), f("packages/app/src/Calendar/B.tsx", 2, 3)]);
  assert.equal(tree.length, 1);
  const folder = tree[0];
  assert.equal(folder.type, "folder");
  if (folder.type !== "folder") return;
  assert.equal(folder.name, "packages/app/src/Calendar");
  assert.equal(folder.path, "packages/app/src/Calendar");
  assert.deepEqual([folder.added, folder.removed], [6, 4]);
  assert.deepEqual(folder.children.map((c) => c.name), ["A.tsx", "B.tsx"]);
});

test("stops merging where a folder branches or holds a file", () => {
  const tree = buildDiffTree([f("src/a/x.ts"), f("src/b/y.ts"), f("lib/z.ts")]);
  assert.deepEqual(tree.map((n) => n.name), ["lib", "src"]);
  const src = tree[1];
  assert.equal(src.type === "folder" && src.children.map((c) => c.name).join(), "a,b");
  const mixed = buildDiffTree([f("src/only/x.ts"), f("src/top.ts")]);
  assert.equal(mixed[0].name, "src");
});

test("folders come before files, each alphabetical", () => {
  const tree = buildDiffTree([f("z.ts"), f("b/x.ts"), f("a.ts"), f("a/x.ts")]);
  assert.deepEqual(tree.map((n) => n.name), ["a", "b", "a.ts", "z.ts"]);
});

test("sums counts through nested folders", () => {
  const tree = buildDiffTree([f("a/b/x.ts", 1, 2), f("a/b/y.ts", 3, 4), f("a/z.ts", 5, 6)]);
  const a = tree[0];
  assert.ok(a.type === "folder");
  if (a.type !== "folder") return;
  assert.deepEqual([a.added, a.removed], [9, 12]);
  const b = a.children[0];
  assert.ok(b.type === "folder");
  if (b.type === "folder") assert.deepEqual([b.added, b.removed], [4, 6]);
});

test("root files stay at the top and an empty list is an empty tree", () => {
  assert.deepEqual(buildDiffTree([]), []);
  assert.equal(buildDiffTree([f("README.md")])[0].type, "file");
});
