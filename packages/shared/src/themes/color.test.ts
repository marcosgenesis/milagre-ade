import assert from "node:assert/strict";
import test from "node:test";
import { contrastRatio, fromOklch, hexToOklch, isHex, mix, oklchToHex, withAlpha } from "./color.ts";

test("round-trips hex through OKLCH", () => {
  for (const hex of ["#000000", "#ffffff", "#0285ff", "#1e1e2e", "#cba6f7", "#e3474c"]) assert.equal(oklchToHex(hexToOklch(hex)), hex);
});

test("matches known OKLCH values", () => {
  // Desktop's dark accent, oklch(0.68 0.173 253.301), is #3d9aff on the phone today.
  assert.equal(fromOklch(0.68, 0.173, 253.301), "#3d9aff");
  const white = hexToOklch("#ffffff");
  assert.ok(Math.abs(white.l - 1) < 0.001 && white.c < 0.001);
});

test("mix and alpha", () => {
  assert.equal(mix("#000000", "#ffffff", 0), "#000000");
  assert.equal(mix("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(withAlpha("#3d9aff", 0.16), "#3d9aff29");
  assert.equal(withAlpha("#3d9aff29", 1), "#3d9aff");
});

test("WCAG contrast", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(contrastRatio("#777777", "#777777"), 1);
});

test("isHex accepts 6 and 8 digit hex only", () => {
  assert.ok(isHex("#a1b2c3") && isHex("#a1b2c3ff"));
  for (const bad of ["#12", "red", "a1b2c3", "#ggg000", 3, null]) assert.equal(isHex(bad), false);
});
