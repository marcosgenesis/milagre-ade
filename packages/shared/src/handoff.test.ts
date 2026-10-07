import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSession, ChatMessage } from "./model.ts";
import { catchUpStart, handoffKind, isHandoff, lastTurnProvider } from "./handoff.mjs";

const session: AgentSession = { id: 1, worktree_id: 1, agent_name: "main", status: "Created", provider: "claude", native_session_id: "c1" };
const user = (id: number, body = "hi"): ChatMessage => ({ id, session_id: 1, body, context: null, role: "user" });
const reply = (id: number, outcome: ChatMessage["outcome"] = "completed"): ChatMessage => ({
  id,
  session_id: 1,
  body: "ok",
  context: null,
  role: "assistant",
  outcome,
});
const divider = (id: number, from: "claude" | "codex", to: "claude" | "codex"): ChatMessage => ({
  id,
  session_id: 1,
  body: "",
  role: "assistant",
  context: { kind: "handoff", from: { provider: from }, to: { provider: to }, status: "done" },
});
const state = (messages: ChatMessage[], extra: Partial<AgentSession> = {}) => ({ sessions: { 1: { ...session, ...extra } }, messages });

test("a divider is recognized by its context kind", () => {
  assert.equal(isHandoff(divider(3, "claude", "codex")), true);
  assert.equal(isHandoff(reply(3)), false);
  assert.equal(isHandoff({ ...reply(3), context: "handover" }), false);
});

test("the last turn's provider is the last divider's target, else the chat's provider once it has messages", () => {
  assert.equal(lastTurnProvider(state([]), 1), undefined);
  assert.equal(lastTurnProvider(state([user(2), reply(3)]), 1), "claude");
  assert.equal(lastTurnProvider(state([user(2), reply(3), divider(4, "claude", "codex"), user(5)], { provider: "codex" }), 1), "codex");
});

test("catch-up starts after the divider where the provider was switched away, else the whole chat", () => {
  const messages = [user(2), reply(3), divider(4, "claude", "codex"), user(5), reply(6)];
  assert.equal(catchUpStart(state(messages, { provider: "codex", native_sessions: { claude: "c1" } }), 1, "claude"), 4);
  // Codex never ran before the divider into it: whole chat.
  assert.equal(catchUpStart(state(messages, { provider: "codex" }), 1, "codex"), null);
  // A parked id is required to resume; without one the provider gets the whole chat.
  assert.equal(catchUpStart(state(messages, { provider: "codex" }), 1, "claude"), null);
});

test("a send needs a switch when the provider changes, a restore when a replied chat lost its session, else nothing", () => {
  assert.equal(handoffKind(state([]), 1, "codex"), null);
  assert.equal(handoffKind(state([user(2), reply(3)]), 1, "claude"), null);
  assert.equal(handoffKind(state([user(2), reply(3)]), 1, "codex"), "switch");
  assert.equal(handoffKind(state([user(2), reply(3)], { native_session_id: undefined }), 1, "claude"), "restore");
  // A first turn that failed before its session started has nothing to restore.
  assert.equal(handoffKind(state([user(2), reply(3, "failed")], { native_session_id: undefined }), 1, "claude"), null);
});
