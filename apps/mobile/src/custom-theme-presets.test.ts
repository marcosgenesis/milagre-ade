import assert from "node:assert/strict";
import test from "node:test";
import { presets } from "./custom-theme-presets.ts";
import { isHex } from "@milagre/shared/themes";

test("eight valid presets per seed and scheme", () => {
  for (const scheme of ["light", "dark"] as const)
    for (const seed of ["background", "text", "accent"] as const) {
      assert.equal(presets(scheme)[seed].length, 8);
      assert.ok(presets(scheme)[seed].every(isHex));
    }
});
