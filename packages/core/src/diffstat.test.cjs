const assert = require("node:assert/strict");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { diffBase, readDiffStat } = require("./diffstat.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "milagre-diffstat-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, "shop");
  await fs.mkdir(project);
  const git = (...args) => execFileSync("git", ["-C", project, "-c", "user.name=Milagre", "-c", "user.email=milagre@example.com", ...args], { encoding: "utf8" });
  git("init", "-b", "main");
  await fs.writeFile(path.join(project, "README.md"), "one\ntwo\nthree\n");
  git("add", ".");
  git("commit", "-m", "init");
  return { root, project, git };
}

test("readDiffStat counts commits since the base, uncommitted edits and untracked files", async (t) => {
  const { project, git } = await fixture(t);
  git("checkout", "-b", "feature");
  await fs.writeFile(path.join(project, "README.md"), "one\nTWO\nthree\nfour\n");
  git("commit", "-am", "edit");
  await fs.writeFile(path.join(project, "README.md"), "one\nTWO\nfour\n");
  await fs.writeFile(path.join(project, "notes.md"), "a\nb\n");
  await fs.writeFile(path.join(project, "logo.png"), Buffer.from([0, 1, 2, 3]));
  await fs.mkdir(path.join(project, ".milagre"));
  await fs.writeFile(path.join(project, ".milagre", "coordination.json"), "{\n}\n");

  // Against main: README goes one/two/three → one/TWO/four (+2 −2), and notes.md adds 2; the binary file and Milagre's state add nothing.
  assert.deepEqual(await readDiffStat(project, "main"), { added: 4, removed: 2 });
});

test("readDiffStat with no usable base counts only uncommitted work", async (t) => {
  const { project } = await fixture(t);
  assert.deepEqual(await readDiffStat(project, "gone"), { added: 0, removed: 0 });
  await fs.appendFile(path.join(project, "README.md"), "four\n");
  assert.deepEqual(await readDiffStat(project), { added: 1, removed: 0 });
});

test("diffBase shares the recorded/default branch rule with Changes", async (t) => {
  const { root, project } = await fixture(t);
  const clone = path.join(root, "clone");
  execFileSync("git", ["clone", "--quiet", project, clone]);
  assert.equal(await diffBase(clone, "main"), "main");
  assert.equal(await diffBase(clone, "missing"), "refs/remotes/origin/main");
  assert.equal(await diffBase(project, undefined), "refs/heads/main");
});

test("readDiffStat returns null outside a repository", async (t) => {
  const { root } = await fixture(t);
  assert.equal(await readDiffStat(root, "main"), null);
});


test("sidebar totals include branch commits when its upstream is the feature branch", async t => {
  const { project, git } = await fixture(t);
  git('checkout', '-b', 'feature');
  await fs.appendFile(path.join(project, 'README.md'), 'four\n');
  git('commit', '-am', 'feature work');
  git('branch', 'upstream-feature');
  git('branch', '--set-upstream-to=upstream-feature');
  assert.deepEqual(await readDiffStat(project), { added: 1, removed: 0 });
});

test("cachedDiffBase resolves a base once per TTL and per (cwd, base)", async (t) => {
  const { project, git } = await fixture(t);
  const { BASE_TTL, cachedDiffBase } = require("./diffstat.cjs");
  let clock = 1000;
  const now = () => clock;
  assert.equal(await cachedDiffBase(project, "main", now), "main");
  // The branch is renamed, but the answer is remembered until the TTL passes.
  git("branch", "-m", "main", "trunk");
  assert.equal(await cachedDiffBase(project, "main", now), "main");
  assert.equal(await cachedDiffBase(project, "other", now), "HEAD");
  clock += BASE_TTL + 1;
  assert.equal(await cachedDiffBase(project, "main", now), "HEAD");
});

test("an edited untracked file is counted again, a removed one drops out", async (t) => {
  const { project } = await fixture(t);
  await fs.writeFile(path.join(project, "a.md"), "1\n2\n");
  await fs.writeFile(path.join(project, "b.md"), "1\n");
  assert.deepEqual(await readDiffStat(project), { added: 3, removed: 0 });
  await fs.writeFile(path.join(project, "b.md"), "1\n2\n3\n4\n");
  assert.deepEqual(await readDiffStat(project), { added: 6, removed: 0 });
  await fs.rm(path.join(project, "a.md"));
  assert.deepEqual(await readDiffStat(project), { added: 4, removed: 0 });
});

test("an untracked file whose size and mtime are unchanged is not read again", async (t) => {
  const { project } = await fixture(t);
  const file = path.join(project, "a.md");
  await fs.writeFile(file, "1\n2\n");
  await fs.utimes(file, 1e9, 1e9); // whole seconds, so utimes can restore the exact mtime
  assert.deepEqual(await readDiffStat(project), { added: 2, removed: 0 });
  // Same size and mtime, different content: the cached count answers without a read.
  await fs.writeFile(file, "x\n\n\n");
  await fs.utimes(file, 1e9, 1e9);
  assert.deepEqual(await readDiffStat(project), { added: 2, removed: 0 });
});
