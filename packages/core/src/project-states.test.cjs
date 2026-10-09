const assert = require("node:assert/strict");
const test = require("node:test");
const { ProjectStates } = require("./project-states.cjs");

function harness({ failSaves = 0 } = {}) {
  const reads = [];
  const saves = [];
  let failures = failSaves;
  const states = new ProjectStates({
    read: async (projectPath) => {
      reads.push(projectPath);
      return { project: projectPath, count: 0 };
    },
    save: async (projectPath, state) => {
      saves.push({ projectPath, state });
      if (failures-- > 0) throw new Error("disk full");
    },
  });
  return { states, reads, saves };
}

const bump = (state) => ({ ...state, count: state.count + 1 });

test("reads a project once and coalesces changes", async () => {
  const { states, reads, saves } = harness();
  assert.equal(states.has("/a"), false);
  await states.update("/a", bump);
  await states.update("/a", bump);

  assert.deepEqual(reads, ["/a"]);
  assert.equal(states.has("/a"), true);
  assert.deepEqual(states.projects(), ["/a"]);
  await states.flush();
  assert.deepEqual(
    saves.map((save) => save.state.count),
    [2],
  );
  assert.deepEqual(await states.get("/a"), { project: "/a", count: 2 });
});

test("changes to a project run one at a time against its latest state", async () => {
  const { states } = harness();
  // A slow change asked for first still finishes before the next one reads the state.
  const slow = states.update("/a", async (state) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return bump(state);
  });
  const fast = states.update("/a", bump);

  assert.deepEqual(await Promise.all([slow, fast]).then((results) => results.map((result) => result.state.count)), [1, 2]);
});

test("projects change independently", async () => {
  const { states, saves } = harness();
  await Promise.all([states.update("/a", bump), states.update("/b", bump), states.update("/a", bump)]);

  assert.deepEqual(await states.get("/a"), { project: "/a", count: 2 });
  assert.deepEqual(await states.get("/b"), { project: "/b", count: 1 });
  await states.flush();
  assert.equal(saves.length, 2);
});

test("a change that leaves the state as it was saves nothing", async () => {
  const { states, saves } = harness();
  const result = await states.update("/a", (state) => state);

  assert.equal(result.changed, false);
  assert.deepEqual(saves, []);
});

test("a change that throws leaves the state as it was and doesn't block the next one", async () => {
  const { states } = harness();
  await assert.rejects(
    states.update("/a", () => {
      throw new Error("gone");
    }),
    /gone/,
  );
  await states.update("/a", bump);

  assert.deepEqual(await states.get("/a"), { project: "/a", count: 1 });
});

test("a failed save keeps the change, and the next save writes it", async () => {
  const { states, saves } = harness({ failSaves: 1 });
  const first = await states.update("/a", bump);
  await assert.rejects(states.flush(), /disk full/);
  await states.update("/a", bump);
  await states.flush();

  assert.equal(first.changed, true);
  assert.deepEqual(
    saves.map((save) => save.state.count),
    [1, 2],
  );
});

test("flush waits for every change already asked for", async () => {
  const { states, saves } = harness();
  void states.update("/a", async (state) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return bump(state);
  });
  void states.update("/b", bump);
  await states.flush();

  assert.equal(saves.length, 2);
});

test("known Worktree folders come from loaded state and update without another read", async () => {
  let reads = 0;
  const states = new ProjectStates({
    read: async (p) => {
      reads++;
      return { worktrees: { 1: { path: `${p}/main` } } };
    },
    save: async () => {},
  });
  assert.deepEqual(states.worktreePaths(), []);
  await states.get("/one");
  await states.get("/two");
  assert.deepEqual(states.worktreePaths(), ["/one/main", "/two/main"]);
  await states.update("/one", (s) => ({ ...s, worktrees: { 2: { path: "/one/new" } } }));
  assert.deepEqual(states.worktreePaths(), ["/one/new", "/two/main"]);
  assert.equal(reads, 2);
});

