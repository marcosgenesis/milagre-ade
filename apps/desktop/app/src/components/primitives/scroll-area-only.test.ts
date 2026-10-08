import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

// Scroll lists go through primitives/ScrollArea, and the one scrollbar look lives in styles.css.
const SRC = join(import.meta.dirname, "..", "..");
const OWNER = join(import.meta.dirname, "ScrollArea.tsx");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".tsx") && path !== OWNER ? [path] : [];
  });
}

function offenders(pattern: RegExp) {
  return sources(SRC).flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .flatMap((line, index) => (pattern.test(line) ? [`${relative(SRC, path)}:${index + 1}`] : [])),
  );
}

test("no component wires scroll edge fades by hand", () => {
  assert.deepEqual(offenders(/useScrollFade\(|["` ]scroll-fade["` ]/), [], "Use ScrollArea from components/primitives/ScrollArea instead");
});

test("no component scrolls vertically without ScrollArea", () => {
  // Code blocks scroll both ways and a fade would hide code; the transcript has its own rail.
  const found = offenders(/overflow-(y-)?auto/).filter((at) => !at.startsWith(join("components", "agents", "message-scroller.tsx")));
  const outsidePre = found.filter((at) => {
    const [file, line] = at.split(":");
    return !/<pre\b/.test(readFileSync(join(SRC, file), "utf8").split("\n")[Number(line) - 1]);
  });
  assert.deepEqual(outsidePre, [], "Use ScrollArea from components/primitives/ScrollArea instead");
});

test("no component restyles the scrollbar", () => {
  assert.deepEqual(
    offenders(/scrollbar-color|scrollbar-width:\s*thin|-webkit-scrollbar-(thumb|track)/),
    [],
    "The scrollbar look lives in styles.css; hiding a scrollbar is fine",
  );
});
