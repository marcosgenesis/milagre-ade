import test from "node:test";
import assert from "node:assert/strict";
import { clampMatch, findLabel, locateOffset, matchOffsets, stepMatch } from "./find-in-chat.ts";

test("matches ignore case and do not overlap", () => {
  assert.deepEqual(matchOffsets("Foo foo FOO", "foo"), [0, 4, 8]);
  assert.deepEqual(matchOffsets("aaaa", "aa"), [0, 2]);
});

test("an empty query or no occurrence has no matches", () => {
  assert.deepEqual(matchOffsets("hello", ""), []);
  assert.deepEqual(matchOffsets("hello", "xyz"), []);
});

test("offsets stay aligned when lowercasing changes the length", () => {
  assert.deepEqual(matchOffsets("İstanbul", "stan"), []);
});

test("stepping wraps in both directions", () => {
  assert.equal(stepMatch(0, 3, 1), 1);
  assert.equal(stepMatch(2, 3, 1), 0);
  assert.equal(stepMatch(0, 3, -1), 2);
  assert.equal(stepMatch(0, 0, 1), 0);
});

test("the active match is clamped when matches disappear", () => {
  assert.equal(clampMatch(5, 3), 2);
  assert.equal(clampMatch(1, 3), 1);
  assert.equal(clampMatch(4, 0), 0);
});

test("label shows position, no results, or nothing without a query", () => {
  assert.equal(findLabel("", 0, 0), "");
  assert.equal(findLabel("x", 0, 0), "No results");
  assert.equal(findLabel("x", 2, 12), "3 of 12");
});

test("offsets map back into the node they fall in, across node boundaries", () => {
  const lengths = [4, 3, 5];
  assert.deepEqual(locateOffset(lengths, 2, "start"), { index: 0, offset: 2 });
  assert.deepEqual(locateOffset(lengths, 4, "start"), { index: 1, offset: 0 });
  assert.deepEqual(locateOffset(lengths, 4, "end"), { index: 0, offset: 4 });
  assert.deepEqual(locateOffset(lengths, 12, "end"), { index: 2, offset: 5 });
});
