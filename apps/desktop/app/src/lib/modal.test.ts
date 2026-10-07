import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

// Whether a modal is open is decided in one place, lib/modal.ts. A card with role="dialog" (an approval, a
// question, a popover) is not a modal: the shortcuts keep working over it. Checking the role by hand is how
// ⌘K, ⌘N and ⌘F went dead while a chat waited on the user.
const SRC = join(import.meta.dirname, "..");
const OWNER = join(import.meta.dirname, "modal.ts");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && path !== OWNER ? [path] : [];
  });
}

function offenders(pattern: RegExp) {
  return sources(SRC).flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .flatMap((line, index) => (pattern.test(line) ? [`${relative(SRC, path)}:${index + 1}`] : [])),
  );
}

test("no module decides that a modal is open by querying for it", () => {
  assert.deepEqual(offenders(/querySelector\([^)]*(\[role="dialog"\]|aria-modal="true"\]|dialog\[open\])/), [], "Use isModalOpen from lib/modal instead");
});
