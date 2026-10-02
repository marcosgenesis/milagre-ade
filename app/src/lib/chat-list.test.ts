import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSession, ChatMessage, CoordinatorState } from "../model";
import { chatMark, chatTitle, folderName, formatLineCount, patchSession, withDiffStats } from "./chat-list.ts";

const session: AgentSession = { id: 1, worktree_id: 1, agent_name: "main", status: "Created" };

const state = (): CoordinatorState => ({
  next_id: 3,
  projects: {},
  worktrees: { "1": { id: 1, project_id: 1, path: "/work/app", name: "main" }, "2": { id: 2, project_id: 1, path: "/work/wt", name: "milagre/x", diff: { added: 3, removed: 1 } } },
  sessions: { "1": session },
  connections: {},
  events: [],
  messages: [],
  approvals: [],
  tasks: {},
  artifacts: {},
  outputs: [],
  conflicts: [],
});

test("chatMark: waiting beats running beats unread", () => {
  assert.equal(chatMark({ waiting: true, running: true, unread: true }), "waiting");
  assert.equal(chatMark({ waiting: false, running: true, unread: true }), "running");
  assert.equal(chatMark({ waiting: false, running: false, unread: true }), "unread");
  assert.equal(chatMark({ waiting: false, running: false, unread: false }), "idle");
});

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

test("patchSession sets and clears fields, and keeps an unchanged state", () => {
  const initial = state();
  const renamed = patchSession(initial, 1, { title: "Login", unread: true });
  assert.deepEqual(renamed.sessions[1], { ...session, title: "Login", unread: true });
  const cleared = patchSession(renamed, 1, { title: "", unread: false });
  assert.deepEqual(cleared.sessions[1], session);
  assert.equal(patchSession(initial, 1, { unread: false }), initial);
  assert.equal(patchSession(initial, 99, { archived: true }), initial);
});

test("withDiffStats stores new stats and skips missing or unchanged ones", () => {
  const initial = state();
  assert.equal(withDiffStats(initial, { 2: { added: 3, removed: 1 }, 1: null, 9: { added: 1, removed: 1 } }), initial);
  const next = withDiffStats(initial, { 1: { added: 10, removed: 2 } });
  assert.deepEqual(next.worktrees[1].diff, { added: 10, removed: 2 });
  assert.equal(next.worktrees[2], initial.worktrees[2]);
});

test("formatLineCount and folderName", () => {
  assert.equal(formatLineCount(0), "0");
  assert.equal(formatLineCount(980), "980");
  assert.equal(formatLineCount(1000), "1k");
  assert.equal(formatLineCount(2140), "2.1k");
  assert.equal(formatLineCount(14_400), "14k");
  assert.equal(formatLineCount(2_100_000), "2.1m");
  assert.equal(folderName("/Users/v/.milagre/worktrees/app/fix-login-ab12/"), "fix-login-ab12");
  assert.equal(folderName("/"), "/");
});
