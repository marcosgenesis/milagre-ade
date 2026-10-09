import assert from "node:assert/strict";
import test from "node:test";
import type { CoordinatorState } from "@milagre/shared/model";
import type { AgentRuns } from "@milagre/shared/agent-runs";
import { runKeys, scopeChats } from "./sidebar-scopes.ts";

const session = (id: number, extra = {}) => ({ id, worktree_id: 1, agent_name: "Claude", status: "Idle", ...extra });
const message = (id: number, session_id: number, body: string) => ({ id, session_id, role: "user", body });
const state = {
  worktrees: { 1: { id: 1, name: "main", path: "/code/shop" } },
  sessions: { 1: session(1), 2: session(2, { unread: true }), 3: session(3, { archived: true }), 4: session(4, { pinned: true, pin_order: 1 }) },
  messages: [message(1, 1, "Fix checkout"), message(2, 2, "Add search"), message(3, 3, "Old"), message(4, 4, "Pinned one")],
} as unknown as CoordinatorState;

test("another Project's chats: pinned first, newest next, archived left out, marks from its runs", () => {
  const rows = scopeChats("/code/shop", state, "created", { running: new Set(["/code/shop#1"]), waiting: new Set(), asking: new Set() });
  assert.deepEqual(
    rows.map((row) => [row.id, row.mark, row.details?.branch]),
    [
      ["4", "idle", "main"],
      ["2", "unread", "main"],
      ["1", "running", "main"],
    ],
  );
});

const run = (approvals: number, questions: number) => ({
  approvals: Array.from({ length: approvals }, () => ({})),
  questions: Array.from({ length: questions }, () => ({})),
});

test("run keys cover Link chats: an approval waits, a question alone asks", () => {
  const keys = runKeys({ "milagre-link:x#1": run(1, 0), "milagre-link:x#2": run(0, 1), "/code/shop#3": run(0, 0) } as unknown as AgentRuns);
  assert.deepEqual(keys, {
    running: "milagre-link:x#1\nmilagre-link:x#2\n/code/shop#3",
    waiting: "milagre-link:x#1\nmilagre-link:x#2",
    asking: "milagre-link:x#2",
  });
});
