import assert from "node:assert/strict";
import test from "node:test";
import { reuseRows, sameData, sameSet } from "./stable.ts";

test("sameSet compares members, not identity", () => {
  assert.equal(sameSet(new Set([1, 2]), new Set([2, 1])), true);
  assert.equal(sameSet(new Set([1, 2]), new Set([1, 3])), false);
  assert.equal(sameSet(new Set([1]), new Set([1, 2])), false);
});

test("sameData reads nested objects and arrays by value", () => {
  assert.equal(sameData({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(sameData({ a: [1] }, { a: [2] }), false);
  assert.equal(sameData({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(sameData([], {}), false);
});

test("reuseRows keeps unchanged rows and the list itself", () => {
  const first = [
    { id: "1", label: "a", details: { ports: [1] } },
    { id: "2", label: "b" },
  ];
  const same = reuseRows(first, [
    { id: "1", label: "a", details: { ports: [1] } },
    { id: "2", label: "b" },
  ]);
  assert.equal(same, first);
  const changed = reuseRows(first, [
    { id: "1", label: "a", details: { ports: [1] } },
    { id: "2", label: "c" },
  ]);
  assert.notEqual(changed, first);
  assert.equal(changed[0], first[0]);
  assert.notEqual(changed[1], first[1]);
});
