import assert from "node:assert/strict";
import test from "node:test";
import type { CoordinatorState } from "@milagre/shared/model";
import type { AgentRuns } from "@milagre/shared/agent-runs";
import { railLive, rememberScopeRows, runKeys, scopeChats } from "./sidebar-scopes.ts";

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

const marks = { running: new Set<string>(), waiting: new Set<string>(), asking: new Set<string>() };
const pr = { number: 409, url: "https://github.com/x/y/pull/409", title: "Fix", state: "OPEN" };

test("a Project left behind keeps the PRs, issue and ports its rows showed while it was open", () => {
  rememberScopeRows("/code/shop", [
    {
      id: "1",
      label: "Fix checkout",
      details: { path: "/code/shop", pullRequests: [pr as never], linearKey: "ENG-1", linkable: true, ports: [{ port: 3000 } as never] },
    },
    { id: "2", label: "Add search", details: { path: "/code/shop", pullRequests: [pr as never] } },
    { id: "9", label: "Draft", pending: true, details: { path: "/code/shop", pullRequests: [pr as never] } },
  ]);
  const rows = scopeChats("/code/shop", state, "created", marks);
  const one = rows.find((row) => row.id === "1")!;
  assert.deepEqual(one.details?.pullRequests, [pr]);
  assert.equal(one.details?.linearKey, "ENG-1");
  assert.equal(one.details?.linkable, true);
  assert.deepEqual(one.details?.ports, [{ port: 3000 }]);
  assert.equal(one.details?.branch, "main", "the live state still names the branch");
  assert.equal(one.details?.failed, false);
  assert.deepEqual(rows.find((row) => row.id === "2")!.details?.pullRequests, [pr]);
  assert.equal(rows.find((row) => row.id === "4")!.details?.pullRequests, undefined, "a chat never shown open has nothing to keep");
});

test("a remembered row of a chat whose Worktree changed is dropped", () => {
  rememberScopeRows("/code/shop", [{ id: "1", label: "Fix checkout", details: { path: "/code/shop-old", pullRequests: [pr as never] } }]);
  const rows = scopeChats("/code/shop", state, "created", marks);
  assert.equal(rows.find((row) => row.id === "1")!.details?.pullRequests, undefined);
});

test("another scope's memory doesn't leak", () => {
  rememberScopeRows("/code/api", [{ id: "2", label: "Add search", details: { path: "/code/shop", pullRequests: [pr as never] } }]);
  rememberScopeRows("/code/shop", []);
  const rows = scopeChats("/code/shop", state, "created", marks);
  assert.equal(rows.find((row) => row.id === "2")!.details?.pullRequests, undefined);
});

test("rail status: asking or waiting beats running, and only live chats are listed", () => {
  const rows = [
    { id: "1", label: "a", mark: "running" as const },
    { id: "2", label: "b", mark: "unread" as const },
    { id: "3", label: "c", mark: "idle" as const },
    { id: "4", label: "d" },
  ];
  assert.deepEqual(railLive(rows), { status: "running", chats: [rows[0]] });
  assert.equal(railLive([...rows, { id: "5", label: "e", mark: "question" as const }]).status, "attention");
  assert.equal(railLive([...rows, { id: "5", label: "e", mark: "waiting" as const }]).status, "attention");
  assert.equal(railLive([{ id: "5", label: "e", mark: "delegated" as const }]).status, "running");
  assert.deepEqual(railLive(rows.slice(1)), { status: "idle", chats: [] });
});
