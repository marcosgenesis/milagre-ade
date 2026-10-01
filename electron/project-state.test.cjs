const assert = require("node:assert/strict");
const test = require("node:test");
const { emptyState, reconcileState } = require("./project-state.cjs");

const main = { path: "/repo/shop", name: "main" };
const feature = { path: "/home/.milagre/worktrees/shop/cart-ab12", name: "milagre/cart-ab12" };

test("a new worktree gets one empty chat", () => {
  const state = reconcileState(null, "shop", [main]);
  const sessions = Object.values(state.sessions);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].worktree_id, Object.values(state.worktrees)[0].id);
  assert.equal(sessions[0].agent_name, "main");
});

test("every chat of a worktree survives a reload with its messages", () => {
  const stored = {
    ...emptyState("shop"),
    next_id: 10,
    worktrees: { 1: { id: 1, project_id: 1, path: main.path, name: "main" } },
    sessions: {
      2: { id: 2, worktree_id: 1, agent_name: "main", status: "Created" },
      5: { id: 5, worktree_id: 1, agent_name: "main", status: "Created" },
    },
    messages: [
      { id: 3, session_id: 2, body: "first chat", context: null },
      { id: 6, session_id: 5, body: "second chat", context: null },
    ],
  };
  const state = reconcileState(stored, "shop", [main]);
  assert.deepEqual(Object.keys(state.sessions).sort(), ["2", "5"]);
  assert.deepEqual(state.messages.map((message) => message.body), ["first chat", "second chat"]);
  assert.equal(state.next_id, 10);
});

test("chats of a removed worktree are dropped and new worktrees get fresh ids", () => {
  const stored = {
    ...emptyState("shop"),
    next_id: 4,
    worktrees: { 1: { id: 1, project_id: 1, path: "/gone", name: "old" } },
    sessions: { 2: { id: 2, worktree_id: 1, agent_name: "old", status: "Created" } },
    messages: [{ id: 3, session_id: 2, body: "stale", context: null }],
  };
  const state = reconcileState(stored, "shop", [main, feature]);
  assert.deepEqual(Object.values(state.worktrees).map((worktree) => worktree.name), ["main", "milagre/cart-ab12"]);
  assert.equal(state.messages.length, 0);
  assert.ok(Object.values(state.sessions).every((session) => session.id >= 4));
  assert.equal(new Set(Object.values(state.sessions).map((session) => session.worktree_id)).size, 2);
});
