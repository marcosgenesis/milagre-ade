import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSession, ChatMessage, CoordinatorState } from "./model.ts";
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

test('chat lists hide a worktree\'s empty starter chat but keep chats with messages and handovers', async () => {
  const { isListedChat } = await import('./chats.mjs');
  assert.equal(isListedChat({} as never, 0), false);
  assert.equal(isListedChat({} as never, 2), true);
  assert.equal(isListedChat({ handoverPending: true } as never, 0), true);
  assert.equal(isListedChat({ handoverDraft: '' } as never, 0), true);
});


test('pending input lists its Chat without modifying the persisted Project', async () => {
  const { createPendingChat, withPendingChat } = await import('./chats.mjs');
  const state: CoordinatorState = { next_id: 4, projects: {}, worktrees: { 1: { id: 1, name: 'main', path: '/p', project_id: 1 } }, sessions: {}, messages: [], tasks: {} };
  const pending = createPendingChat({ state, worktreeId: 1, body: 'Fix login\nDetails', model: 'gpt-6-astra', provider: 'codex' });
  const shown = withPendingChat(state, pending);
  assert.equal(chatTitle(shown.sessions[pending.session.id], shown.messages), 'Fix login');
  assert.equal(shown.messages[0].role, 'user');
  assert.equal(shown.sessions[pending.session.id].worktree_id, 1);
  assert.deepEqual(state.sessions, {});
  assert.deepEqual(state.messages, []);
  assert.equal(withPendingChat(state, null), state);
});

test('canonical input replaces a pending Chat before the send response without merging identical text', async () => {
  const { createPendingChat, withPendingChat, pendingChatSessionId } = await import('./chats.mjs');
  const state: CoordinatorState = { next_id: 4, projects: {}, worktrees: {}, sessions: {}, messages: [], tasks: {} };
  const pending = createPendingChat({ state, worktreeId: 1, body: 'Hello', model: 'm', provider: 'codex' });
  const persisted: CoordinatorState = { ...state, next_id: 8, sessions: { 5: { id: 5, worktree_id: 1, agent_name: 'main', status: 'Created' } }, messages: [{ id: 6, session_id: 5, body: 'Hello', role: 'user', context: null }] };
  assert.equal(pendingChatSessionId(persisted, pending), null, 'another client may send identical text');
  persisted.messages[0] = { ...persisted.messages[0], clientMessageId: pending.message.clientMessageId };
  assert.equal(pendingChatSessionId(persisted, pending), 5);
  assert.equal(withPendingChat(persisted, pending), persisted);
});
