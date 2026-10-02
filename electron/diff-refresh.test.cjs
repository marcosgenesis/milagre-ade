const assert = require("node:assert/strict");
const test = require("node:test");
const { DiffRefresher } = require("./diff-refresh.cjs");
const { ProjectStates } = require("./project-states.cjs");
const { waitUntil } = require("./agents/test-helpers.cjs");

// Two projects, each with a chat that has a message in worktree 1 and a worktree 2 with no chat.
function projectState(projectPath) {
  return {
    worktrees: { 1: { id: 1, name: "main", path: projectPath, base: "main" }, 2: { id: 2, name: "idle", path: `${projectPath}-idle` } },
    sessions: { 7: { id: 7, worktree_id: 1 } },
    messages: [{ id: 8, session_id: 7, role: "user", body: "hi" }],
  };
}

function harness({ now = () => 0 } = {}) {
  const reads = [];
  const states = new ProjectStates({ read: async (projectPath) => projectState(projectPath), save: async () => {} });
  const diffs = new DiffRefresher({
    states,
    readDiffStat: async (worktreePath, base) => {
      reads.push({ worktreePath, base });
      return { added: reads.length, removed: 0 };
    },
    update: (projectPath, change) => states.update(projectPath, change),
    debounceMs: 10,
    now,
  });
  return { diffs, states, reads };
}

test("a burst of agent steps in a chat re-reads its worktree once, in any project", async () => {
  const { diffs, states, reads } = harness();
  await states.get("/b");
  for (const type of ["step-completed", "step-completed", "turn-completed"]) diffs.observe("/b#7", { type });
  diffs.observe("/b#7", { type: "text-delta", text: "x" });
  await waitUntil(() => reads.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(reads, [{ worktreePath: "/b", base: "main" }]);
  assert.deepEqual((await states.get("/b")).worktrees[1].diff, { added: 1, removed: 0 });
});

test("an event for a project not read this run reads nothing", async () => {
  const { diffs, reads } = harness();
  diffs.observe("/never#7", { type: "turn-completed" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(reads, []);
});

test("refreshing a project reads every worktree that has a chat", async () => {
  const { diffs, reads } = harness();
  await diffs.refresh("/a");
  assert.deepEqual(reads.map((read) => read.worktreePath), ["/a"]);
});

test("focusing a window re-reads every project read this run, at most once per throttle period", async () => {
  let clock = 0;
  const { diffs, states, reads } = harness({ now: () => clock });
  await Promise.all([states.get("/a"), states.get("/b")]);
  diffs.focused();
  clock = 4000;
  diffs.focused();
  await waitUntil(() => reads.length === 2);
  clock = 6000;
  diffs.focused();
  await waitUntil(() => reads.length === 4);

  assert.deepEqual(reads.map((read) => read.worktreePath).sort(), ["/a", "/a", "/b", "/b"]);
});
