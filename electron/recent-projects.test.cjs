const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MAX_RECENT, createRecentProjects, rememberProject, switchTarget } = require("./recent-projects.cjs");

async function tempDir(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-recent-")));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function folders(base, ...names) {
  return Promise.all(names.map(async (name) => {
    const folder = path.join(base, name);
    await fs.mkdir(folder, { recursive: true });
    return folder;
  }));
}

function gitRepo(folder) {
  execFileSync("/usr/bin/git", ["init", "-q"], { cwd: folder });
  return folder;
}

// A clock that moves one second per call, so each add has its own openedAt.
function clock() {
  let tick = Date.parse("2026-10-01T10:00:00.000Z");
  return () => new Date((tick += 1000));
}

test("adding a project puts it first, with its name and when it was opened", async (t) => {
  const base = await tempDir(t);
  const [alpha, beta] = await folders(base, "alpha", "beta");
  const recent = createRecentProjects(path.join(base, "data", "recent-projects.json"), { now: clock() });

  assert.deepEqual(await recent.list(), []);
  await recent.add(alpha);
  const list = await recent.add(beta);

  assert.deepEqual(list, [
    { path: beta, name: "beta", openedAt: "2026-10-01T10:00:02.000Z" },
    { path: alpha, name: "alpha", openedAt: "2026-10-01T10:00:01.000Z" },
  ]);
  assert.deepEqual(await recent.list(), list);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(base, "data", "recent-projects.json"), "utf8")), list);
});

test("opening a listed project again moves it to the top without a second entry", async (t) => {
  const base = await tempDir(t);
  const [alpha, beta, gamma] = await folders(base, "alpha", "beta", "gamma");
  const recent = createRecentProjects(path.join(base, "recent-projects.json"), { now: clock() });
  for (const folder of [alpha, beta, gamma]) await recent.add(folder);

  const list = await recent.add(alpha);

  assert.deepEqual(list.map((entry) => entry.name), ["alpha", "gamma", "beta"]);
  assert.equal(list[0].openedAt, "2026-10-01T10:00:04.000Z");
});

test("the list keeps the 10 most recent projects", async (t) => {
  const base = await tempDir(t);
  const names = Array.from({ length: MAX_RECENT + 2 }, (_, index) => `project-${index}`);
  const paths = await folders(base, ...names);
  const recent = createRecentProjects(path.join(base, "recent-projects.json"), { now: clock() });
  for (const folder of paths) await recent.add(folder);

  const list = await recent.list();

  assert.equal(MAX_RECENT, 10);
  assert.deepEqual(list.map((entry) => entry.name), names.slice(2).reverse());
});

test("a folder that no longer exists is dropped when the list is read, and from the file on the next write", async (t) => {
  const base = await tempDir(t);
  const [alpha, beta, gamma] = await folders(base, "alpha", "beta", "gamma");
  const file = path.join(base, "recent-projects.json");
  const recent = createRecentProjects(file, { now: clock() });
  for (const folder of [alpha, beta]) await recent.add(folder);
  await fs.rm(alpha, { recursive: true });
  // A file in a folder's place is not a project either.
  await fs.writeFile(path.join(base, "file"), "");
  await fs.writeFile(file, JSON.stringify([...JSON.parse(await fs.readFile(file, "utf8")), { path: path.join(base, "file"), name: "file", openedAt: "2026-01-01T00:00:00.000Z" }]));

  assert.deepEqual((await recent.list()).map((entry) => entry.name), ["beta"]);

  await recent.add(gamma);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).map((entry) => entry.name), ["gamma", "beta"]);
});

test("a corrupt or odd file reads as an empty list, and the next write replaces it", async (t) => {
  const base = await tempDir(t);
  const [alpha, beta] = await folders(base, "alpha", "beta");
  const file = path.join(base, "recent-projects.json");
  const recent = createRecentProjects(file, { now: clock() });

  for (const contents of ["{not json", "", "null", "{\"projects\":[]}", "42"]) {
    await fs.writeFile(file, contents);
    assert.deepEqual(await recent.list(), [], contents);
  }

  await fs.writeFile(file, "{not json");
  assert.deepEqual((await recent.add(alpha)).map((entry) => entry.name), ["alpha"]);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).map((entry) => entry.name), ["alpha"]);

  // Entries that aren't a project's absolute path are skipped; the rest are kept, once each.
  await fs.writeFile(file, JSON.stringify([
    null, "x", { path: "relative/folder", name: "r" }, { path: 7 }, { name: "no path" },
    { path: beta, name: "beta", openedAt: "2026-01-02T00:00:00.000Z" },
    { path: beta, name: "beta again", openedAt: "2026-01-01T00:00:00.000Z" },
    { path: alpha },
  ]));
  assert.deepEqual(await recent.list(), [
    { path: beta, name: "beta", openedAt: "2026-01-02T00:00:00.000Z" },
    { path: alpha, name: "alpha", openedAt: "" },
  ]);
});

