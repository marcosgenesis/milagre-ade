import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

// Backdrop blur comes in three strengths, the --blur-overlay, --blur-chip and --blur-edge tokens (see docs/agents/ui.md).
const SRC = join(import.meta.dirname, "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx|css)$/.test(entry.name) ? [path] : [];
  });
}

function offenders(pattern: RegExp) {
  return sources(SRC).flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .flatMap((line, index) => (pattern.test(line) ? [`${relative(SRC, path)}:${index + 1}`] : [])),
  );
}

test("backdrop blur uses a blur token", () => {
  assert.deepEqual(offenders(/backdrop-blur(?!-(overlay|chip|edge)\b)/), [], "Use backdrop-blur-overlay, -chip or -edge");
  assert.deepEqual(
    offenders(/backdrop-filter:\s*blur\((?!var\(--blur-(overlay|chip|edge)\))/),
    [],
    "Use blur(var(--blur-overlay)), (--blur-chip) or (--blur-edge)",
  );
});
