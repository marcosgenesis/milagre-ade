import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSession, ChatMessage } from "../../app/src/model";
import { chatTitle } from "./chats.mjs";

const session: AgentSession = { id: 1, worktree_id: 1, agent_name: "main", status: "Created" };

test("chatTitle prefers the user's name, then the first message's first line", () => {
  const messages = [
    { id: 1, session_id: 1, body: "", context: null, role: "user" },
    { id: 2, session_id: 1, body: "Fix the login\nand more", context: null, role: "user" },
  ] as ChatMessage[];
  assert.equal(chatTitle(session, messages), "Fix the login");
  assert.equal(chatTitle({ ...session, title: "  Login bug " }, messages), "Login bug");
  assert.equal(chatTitle({ ...session, title: "   " }, messages), "Fix the login");
  assert.equal(chatTitle(session, []), "main");
  assert.equal(chatTitle(session, [{ id: 3, session_id: 1, body: "x".repeat(80), context: null }]), `${"x".repeat(57)}…`);
});
