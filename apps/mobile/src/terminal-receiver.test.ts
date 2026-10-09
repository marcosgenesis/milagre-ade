import assert from "node:assert/strict";
import test from "node:test";
import { resolvePalette } from "@milagre/shared/themes";
import { xtermTheme } from "./terminal-receiver.ts";

test("the phone terminal uses the theme's ANSI colors", () => {
  const p = resolvePalette("dracula", "dark");
  const theme = xtermTheme({
    scheme: "dark",
    background: p.page,
    ink: p.ink,
    ink3: p.ink3,
    accent: p.accent,
    ansi: [...p.ansi],
    cursor: p.cursor,
    selection: p.selection,
  });
  assert.equal(theme.red, p.ansi[1]);
  assert.equal(theme.brightWhite, p.ansi[15]);
  assert.equal(theme.cursor, p.cursor);
  assert.equal(theme.selectionBackground, p.selection);
});
