// Performance budgets on a large Project (#321): what #300 won back stays won. The Project is made up at test time
// (large-project-fixture.cjs), shaped like the big one #300 measured, so its sizes are the same on every machine and are
// held to byte budgets with a little headroom. A save's time depends on the machine and on what else runs beside it,
// so it is held to a share of encoding the whole state, measured in the same moments, and to a loose ceiling.
//
// On the real Project these were, when this check was added: a save 6 to 7 ms, a lean desktop's state on open 2.63 MB
// before archived subagents went as summaries (0.32 MB after), a subagent update 26 KB (median). What this fixture gives
// is beside each budget. A budget that fails here means a change sends or saves more than it used to: find what grew
// before raising it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const store = require("@milagre/core/project-store");
const { startDaemon, formOf, subagentAsTaken } = require("./server.cjs");
const { connect } = require("./client.cjs");
const { largeProject } = require("./large-project-fixture.cjs");

// What the desktop asks the host for (apps/desktop/electron/daemon-runtime.cjs).
const DESKTOP = { messages: false, transcripts: false, archivedSubagents: false };

const BUDGET = {
  // The fixture's lean state on open: 2,845,987 bytes before archived subagents went as summaries, 359,007 after.
  leanStateBytes: 395_000,
  // A running subagent's update: median 27,866 bytes, largest 73,010.
  updateMedianBytes: 30_500,
  updateLargestBytes: 80_000,
  // An archived one's goes as a summary: 241 bytes at most.
  archivedUpdateLargestBytes: 1_000,
  // A save of one changed message: about 30% of encoding the whole state on an idle laptop (3.5 ms against 12 ms),
  // 45% with six of these checks at once. A save that encodes the whole state again, as before chats.db (#301), takes
  // more than all of it, so that is the limit.
  saveShareOfEncode: 1,
  // 3 to 7 ms on a laptop; only a save gone badly wrong (or a machine far too busy) takes this long.
  saveMedianMs: 250,
};

const median = (values) => values.toSorted((a, b) => a - b)[values.length >> 1];
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));

async function tempProject(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-perf-budget-")));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, "project");
  await fs.mkdir(path.join(project, ".milagre"), { recursive: true });
  const state = largeProject({ projectPath: project });
  await fs.writeFile(path.join(project, ".milagre", "coordination.json"), JSON.stringify(state));
  return { directory, project, state };
}

test("the large Project fixture is the same on every run", () => {
  const first = JSON.stringify(largeProject({ projectPath: "/p" }));
  assert.equal(JSON.stringify(largeProject({ projectPath: "/p" })), first);
  const state = JSON.parse(first);
  assert.equal(state.messages.length, 881);
  assert.equal(Object.values(state.sessions).flatMap((session) => session.subagents ?? []).length, 94);
});

test("a lean desktop opens the large Project within its budget", async (t) => {
  const { directory, project } = await tempProject(t);
  execFileSync("git", ["init", "-b", "main", project], { stdio: "ignore" });
  const dataDir = path.join(directory, "profile");
  const daemon = await startDaemon({
    dataDir,
    version: "9.8.7",
    runtimeOptions: {
      cwd: project,
      environmentReady: Promise.resolve(),
      titleModels: {},
      agentCli: Object.assign(async () => ({ command: "/fake/codex" }), { invalidate() {} }),
    },
  });
  let openBytes;
  let readBytes;
  const desktop = await connect({ dataDir });
  try {
    await desktop.call("daemon:state-patches", [DESKTOP]);
    const opened = await desktop.call("project:open", [project]);
    assert.equal(Object.keys(opened.state.sessions).length, 79);
    openBytes = bytes(opened.state);
    readBytes = bytes((await desktop.call("state:read", [project])).state);
  } finally {
    desktop.close();
    await daemon.close();
  }
  t.diagnostic(`lean state on open: ${openBytes} bytes (budget ${BUDGET.leanStateBytes}); on read: ${readBytes}`);
  assert.ok(openBytes <= BUDGET.leanStateBytes, `opening sent ${openBytes} bytes of state, over the budget of ${BUDGET.leanStateBytes}`);
  assert.ok(readBytes <= BUDGET.leanStateBytes, `state:read sent ${readBytes} bytes of state, over the budget of ${BUDGET.leanStateBytes}`);
});

test("a subagent update to a lean desktop stays within its budget", async (t) => {
  const { project } = await tempProject(t);
  const state = await store.readProjectState(project);
  const agents = Object.values(state.sessions).flatMap((session) => session.subagents ?? []);
  const form = formOf(DESKTOP);
  // Every subagent as an update of a running child on the track would send it, and as an archived one's would.
  const running = agents.map(({ archived: _archived, ...agent }) => bytes(subagentAsTaken({ ...agent, status: "running" }, form)));
  const archived = agents.map((agent) => bytes(subagentAsTaken({ ...agent, archived: true }, form)));
  t.diagnostic(`update median ${median(running)} bytes, largest ${Math.max(...running)}; archived largest ${Math.max(...archived)}`);
  assert.ok(median(running) <= BUDGET.updateMedianBytes, `the median update is ${median(running)} bytes, over ${BUDGET.updateMedianBytes}`);
  assert.ok(Math.max(...running) <= BUDGET.updateLargestBytes, `the largest update is ${Math.max(...running)} bytes, over ${BUDGET.updateLargestBytes}`);
  assert.ok(
    Math.max(...archived) <= BUDGET.archivedUpdateLargestBytes,
    `an archived subagent's update is ${Math.max(...archived)} bytes, over ${BUDGET.archivedUpdateLargestBytes}`,
  );
});

test("a save of the large Project after one change stays a small share of encoding it whole", async (t) => {
  const { project } = await tempProject(t);
  let state = await store.readProjectState(project);
  state = await store.compactProjectState(project, state, null);
  // The first save moves the messages into chats.db and writes every transcript's sidecar; a routine one doesn't.
  await store.saveProjectState(project, state, { sweepMinAgeMs: 1e12 });
  await store.saveProjectState(project, state, { sweepMinAgeMs: 1e12 });
  // A streaming turn: the last message of one Chat replaced, as each delta of a reply does.
  const shares = [];
  const saves = [];
  for (let run = 0; run < 15; run++) {
    const last = state.messages.at(-1);
    const next = await store.compactProjectState(
      project,
      { ...state, messages: [...state.messages.slice(0, -1), { ...last, body: `${last.body} more` }] },
      state,
    );
    let started = performance.now();
    JSON.stringify(next);
    const encodeMs = performance.now() - started;
    started = performance.now();
    await store.saveProjectState(project, next, { sweepMinAgeMs: 1e12 });
    const saveMs = performance.now() - started;
    saves.push(saveMs);
    shares.push(saveMs / encodeMs);
    state = next;
  }
  t.diagnostic(`save median ${median(saves).toFixed(1)} ms, ${(median(shares) * 100).toFixed(0)}% of encoding the whole state`);
  assert.ok(median(shares) <= BUDGET.saveShareOfEncode, `a save took ${(median(shares) * 100).toFixed(0)}% of encoding the whole state`);
  assert.ok(median(saves) <= BUDGET.saveMedianMs, `a save took ${median(saves).toFixed(1)} ms (median)`);
  // The saved Project reads back as it was.
  assert.equal((await store.readProjectState(project)).messages.at(-1).body, state.messages.at(-1).body);
});
