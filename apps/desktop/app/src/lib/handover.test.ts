import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSession, ChatMessage, ModelOption } from "../model";
import { handoverBlocker, handoverLinks, handoverModel, handoverNotes, isHandoverChat, otherProvider } from "./handover.ts";

test("the other provider", () => {
  assert.equal(otherProvider("claude"), "codex");
  assert.equal(otherProvider("codex"), "claude");
});

test("a running turn blocks handover before a CLI problem does", () => {
  assert.equal(
    handoverBlocker({ running: true, cli: "Codex isn't installed." }),
    "The agent is still running. Stop the turn or wait for it to finish to hand over.",
  );
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
  assert.deepEqual(handoverLinks(sessions[3], state), { to: { id: 7, title: "main", provider: "codex" }, pending: false, live: false });
  assert.deepEqual(handoverLinks(sessions[7], state), { from: { id: 3, title: "Fix login" }, pending: true, live: true });
});

test("a link to a chat that is gone is dropped", () => {
  assert.deepEqual(handoverLinks(sessions[3], { sessions: { 3: sessions[3] }, messages: [] }), { pending: false, live: false });
  assert.deepEqual(handoverLinks(undefined, { sessions, messages: [] }), { pending: false, live: false });
});

test("a chat is a handover chat while it is pending or holds a draft", () => {
  assert.equal(isHandoverChat(undefined), false);
  assert.equal(isHandoverChat({ handoverPending: true } as AgentSession), true);
  assert.equal(isHandoverChat({ handoverDraft: "BRIEF" } as AgentSession), true);
  assert.equal(isHandoverChat({ handedOverFrom: 3 } as AgentSession), false);
  assert.equal(handoverLinks({ handoverDraft: "BRIEF" } as AgentSession, { sessions: {}, messages: [] }).live, true);
});

test("the note says what stays behind and how the mode behaves on the new provider", () => {
  assert.deepEqual(handoverNotes({ from: "codex", to: "claude", permissionMode: "auto" }), [
    'Approvals you allowed for the whole chat ("Always allow in this chat") stay with the Codex chat.',
    "Subagents still running in the Codex chat keep running there.",
    "On Claude, Auto applies edits inside this worktree without asking and asks before most commands and anything outside it.",
  ]);
  assert.match(
    handoverNotes({ from: "claude", to: "codex", permissionMode: "ask" })[2],
    /^On Codex, Ask runs commands in a sandbox that can write to this worktree and temp folders, with no network/,
  );
  assert.match(handoverNotes({ from: "claude", to: "codex", permissionMode: "full" })[2], /^On Codex, Full runs commands with no sandbox/);
  assert.match(
    handoverNotes({ from: "claude", to: "codex", permissionMode: "auto" })[2],
    /^On Codex, Auto runs commands in a sandbox that can write to this worktree and temp folders, with no network, and asks before leaving it\.$/,
  );
  assert.equal(
    handoverNotes({ from: "codex", to: "claude", permissionMode: "ask" })[2],
    "On Claude, Ask asks before edits and commands your Claude settings don't already allow.",
  );
  assert.match(handoverNotes({ from: "codex", to: "claude", permissionMode: "full" })[2], /^On Claude, Full skips every approval prompt/);
});