test("a slow save in Chat B does not block a token batch in Chat A", async (t) => {
  let release;
  let started;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  const disk = new Promise((resolve) => {
    release = resolve;
  });
  t.after(() => release());
  const states = new ProjectStates({
    read: async () => ({ count: 0 }),
    save: async () => {
      started();
      await disk;
    },
    debounceMs: 1,
  });
  const first = states.update("/p", bump);
  await began;
  let received = false;
  const token = states.update("/p", (state) => {
    received = true;
    return state;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received, true, "disk writes must not hold the Project mutation queue");
  release();
  await Promise.all([first, token]);
  await states.close();
});
test("write-behind coalesces a burst and flush durably saves the latest state", async () => {
  const { states, saves } = harness();
  await states.update("/p", bump);
  await states.update("/p", bump);
  assert.equal(saves.length, 0);
  assert.equal((await states.get("/p")).count, 2);
  await states.flush();
  assert.deepEqual(
    saves.map((x) => x.state.count),
    [2],
  );
});
test("transient agent updates stay in memory without scheduling a write", async () => {
  const { states, saves } = harness();
  await states.update("/p", bump, { persist: false });
  await states.flush();
  assert.equal(saves.length, 0);
  assert.equal((await states.get("/p")).count, 1);
});

test("quit persists the latest transient state without making transient flushes save", async () => {
  const { states, saves } = harness();
  await states.update("/p", bump, { persist: false });
  await states.flush();
  assert.equal(saves.length, 0);
  await states.close();
  assert.equal(saves[0].state.count, 1);
});

test("streaming changes produce one save after the 250 ms trailing debounce", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const { states, saves } = harness();
  for (let i = 0; i < 10; i++) {
    await states.update("/p", bump);
    t.mock.timers.tick(25);
  }
  assert.equal(saves.length, 0);
  t.mock.timers.tick(225);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(
    saves.map((s) => s.state.count),
    [10],
  );
  await states.close();
});

test("an edit made during a slow save is flushed after it with no overlapping writes", async () => {
  let release;
  const disk = new Promise((resolve) => (release = resolve));
  const saved = [];
  let active = 0,
    max = 0;
  const states = new ProjectStates({
    read: async () => ({ count: 0 }),
    save: async (_p, state) => {
      max = Math.max(max, ++active);
      saved.push(state.count);
      if (state.count === 1) await disk;
      active--;
    },
  });
  await states.update("/p", bump);
  const flushing = states.flush();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(saved, [1]);
  await states.update("/p", bump);
  release();
  await flushing;
  await states.close();
  assert.deepEqual(saved, [1, 2]);
  assert.equal(max, 1);
});

test("a compaction runs on the state read and on each change, and the slim state is the one kept and saved", async () => {
  const saves = [];
  const calls = [];
  const states = new ProjectStates({
    read: async () => ({ count: 0, heavy: true }),
    save: async (_projectPath, state) => saves.push(state),
    compact: async (projectPath, next, previous) => {
      calls.push({ projectPath, previous: previous?.count ?? null });
      return next.heavy ? { ...next, heavy: false } : next;
    },
  });
  assert.deepEqual(await states.get("/a"), { count: 0, heavy: false });
  await states.update("/a", (state) => ({ ...state, count: 1, heavy: true }));
  await states.flush();
  assert.deepEqual(calls, [
    { projectPath: "/a", previous: null },
    { projectPath: "/a", previous: 0 },
  ]);
  assert.deepEqual(await states.get("/a"), { count: 1, heavy: false });
  assert.deepEqual(saves, [{ count: 1, heavy: false }]);
});

test("a compaction that fails keeps the change as it is", async () => {
  const states = new ProjectStates({
    read: async () => ({ count: 0 }),
    save: async () => {},
    compact: async (_projectPath, next) => {
      if (next.count) throw new Error("disk full");
      return next;
    },
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const result = await states.update("/a", bump);
    assert.deepEqual(result, { state: { count: 1 }, changed: true });
  } finally {
    console.warn = warn;
  }
});
