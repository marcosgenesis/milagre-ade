import assert from "node:assert/strict";
import test from "node:test";
import { customContrast, customSource, parseCustomTheme, seedsFrom, serializeCustomTheme } from "./custom.ts";
import { buildPalette } from "./build.ts";
import { resolvePalette } from "./index.ts";
import { contrastRatio, hexToOklch, isHex } from "./color.ts";

const theme = {
  light: { background: "#ffffff", text: "#1b1b1f", accent: "#e85d9a" },
  dark: { background: "#1d1430", text: "#efe6ff", accent: "#e85d9a" },
};

test("derives a complete, readable palette from three seeds", () => {
  const p = resolvePalette("custom", "dark", theme);
  assert.equal(p.page, "#1d1430");
  assert.equal(p.accent, "#e85d9a");
  assert.ok(isHex(p.surface) && p.surface !== p.page);
  assert.ok(contrastRatio(p.ink2, p.page) >= 4.5);
  assert.equal(p.ansi.length, 16);
});

test("light palette is readable too", () => {
  const p = resolvePalette("custom", "light", theme);
  assert.ok(contrastRatio(p.ink2, p.page) >= 4.5);
});

test("same seeds give the same palette object", () => {
  assert.equal(resolvePalette("custom", "dark", theme), resolvePalette("custom", "dark", structuredClone(theme)));
});

test("status colors keep their hue but sit at the background's lightness", () => {
  const dark = customSource(theme.dark);
  const light = customSource(theme.light);
  assert.ok(contrastRatio(dark.red, theme.dark.background) >= 3);
  assert.ok(contrastRatio(light.red, theme.light.background) >= 3);
});

test("round-trips through JSON", () => {
  assert.deepEqual(parseCustomTheme(serializeCustomTheme(theme)), theme);
});

test("rejects malformed input", () => {
  for (const bad of [
    "{",
    "null",
    "[]",
    JSON.stringify({ light: theme.light }),
    JSON.stringify({ ...theme, dark: { ...theme.dark, accent: "#12" } }),
    JSON.stringify({ ...theme, light: { ...theme.light, text: "red" } }),
    JSON.stringify({ ...theme, dark: { ...theme.dark, background: "#1d1430cc" } }),
    42,
    undefined,
  ])
    assert.equal(parseCustomTheme(bad), null, String(bad));
});

test("start from a registered theme", () => {
  const seeds = seedsFrom("catppuccin-mocha");
  assert.equal(seeds.dark.background, "#1e1e2e");
  assert.equal(seeds.light.background, "#eff1f5");
});

test("contrast readout", () => {
  assert.ok(customContrast(theme.dark).text > 10);
  assert.ok(customContrast({ background: "#777777", text: "#888888", accent: "#7a7a7a" }).text < 1.5);
});

test("an undefined optional key in a source does not override the derived value", () => {
  const base = customSource(theme.dark);
  const p = buildPalette({ ...base, canvas: undefined }, "dark");
  assert.ok(isHex(p.canvas));
});

test("status colors reach 3:1 whatever the slot says about the background", () => {
  const backgrounds = {
    "dark seeds in the light slot": "#14101f",
    "light seeds in the dark slot": "#f5f1e8",
    "mid gray": "#777777",
    "near black": "#000000",
    white: "#ffffff",
  };
  for (const [name, background] of Object.entries(backgrounds)) {
    const source = customSource({ background, text: "#888888", accent: "#e85d9a" });
    for (const key of ["red", "green", "orange"] as const) assert.ok(contrastRatio(source[key], background) >= 3, `${name} ${key} ${source[key]}`);
    const [, red, green, yellow, blue] = source.ansi;
    for (const c of [red, green, blue]) assert.ok(contrastRatio(c, background) >= 3, `${name} ansi ${c}`);
    assert.ok(yellow);
  }
});

test("status colors go lighter on dark backgrounds and darker on light ones", () => {
  assert.ok(hexToOklch(customSource({ background: "#14101f", text: "#ffffff", accent: "#e85d9a" }).red).l > 0.5);
  assert.ok(hexToOklch(customSource({ background: "#f5f1e8", text: "#000000", accent: "#e85d9a" }).red).l < 0.6);
});

test("surface follows the background's lightness, not the slot", () => {
  const darkBg = resolvePalette("custom", "light", { ...theme, light: { background: "#14101f", text: "#efe6ff", accent: "#e85d9a" } });
  assert.ok(hexToOklch(darkBg.surface).l < 0.5);
  const lightBg = resolvePalette("custom", "dark", { ...theme, dark: { background: "#f5f1e8", text: "#111111", accent: "#e85d9a" } });
  assert.ok(hexToOklch(lightBg.surface).l > 0.5);
});
