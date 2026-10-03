import assert from "node:assert/strict";
import test from "node:test";
import { snapSliderValue } from "./slider-value.ts";

test("snaps to the nearest step inside the range", () => {
  assert.equal(snapSliderValue(42, 10, 90, 5), 40);
  assert.equal(snapSliderValue(43, 10, 90, 5), 45);
  assert.equal(snapSliderValue(-3, 10, 90, 5), 10);
  assert.equal(snapSliderValue(120, 10, 90, 5), 90);
});

test("max stays reachable when the step does not divide the range", () => {
  assert.equal(snapSliderValue(9.9, 0, 10, 4), 10);
  assert.equal(snapSliderValue(8.5, 0, 10, 4), 8);
});

test("an empty range or a non-positive step only clamps", () => {
  assert.equal(snapSliderValue(5, 3, 3, 1), 3);
  assert.equal(snapSliderValue(7.3, 0, 10, 0), 7.3);
});
