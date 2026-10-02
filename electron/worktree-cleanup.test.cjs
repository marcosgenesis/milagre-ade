const assert = require("node:assert/strict");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createWorktree } = require("./worktrees.cjs");
const { removeWorktree, worktreeStatus } = require("./worktree-cleanup.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "milagre-cleanup-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, "shop");
  const remote = path.join(root, "remote.git");
  await fs.mkdir(project);
  const run = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=Milagre", "-c", "user.email=milagre@example.com", ...args], { encoding: "utf8" });
  run(project, "init", "-b", "main");
  await fs.writeFile(path.join(project, ".gitignore"), ".env*\n");
  await fs.writeFile(path.join(project, "README.md"), "shop\n");
  run(project, "add", ".");
  run(project, "commit", "-m", "init");
  execFileSync("git", ["init", "--bare", "-b", "main", remote]);
  run(project, "remote", "add", "origin", remote);
  run(project, "push", "-u", "origin", "main");
  const worktreeRoot = path.join(root, "worktrees");
  const make = async (suffix) => {
    const created = await createWorktree({ projectPath: project, baseBranch: "main", prompt: "task", root: worktreeRoot, suffix });
    return { ...created, git: (...args) => run(created.path, ...args) };
  };
  return { root, project, worktreeRoot, make, git: (...args) => run(project, ...args) };
}

const commit = async (worktree, name = "change.txt") => {
  await fs.writeFile(path.join(worktree.path, name), `${name}\n`);
  worktree.git("add", name);
  worktree.git("commit", "-m", `add ${name}`);
};
const exists = (file) => fs.lstat(file).then(() => true, () => false);
const branches = (fx) => fx.git("branch", "--format=%(refname:short)").split("\n").filter(Boolean);

test("a fresh worktree is removable", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("a1");
  assert.deepEqual(await worktreeStatus(wt.path, wt.base), { uncommitted: 0, unpushed: 0, branch: wt.branch, removable: true });
});

test("copied env files and other ignored files do not count as uncommitted", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("a2");
  await fs.writeFile(path.join(wt.path, ".env"), "KEY=1\n");
  assert.equal((await worktreeStatus(wt.path, wt.base)).uncommitted, 0);
});

test("uncommitted counts modified, staged and untracked files", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("b1");
  await fs.writeFile(path.join(wt.path, "README.md"), "changed\n");
  await fs.writeFile(path.join(wt.path, "new.txt"), "new\n");
  await fs.mkdir(path.join(wt.path, "dir"));
  await fs.writeFile(path.join(wt.path, "dir", "one.txt"), "1\n");
  await fs.writeFile(path.join(wt.path, "dir", "two.txt"), "2\n");
  const status = await worktreeStatus(wt.path, wt.base);
  assert.equal(status.uncommitted, 4);
  assert.equal(status.removable, false);
});

test("unpushed counts commits on neither the base nor the upstream; no upstream counts from the base", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("c1");
  await commit(wt, "one.txt");
  await commit(wt, "two.txt");
  assert.deepEqual(await worktreeStatus(wt.path, wt.base), { uncommitted: 0, unpushed: 2, branch: wt.branch, removable: false });
  wt.git("push", "-u", "origin", wt.branch);
  assert.equal((await worktreeStatus(wt.path, wt.base)).unpushed, 0);
  await commit(wt, "three.txt");
  assert.equal((await worktreeStatus(wt.path, wt.base)).unpushed, 1);
});

test("a branch merged into its base has nothing unpushed", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("d1");
  await commit(wt, "one.txt");
  fx.git("merge", "--ff-only", wt.branch);
  assert.equal((await worktreeStatus(wt.path, "main")).unpushed, 0);
});

test("the safe remove deletes a clean worktree and its merged branch", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("e1");
  await fs.writeFile(path.join(wt.path, ".env"), "KEY=1\n");
  const result = await removeWorktree({ path: wt.path, root: fx.worktreeRoot, force: false });
  assert.equal(await exists(wt.path), false);
  assert.equal(result.branchDeleted, true);
  assert.equal(branches(fx).includes(wt.branch), false);
});

test("the safe remove keeps a branch whose commits are merged nowhere", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("f1");
  await commit(wt);
  const result = await removeWorktree({ path: wt.path, root: fx.worktreeRoot, force: false });
  assert.equal(await exists(wt.path), false);
  assert.equal(result.branchDeleted, false);
  assert.equal(branches(fx).includes(wt.branch), true);
});

test("the safe remove of a pushed worktree loses nothing: the commits stay on the remote", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("f2");
  await commit(wt);
  wt.git("push", "-u", "origin", wt.branch);
  await removeWorktree({ path: wt.path, root: fx.worktreeRoot, force: false });
  assert.equal(await exists(wt.path), false);
  assert.match(fx.git("ls-remote", "origin", wt.branch), /refs\/heads\/milagre/);
});

test("the safe remove refuses a worktree with uncommitted changes", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("g1");
  await fs.writeFile(path.join(wt.path, "new.txt"), "new\n");
  await assert.rejects(removeWorktree({ path: wt.path, root: fx.worktreeRoot, force: false }));
  assert.equal(await exists(path.join(wt.path, "new.txt")), true);
});

test("the forced delete removes a dirty worktree and its unmerged branch", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("h1");
  await commit(wt);
  await fs.writeFile(path.join(wt.path, "dirty.txt"), "x\n");
  const result = await removeWorktree({ path: wt.path, root: fx.worktreeRoot, force: true });
  assert.equal(await exists(wt.path), false);
  assert.equal(result.branchDeleted, true);
  assert.equal(branches(fx).includes(wt.branch), false);
});

test("it refuses a path outside the worktree root", async (t) => {
  const fx = await fixture(t);
  const outside = path.join(fx.root, "elsewhere");
  fx.git("worktree", "add", "-b", "other", outside);
  await assert.rejects(removeWorktree({ path: outside, root: fx.worktreeRoot, force: true }), /outside/);
  assert.equal(await exists(outside), true);
  // A path that only shares a prefix with the root is outside too.
  const sibling = `${fx.worktreeRoot}-sibling`;
  fx.git("worktree", "add", "-b", "sibling", sibling);
  await assert.rejects(removeWorktree({ path: sibling, root: fx.worktreeRoot, force: true }), /outside/);
});

test("it refuses the main checkout, even when it sits under the root", async (t) => {
  const fx = await fixture(t);
  await assert.rejects(removeWorktree({ path: fx.project, root: fx.root, force: true }), /main checkout/);
  assert.equal(await exists(path.join(fx.project, "README.md")), true);
  assert.equal(branches(fx).includes("main"), true);
});

test("it only deletes branches Milagre made", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("i1");
  wt.git("switch", "-c", "feature/mine");
  await commit(wt);
  const result = await removeWorktree({ path: wt.path, root: fx.worktreeRoot, force: true });
  assert.equal(result.branchDeleted, false);
  assert.equal(branches(fx).includes("feature/mine"), true);
});
