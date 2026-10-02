import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

// A native <select> opens macOS's own menu; every choice goes through primitives/Select.
const SRC = join(import.meta.dirname, "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx|ts|html)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

test("no component renders a native <select>, <option> or <optgroup>", () => {
  const offenders = sources(SRC).flatMap((path) =>
    readFileSync(path, "utf8").split("\n").flatMap((line, index) =>
      /<(select|option|optgroup)[\s>]/.test(line) ? [`${relative(SRC, path)}:${index + 1}`] : [],
    ),
  );
  assert.deepEqual(offenders, [], "Use Select from components/primitives/Select instead");
});
