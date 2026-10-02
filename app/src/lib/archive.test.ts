import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSession, ChatMessage, CoordinatorState, Worktree } from "../model";
import { archiveChoices, isInsideRoots, isMilagreWorktree, lossReason, removeFailureNotice, withoutWorktree, worktreeShared } from "./archive.ts";
import type { ArchivePlan, WorktreeStatus } from "./archive.ts";

const clean: WorktreeStatus = { uncommitted: 0, unpushed: 0, branch: "milagre/x", removable: true };
const dirty: WorktreeStatus = { uncommitted: 3, unpushed: 2, branch: "milagre/x", removable: false };
const plan = (patch: Partial<ArchivePlan> = {}): ArchivePlan => ({ milagreOwned: true, shared: false, status: clean, ...patch });
const labels = (result: ReturnType<typeof archiveChoices>) => result.choices.map((choice) => choice.label);

test("a clean Milagre worktree offers one item that removes it", () => {
  const result = archiveChoices({ plan: plan(), running: false });
  assert.deepEqual(result.choices, [{ mode: "remove", label: "Archive and remove worktree", tone: "plain" }]);
  assert.equal(result.reason, null);
  assert.deepEqual(labels(archiveChoices({ plan: plan(), running: true })), ["Stop, archive and remove worktree"]);
});

test("a dirty Milagre worktree offers keep or delete, with what would be lost", () => {
  const result = archiveChoices({ plan: plan({ status: dirty }), running: false });
  assert.deepEqual(result.choices.map((choice) => [choice.mode, choice.label, choice.tone]), [
    ["keep", "Archive, keep worktree", "plain"],
    ["delete", "Archive and delete worktree", "danger"],
  ]);
  assert.equal(result.reason, "3 uncommitted files and 2 unpushed commits will be lost");
  assert.deepEqual(labels(archiveChoices({ plan: plan({ status: dirty }), running: true })), ["Stop and archive, keep worktree", "Stop, archive and delete worktree"]);
});

test("a worktree that isn't Milagre's, is shared, or can't be checked only hides the chat", () => {
  for (const patch of [{ milagreOwned: false }, { shared: true }, { status: null }]) {
    const result = archiveChoices({ plan: plan(patch), running: false });
    assert.deepEqual(result.choices, [{ mode: "hide", label: "Confirm archive", tone: "danger" }]);
    assert.equal(result.reason, null);
  }
  assert.deepEqual(labels(archiveChoices({ plan: plan({ shared: true }), running: true })), ["Stop and archive"]);
});

test("lossReason names only what is lost, in singular or plural", () => {
  assert.equal(lossReason({ ...dirty, uncommitted: 1, unpushed: 0 }), "1 uncommitted file will be lost");
  assert.equal(lossReason({ ...dirty, uncommitted: 0, unpushed: 1 }), "1 unpushed commit will be lost");
  assert.equal(lossReason({ ...dirty, uncommitted: 1, unpushed: 4 }), "1 uncommitted file and 4 unpushed commits will be lost");
});

test("isInsideRoots needs a folder under a root, not the root or a lookalike", () => {
  const roots = ["/tmp/wt", "/private/tmp/wt/"];
  assert.equal(isInsideRoots("/tmp/wt/shop/x-1", roots), true);
  assert.equal(isInsideRoots("/private/tmp/wt/shop/x-1", roots), true);
  assert.equal(isInsideRoots("/tmp/wt", roots), false);
  assert.equal(isInsideRoots("/tmp/wt/", roots), false);
  assert.equal(isInsideRoots("/tmp/wt-other/shop", roots), false);
  assert.equal(isInsideRoots("/work/shop", roots), false);
  assert.equal(isInsideRoots("/tmp/wt/shop", []), false);
});

test("a Milagre worktree has a base and lives under the root", () => {
  const worktree: Worktree = { id: 2, project_id: 1, path: "/tmp/wt/shop/x-1", name: "milagre/x-1", base: "main" };
  assert.equal(isMilagreWorktree(worktree, ["/tmp/wt"]), true);
  assert.equal(isMilagreWorktree({ ...worktree, base: undefined }, ["/tmp/wt"]), false);
  assert.equal(isMilagreWorktree({ ...worktree, path: "/work/shop" }, ["/tmp/wt"]), false);
  assert.equal(isMilagreWorktree(undefined, ["/tmp/wt"]), false);
});

const session = (id: number, worktree_id: number, extra: Partial<AgentSession> = {}): AgentSession => ({ id, worktree_id, agent_name: "x", status: "Created", ...extra }) as AgentSession;
const message = (id: number, session_id: number) => ({ id, session_id, body: "hi", context: null, role: "user" }) as ChatMessage;
const state = (): CoordinatorState => ({
  next_id: 10,
  projects: {},
  worktrees: {
    "1": { id: 1, project_id: 1, path: "/work/shop", name: "main" },
    "2": { id: 2, project_id: 1, path: "/tmp/wt/shop/x-1", name: "milagre/x-1", base: "main" },
    "3": { id: 3, project_id: 1, path: "/tmp/wt/shop/y-1", name: "milagre/y-1", base: "main" },
  },
  sessions: { "1": session(1, 1), "2": session(2, 2), "3": session(3, 2), "4": session(4, 3) },
  connections: { "1": { id: 1, left_worktree_id: 1, right_worktree_id: 2, kind: "Information", lifetime: "Persistent" } as never },
  events: [{ id: 1, worktree_id: 2, kind: "Change", summary: "", details: "" }, { id: 2, worktree_id: 3, kind: "Change", summary: "", details: "" }],
  messages: [message(1, 2), message(2, 3), message(3, 4)],
  approvals: [],
  tasks: { "1": { id: 1, worktree_id: 2, title: "t", status: "open" } },
  artifacts: {},
  outputs: [],
  conflicts: [],
});

test("worktreeShared: another unarchived chat with messages in the same worktree", () => {
  const initial = state();
  assert.equal(worktreeShared(initial, 2), true);
  assert.equal(worktreeShared(initial, 4), false);
  assert.equal(worktreeShared({ ...initial, sessions: { ...initial.sessions, 3: session(3, 2, { archived: true }) } }, 2), false);
  assert.equal(worktreeShared({ ...initial, messages: initial.messages.filter((item) => item.session_id !== 3) }, 2), false);
  assert.equal(worktreeShared(initial, 99), false);
});

test("withoutWorktree drops the worktree and what hangs off it, and leaves the rest", () => {
  const initial = state();
  const next = withoutWorktree(initial, 2);
  assert.deepEqual(Object.keys(next.worktrees), ["1", "3"]);
  assert.deepEqual(Object.keys(next.sessions), ["1", "4"]);
  assert.deepEqual(next.connections, {});
  assert.deepEqual(next.events.map((event) => event.id), [2]);
  assert.deepEqual(next.messages.map((item) => item.id), [3]);
  assert.deepEqual(next.tasks, {});
  assert.equal(withoutWorktree(initial, 99), initial);
});

test("removeFailureNotice puts git's message and the path in one line", () => {
  assert.equal(
    removeFailureNotice(new Error("Error invoking remote method 'worktree:remove': Error: fatal: '/tmp/wt/x' contains modified or untracked files, use --force to delete it\n"), "/tmp/wt/x"),
    "Couldn't remove the worktree: '/tmp/wt/x' contains modified or untracked files, use --force to delete it. It's still at /tmp/wt/x.",
  );
  assert.equal(removeFailureNotice("boom.", "/p"), "Couldn't remove the worktree: boom. It's still at /p.");
});
