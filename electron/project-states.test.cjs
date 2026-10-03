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

test("reads a project once and saves each change", async () => {
  const { states, reads, saves } = harness();
  assert.equal(states.has("/a"), false);
  await states.update("/a", bump);
  await states.update("/a", bump);

  assert.deepEqual(reads, ["/a"]);
  assert.equal(states.has("/a"), true);
  assert.deepEqual(states.projects(), ["/a"]);
  assert.deepEqual(saves.map((save) => save.state.count), [1, 2]);
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
  assert.equal(saves.length, 3);
});

test("a change that leaves the state as it was saves nothing", async () => {
  const { states, saves } = harness();
  const result = await states.update("/a", (state) => state);

  assert.equal(result.changed, false);
  assert.deepEqual(saves, []);
});

test("a change that throws leaves the state as it was and doesn't block the next one", async () => {
  const { states } = harness();
  await assert.rejects(states.update("/a", () => { throw new Error("gone"); }), /gone/);
  await states.update("/a", bump);

  assert.deepEqual(await states.get("/a"), { project: "/a", count: 1 });
});

test("a failed save keeps the change, and the next save writes it", async () => {
  const { states, saves } = harness({ failSaves: 1 });
  const first = await states.update("/a", bump);
  await states.update("/a", bump);

  assert.equal(first.changed, true);
  assert.deepEqual(saves.map((save) => save.state.count), [1, 2]);
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
