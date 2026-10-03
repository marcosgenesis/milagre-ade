import assert from "node:assert/strict";
import test from "node:test";
import { parsePatterns, previewSentence } from "./files-to-copy.ts";

test("parsePatterns keeps one trimmed pattern per non-blank line", () => {
  assert.deepEqual(parsePatterns(".env\r\n\n  secrets/*.json  \n!.env.example\n"), [".env", "secrets/*.json", "!.env.example"]);
  assert.deepEqual(parsePatterns("  \n"), []);
});

test("previewSentence lists the matches, then how many more", () => {
  assert.equal(previewSentence([]), "Matches no files.");
  assert.equal(previewSentence([".env"]), "Matches 1 file: .env");
  assert.equal(previewSentence([".env", ".env.local", "apps/web/.env"]), "Matches 3 files: .env, .env.local, apps/web/.env");
  assert.equal(previewSentence(["a", "b", "c", "d"], 2), "Matches 4 files: a, b and 2 more");
});
