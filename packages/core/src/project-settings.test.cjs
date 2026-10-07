const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createProjectSettings } = require("./project-settings.cjs");

async function store(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "milagre-settings-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "nested", "project-settings.json");
  return { file, settings: createProjectSettings(file) };
}

test("a project with no saved settings has no patterns", async (t) => {
  const { settings } = await store(t);
  assert.deepEqual(await settings.get("/work/shop"), { filesToCopy: [], setupCommand: "", icon: null });
});

test("patterns are saved per project and survive a restart", async (t) => {
  const { file, settings } = await store(t);
  await settings.setFilesToCopy("/work/shop", [".env", "  secrets/*.json  ", "", "   "]);
  await settings.setFilesToCopy("/work/blog", ["*.key"]);
  const reopened = createProjectSettings(file);
  assert.deepEqual(await reopened.get("/work/shop"), { filesToCopy: [".env", "secrets/*.json"], setupCommand: "", icon: null });
  assert.deepEqual(await reopened.get("/work/blog"), { filesToCopy: ["*.key"], setupCommand: "", icon: null });
});

test("saving an empty list brings the default back", async (t) => {
  const { settings } = await store(t);
  await settings.setFilesToCopy("/work/shop", [".env"]);
  await settings.setFilesToCopy("/work/shop", []);
  assert.deepEqual(await settings.get("/work/shop"), { filesToCopy: [], setupCommand: "", icon: null });
});

test("a damaged file reads as empty and is replaced by the next save", async (t) => {
  const { file, settings } = await store(t);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, "{not json");
  assert.deepEqual(await settings.get("/work/shop"), { filesToCopy: [], setupCommand: "", icon: null });
  await settings.setFilesToCopy("/work/shop", [".env"]);
  assert.deepEqual(await settings.get("/work/shop"), { filesToCopy: [".env"], setupCommand: "", icon: null });
});

test("a file that can't be read fails the save and keeps the other projects' patterns", async (t) => {
  const { file, settings } = await store(t);
  await settings.setFilesToCopy("/work/shop", [".env"]);
  await settings.setFilesToCopy("/work/blog", ["*.key"]);
  const before = await fs.readFile(file, "utf8");
  // A directory where the file should be: reading it fails with EISDIR, not ENOENT.
  await fs.rm(file);
  await fs.mkdir(file);
  await assert.rejects(settings.setFilesToCopy("/work/shop", ["new"]), /EISDIR/);
  // Creating a worktree still works: reading is not strict.
  assert.deepEqual(await settings.get("/work/shop"), { filesToCopy: [], setupCommand: "", icon: null });
  await fs.rmdir(file);
  await fs.writeFile(file, before);
  assert.deepEqual(await settings.get("/work/blog"), { filesToCopy: ["*.key"], setupCommand: "", icon: null });
});

test("saves that overlap all land", async (t) => {
  const { settings } = await store(t);
  await Promise.all(["a", "b", "c", "d"].map((name) => settings.setFilesToCopy(`/work/${name}`, [`${name}.env`])));
  for (const name of ["a", "b", "c", "d"])
    assert.deepEqual(await settings.get(`/work/${name}`), { filesToCopy: [`${name}.env`], setupCommand: "", icon: null });
});

test("a setup command is saved per project, trimmed, and removed when empty", async (t) => {
  const { file, settings } = await store(t);
  await settings.setFilesToCopy("/work/shop", [".env"]);
  assert.deepEqual(await settings.setSetupCommand("/work/shop", "  npm ci  "), { setupCommand: "npm ci" });
  const reopened = createProjectSettings(file);
  assert.deepEqual(await reopened.get("/work/shop"), { filesToCopy: [".env"], setupCommand: "npm ci", icon: null });
  await reopened.setSetupCommand("/work/shop", "   ");
  assert.deepEqual(await reopened.get("/work/shop"), { filesToCopy: [".env"], setupCommand: "", icon: null });
  await reopened.setFilesToCopy("/work/shop", []);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).projects, {});
});

test("a chosen icon is saved per project and removed with null", async (t) => {
  const { file, settings } = await store(t);
  const icon = "data:image/png;base64,iVBORw0KGgo=";
  assert.deepEqual(await settings.setIcon("/work/shop", icon), { icon });
  assert.equal((await createProjectSettings(file).get("/work/shop")).icon, icon);
  await assert.rejects(settings.setIcon("/work/shop", "data:image/svg+xml;base64,PHN2Zz4="), /Choose a PNG/);
  await assert.rejects(settings.setIcon("/work/shop", `data:image/png;base64,${"A".repeat(600_000)}`), /Choose a PNG/);
  await settings.setIcon("/work/shop", null);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).projects, {});
});
