import assert from "node:assert/strict";
import test from "node:test";
import type { HandoffContext } from "@milagre/shared/model";
import { handoffSides } from "./handoff-sides.ts";

const models = [
  { id: "claude-opus-5-5", name: "Opus 5.5" },
  { id: "gpt-6", name: "GPT-6" },
];

test("each side shows its model name, else its provider", () => {
  const context: HandoffContext = {
    kind: "handoff",
    from: { provider: "claude", model: "claude-opus-5-5" },
    to: { provider: "codex", model: "nope" },
    status: "done",
  };
  assert.deepEqual(handoffSides(context, models), { from: "Opus 5.5", to: "Codex", restored: false });
});

test("a handoff back to the same provider is a restore", () => {
  const context: HandoffContext = { kind: "handoff", from: { provider: "codex", model: "gpt-6" }, to: { provider: "codex" }, status: "preparing" };
  assert.deepEqual(handoffSides(context, models), { from: "GPT-6", to: "Codex", restored: true });
});