test("writes are atomic: saves run one at a time and leave no temporary files", async (t) => {
  const base = await tempDir(t);
  const names = ["a", "b", "c", "d", "e", "f"];
  const paths = await folders(base, ...names);
  const data = path.join(base, "data");
  const recent = createRecentProjects(path.join(data, "recent-projects.json"), { now: clock() });

  await Promise.all(paths.map((folder) => recent.add(folder)));

  assert.deepEqual(await fs.readdir(data), ["recent-projects.json"]);
  assert.deepEqual((await recent.list()).map((entry) => entry.name), [...names].reverse());
});

test("a file that can't be read is never overwritten, and a failed write doesn't block the next one", async (t) => {
  const base = await tempDir(t);
  const [alpha, beta] = await folders(base, "alpha", "beta");
  const file = path.join(base, "recent-projects.json");
  await fs.writeFile(file, JSON.stringify([{ path: beta, name: "beta", openedAt: "2026-01-01T00:00:00.000Z" }]));
  await fs.chmod(file, 0o000);
  t.after(() => fs.chmod(file, 0o600).catch(() => {}));
  const recent = createRecentProjects(file, { now: clock() });

  assert.deepEqual(await recent.list(), []);
  await assert.rejects(recent.add(alpha));

  await fs.chmod(file, 0o600);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).map((entry) => entry.name), ["beta"]);
  assert.deepEqual((await recent.add(alpha)).map((entry) => entry.name), ["alpha", "beta"]);
});

test("forgetting a project takes it off the list and leaves its folder alone", async (t) => {
  const base = await tempDir(t);
  const [alpha, beta] = await folders(base, "alpha", "beta");
  await fs.writeFile(path.join(alpha, "notes.txt"), "keep me");
  const recent = createRecentProjects(path.join(base, "recent-projects.json"), { now: clock() });
  for (const folder of [alpha, beta]) await recent.add(folder);

  assert.deepEqual((await recent.forget(alpha)).map((entry) => entry.name), ["beta"]);
  assert.deepEqual((await recent.list()).map((entry) => entry.name), ["beta"]);
  assert.equal(await fs.readFile(path.join(alpha, "notes.txt"), "utf8"), "keep me");

  // Anything else the renderer sends changes nothing.
  for (const value of [undefined, 7, "relative", path.join(base, "missing")]) {
    assert.deepEqual((await recent.forget(value)).map((entry) => entry.name), ["beta"], String(value));
  }
});

test("only a checkout's top folder is remembered", async (t) => {
  const base = await tempDir(t);
  const [repo, plain] = await folders(base, "repo", "plain");
  gitRepo(repo);
  await fs.mkdir(path.join(repo, "sub"));
  const recent = createRecentProjects(path.join(base, "recent-projects.json"), { now: clock() });

  assert.equal(await rememberProject(recent, repo), true);
  for (const folder of [plain, path.join(repo, "sub"), "/", path.join(base, "missing")]) {
    assert.equal(await rememberProject(recent, folder), false, folder);
  }
  assert.deepEqual((await recent.list()).map((entry) => entry.path), [repo]);
});

test("project:switch opens only a listed project whose real path is a checkout's top folder", async (t) => {
  const base = await tempDir(t);
  const [repo, other, plain] = await folders(base, "repo", "other", "plain");
  gitRepo(repo);
  gitRepo(other);
  const file = path.join(base, "recent-projects.json");
  const recent = createRecentProjects(file, { now: clock() });
  await recent.add(repo);

  assert.equal(await switchTarget(recent, repo), repo);

  // A checkout that isn't listed, and values that aren't a path.
  for (const requested of [other, undefined, 7, "", "repo"]) {
    await assert.rejects(switchTarget(recent, requested), /That project isn't in the list/, String(requested));
  }

  // Listed, but not (or no longer) the top folder of a checkout.
  await fs.mkdir(path.join(repo, "sub"));
  await fs.writeFile(file, JSON.stringify([{ path: plain, name: "plain", openedAt: "" }, { path: path.join(repo, "sub"), name: "sub", openedAt: "" }]));
  for (const requested of [plain, path.join(repo, "sub")]) {
    await assert.rejects(switchTarget(recent, requested), /That folder isn't a project/, requested);
  }

  // A listed symlink is judged by where it leads.
  const link = path.join(base, "link");
  await fs.symlink(path.join(repo, "sub"), link);
  await fs.writeFile(file, JSON.stringify([{ path: link, name: "link", openedAt: "" }]));
  await assert.rejects(switchTarget(recent, link), /That folder isn't a project/);
});
