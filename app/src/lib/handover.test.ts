import assert from "node:assert/strict";
import test from "node:test";
import type { ModelOption } from "../model";
import { handoverBlocker, handoverLinks, handoverModel, otherProvider } from "./handover.ts";

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

const sessions = {
  3: { id: 3, worktree_id: 1, agent_name: "main", status: "Created" as const, provider: "claude" as const, generatedTitle: "Fix login", handedOverTo: 7 },
  7: { id: 7, worktree_id: 1, agent_name: "main", status: "Created" as const, provider: "codex" as const, handedOverFrom: 3, handoverPending: true },
};

test("both chats link to each other by title", () => {
  const state = { sessions, messages: [] };
  assert.deepEqual(handoverLinks(sessions[3], state), { to: { id: 7, title: "main", provider: "codex" }, pending: false });
  assert.deepEqual(handoverLinks(sessions[7], state), { from: { id: 3, title: "Fix login" }, pending: true });
});

test("a link to a chat that is gone is dropped", () => {
  assert.deepEqual(handoverLinks(sessions[3], { sessions: { 3: sessions[3] }, messages: [] }), { pending: false });
  assert.deepEqual(handoverLinks(undefined, { sessions, messages: [] }), { pending: false });
});
