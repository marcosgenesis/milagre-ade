import assert from "node:assert/strict";
import test from "node:test";
import type { CoordinatorState } from "../model";
import { renameWorktree } from "./worktree-rename.ts";

const state = (): CoordinatorState => ({
  next_id: 4,
  projects: {},
  worktrees: { "1": { id: 1, project_id: 1, path: "/work/app", name: "main" }, "2": { id: 2, project_id: 1, path: "/work/wt", name: "milagre/fix-the-thing-ab12" } },
  sessions: {
    "1": { id: 1, worktree_id: 1, agent_name: "main", status: "Created" },
    "2": { id: 2, worktree_id: 2, agent_name: "milagre/fix-the-thing-ab12", status: "Created" },
    "3": { id: 3, worktree_id: 2, agent_name: "Reviewer", status: "Created" },
  },
  connections: {},
  events: [],
  messages: [],
  approvals: [],
  tasks: {},
  artifacts: {},
  outputs: [],
  conflicts: [],
});

const rename = { projectPath: "/work/app", path: "/work/wt", from: "milagre/fix-the-thing-ab12", name: "milagre/login-redirect-ab12" };

test("renameWorktree renames the worktree and the chats named after its branch", () => {
  const next = renameWorktree(state(), rename);
  assert.equal(next.worktrees[2].name, "milagre/login-redirect-ab12");
  assert.equal(next.sessions[2].agent_name, "milagre/login-redirect-ab12");
  assert.equal(next.sessions[3].agent_name, "Reviewer");
  assert.deepEqual(next.worktrees[1], state().worktrees[1]);
  assert.deepEqual(next.sessions[1], state().sessions[1]);
});

test("renameWorktree leaves the state alone when the worktree moved on", () => {
  const before = state();
  assert.equal(renameWorktree(before, { ...rename, path: "/work/other" }), before);
  assert.equal(renameWorktree(before, { ...rename, from: "milagre/something-else" }), before);
});
