const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { saveProjectState, stateFile } = require("./project-store.cjs");

async function tempProject(t) {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "milagre-store-"));
  t.after(() => fs.rm(projectPath, { recursive: true, force: true }));
  return projectPath;
}

test("concurrent saves leave valid JSON equal to the last save", async (t) => {
  const projectPath = await tempProject(t);
  // A long history followed by a short one: interleaved writes leave the long one's tail behind.
  const long = { next_id: 5001, messages: Array.from({ length: 5000 }, (_, id) => ({ id, session_id: 2, body: "x".repeat(200) })) };
  const short = { next_id: 2, messages: [{ id: 1, session_id: 2, body: "hi" }] };

  const { ProjectStates } = require("./project-states.cjs");
  const states = new ProjectStates({ read: async () => ({}), save: saveProjectState });
  await Promise.all([states.update(projectPath, () => long), states.update(projectPath, () => short)]);
  await states.close();

  assert.deepEqual(JSON.parse(await fs.readFile(stateFile(projectPath), "utf8")), short);
});

test("saves leave no temporary files behind", async (t) => {
  const projectPath = await tempProject(t);
  for (let index = 0; index < 5; index++) await saveProjectState(projectPath, { next_id: index });

  assert.deepEqual(await fs.readdir(path.join(projectPath, ".milagre")), ["coordination.json"]);
  assert.deepEqual(JSON.parse(await fs.readFile(stateFile(projectPath), "utf8")), { next_id: 4 });
});

test("a failed save rejects without blocking the next one", async (t) => {
  const projectPath = await tempProject(t);
  const circular = {};
  circular.self = circular;

  await assert.rejects(saveProjectState(projectPath, circular));
  await saveProjectState(projectPath, { next_id: 3 });

  assert.deepEqual(JSON.parse(await fs.readFile(stateFile(projectPath), "utf8")), { next_id: 3 });
  assert.deepEqual(await fs.readdir(path.join(projectPath, ".milagre")), ["coordination.json"]);
});
