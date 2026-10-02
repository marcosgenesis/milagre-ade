import assert from "node:assert/strict";
import test from "node:test";
import { handoverBlocker, otherProvider } from "./handover.ts";

test("the other provider", () => {
  assert.equal(otherProvider("claude"), "codex");
  assert.equal(otherProvider("codex"), "claude");
});

test("a running turn blocks handover before a CLI problem does", () => {
  assert.equal(handoverBlocker({ running: true, cli: "Codex isn't installed." }), "Stop the turn or wait for it to finish to hand over.");
  assert.equal(handoverBlocker({ running: false, cli: "Codex isn't installed." }), "Codex isn't installed.");
  assert.equal(handoverBlocker({ running: false, cli: null }), null);
});
