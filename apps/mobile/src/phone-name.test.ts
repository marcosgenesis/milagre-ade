import { test } from "node:test";
import assert from "node:assert/strict";
import { phoneNameFrom } from "./phone-name.ts";

test("the phone sends the name its owner gave it, or its model when iOS only shares a generic one", () => {
  assert.equal(phoneNameFrom("Victor's iPhone", "iPhone 16 Pro"), "Victor's iPhone");
  assert.equal(phoneNameFrom("iPhone", "iPhone 16 Pro"), "iPhone 16 Pro");
  assert.equal(phoneNameFrom("iPad", "iPad mini"), "iPad mini");
  assert.equal(phoneNameFrom("iPhone", null), "iPhone");
  assert.equal(phoneNameFrom(null, "Pixel 9"), "Pixel 9");
  assert.equal(phoneNameFrom(null, null), null);
  assert.equal(phoneNameFrom("   ", undefined), null);
  assert.equal(phoneNameFrom("x".repeat(80), null), "x".repeat(64));
});
