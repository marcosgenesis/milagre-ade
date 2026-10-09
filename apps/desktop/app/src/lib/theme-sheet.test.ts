import assert from "node:assert/strict";
import test from "node:test";
import { resolvePalette } from "@milagre/shared/themes";
import { themeStylesheet } from "./theme-sheet.ts";

test("writes every token, ANSI color and Shiki variable", () => {
  const css = themeStylesheet(resolvePalette("catppuccin-mocha", "dark"), "dark");
  assert.match(css, /html:root\s*\{[^}]*--page:\s*#1e1e2e;/);
  assert.match(css, /--hover-2:/);
  assert.match(css, /--line-strong:/);
  assert.match(css, /--ansi-15:/);
  assert.match(css, /--shiki-token-keyword:\s*#cba6f7;/);
  assert.match(css, /--syntax-keyword:\s*#cba6f7;/);
});

test("kebab-cases the palette keys the stylesheet names", () => {
  const css = themeStylesheet(resolvePalette("catppuccin-mocha", "dark"), "dark");
  for (const name of ["hover-2", "line-strong", "diff-add-word", "tooltip-bg", "on-accent", "accent-ink", "accent-tint"]) {
    assert.match(css, new RegExp(`--${name}:`), name);
  }
});

test("translucent variants use the theme's own page, not today's gray", () => {
  const css = themeStylesheet(resolvePalette("dracula", "dark"), "dark");
  assert.match(
    css,
    /html:root\.translucent\s*\{[^}]*--page:\s*color-mix\(in srgb, #282a36 calc\(\(1 - var\(--window-translucency, 0\.8\)\) \* 100%\), transparent\)/,
  );
  assert.match(css, /0\.95\)/);
  assert.match(themeStylesheet(resolvePalette("dracula", "light"), "light"), /0\.7\)/);
});
