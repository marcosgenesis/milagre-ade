import assert from "node:assert/strict";
import test from "node:test";
import type { ModelOption } from "../model";
import { handoverBlocker, handoverModel, otherProvider } from "./handover.ts";

test("the other provider", () => {
  assert.equal(otherProvider("claude"), "codex");
  assert.equal(otherProvider("codex"), "claude");
});

test("a running turn blocks handover before a CLI problem does", () => {
  assert.equal(handoverBlocker({ running: true, cli: "Codex isn't installed." }), "Stop the turn or wait for it to finish to hand over.");
  assert.equal(handoverBlocker({ running: false, cli: "Codex isn't installed." }), "Codex isn't installed.");
  assert.equal(handoverBlocker({ running: false, cli: null }), null);
});

const option = (id: string, provider: "claude" | "codex"): ModelOption => ({ id, name: id, provider, description: "" });
const catalog = [option("claude-opus-5-5", "claude"), option("codex-a", "codex"), option("codex-b", "codex")];
const message = (session_id: number, model: string) => ({ id: session_id, session_id, body: "hi", context: null, role: "assistant" as const, model });

test("a handover picks the last model used on that provider in the project, else its first", () => {
  const [claude, first, second] = catalog;
  assert.equal(handoverModel(claude, "codex", [message(1, "claude-opus-5-5"), message(2, "codex-b")], catalog), second);
  assert.equal(handoverModel(claude, "codex", [message(1, "claude-opus-5-5")], catalog), first);
  assert.equal(handoverModel(claude, "codex", [], [claude]), undefined);
});
