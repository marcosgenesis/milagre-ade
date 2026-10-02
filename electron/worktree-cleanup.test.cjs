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
// What the app sends: the status the user saw (taken now, before anything changes), the base and the project.
const remove = async (fx, wt, { force = false, seen, ...rest } = {}) =>
  removeWorktree({ path: wt.path, root: fx.worktreeRoot, projectPath: fx.project, base: wt.base, force, seen: force ? (seen ?? (await worktreeStatus(wt.path, wt.base))) : undefined, ...rest });
const branches = (fx) => fx.git("branch", "--format=%(refname:short)").split("\n").filter(Boolean);

test("a fresh worktree is removable", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("a1");
  assert.deepEqual(await worktreeStatus(wt.path, wt.base), { uncommitted: 0, unpushed: 0, branch: wt.branch, head: wt.git("rev-parse", "HEAD").trim(), removable: true });
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
  assert.deepEqual(await worktreeStatus(wt.path, wt.base), { uncommitted: 0, unpushed: 2, branch: wt.branch, head: wt.git("rev-parse", "HEAD").trim(), removable: false });
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
  const result = await remove(fx, wt);
  assert.equal(await exists(wt.path), false);
  assert.equal(result.branchDeleted, true);
  assert.equal(branches(fx).includes(wt.branch), false);
});

test("the safe remove keeps a branch git won't call merged, even though its commits are in the base", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("f1");
  await commit(wt);
  // The commit reaches the base (origin/main) but not the local main that `branch -d` compares against.
  wt.git("push", "origin", "HEAD:main");
  assert.equal(wt.base, "origin/main");
  assert.equal((await worktreeStatus(wt.path, wt.base)).removable, true);
  const result = await remove(fx, wt);
  assert.equal(await exists(wt.path), false);
  assert.equal(result.branchDeleted, false);
  assert.equal(branches(fx).includes(wt.branch), true);
});

test("the safe remove of a pushed worktree loses nothing: the commits stay on the remote", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("f2");
  await commit(wt);
  wt.git("push", "-u", "origin", wt.branch);
  await remove(fx, wt);
  assert.equal(await exists(wt.path), false);
  assert.match(fx.git("ls-remote", "origin", wt.branch), /refs\/heads\/milagre/);
});

test("the safe remove refuses a worktree with uncommitted changes", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("g1");
  await fs.writeFile(path.join(wt.path, "new.txt"), "new\n");
  await assert.rejects(remove(fx, wt));
  assert.equal(await exists(path.join(wt.path, "new.txt")), true);
});

test("the forced delete removes a dirty worktree and its unmerged branch", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("h1");
  await commit(wt);
  await fs.writeFile(path.join(wt.path, "dirty.txt"), "x\n");
  const result = await remove(fx, wt, { force: true });
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

test("a symlink under the root that points outside is refused", async (t) => {
  const fx = await fixture(t);
  const outside = path.join(fx.root, "elsewhere");
  fx.git("worktree", "add", "-b", "other", outside);
  await fs.mkdir(path.join(fx.worktreeRoot, "shop"), { recursive: true });
  const link = path.join(fx.worktreeRoot, "shop", "sneaky");
  await fs.symlink(outside, link);
  await assert.rejects(removeWorktree({ path: link, root: fx.worktreeRoot, projectPath: fx.project, base: "main", force: true, seen: { head: "x", uncommitted: 0, unpushed: 0 } }), /outside/);
  assert.equal(await exists(outside), true);
});

test("it refuses the project folder and a worktree of another repository", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("j1");
  await assert.rejects(removeWorktree({ path: wt.path, root: fx.worktreeRoot, projectPath: wt.path, base: "main", force: false }), /project folder/);
  const other = path.join(fx.root, "other-repo");
  await fs.mkdir(other);
  execFileSync("git", ["-C", other, "init", "-q", "-b", "main"]);
  await assert.rejects(removeWorktree({ path: wt.path, root: fx.worktreeRoot, projectPath: other, base: "main", force: false }), /another repository/);
  assert.equal(await exists(wt.path), true);
});

test("the agent's session is closed before the folder is looked at again", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("k1");
  const order = [];
  await remove(fx, wt, { closeSession: async () => order.push("closed") });
  order.push("removed");
  assert.deepEqual(order, ["closed", "removed"]);
});

test("safe path: a file written while the session closed keeps the worktree", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("l1");
  await assert.rejects(remove(fx, wt, { closeSession: () => fs.writeFile(path.join(wt.path, "late.txt"), "late\n") }), /WORKTREE_CHANGED/);
  assert.equal(await exists(path.join(wt.path, "late.txt")), true);
});

test("safe path: a commit made while the session closed keeps the worktree", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("l2");
  await assert.rejects(remove(fx, wt, { closeSession: () => commit(wt, "late.txt") }), /WORKTREE_CHANGED/);
  assert.equal(await exists(wt.path), true);
});

test("delete path: it refuses when uncommitted files grew, unpushed commits grew, or HEAD moved", async (t) => {
  const fx = await fixture(t);
  const grown = await fx.make("m1");
  await fs.writeFile(path.join(grown.path, "one.txt"), "1\n");
  await assert.rejects(remove(fx, grown, { force: true, closeSession: () => fs.writeFile(path.join(grown.path, "two.txt"), "2\n") }), /WORKTREE_CHANGED/);
  assert.equal(await exists(grown.path), true);

  const committed = await fx.make("m2");
  await fs.writeFile(path.join(committed.path, "one.txt"), "1\n");
  await assert.rejects(remove(fx, committed, { force: true, closeSession: async () => { await fs.rm(path.join(committed.path, "one.txt")); await commit(committed, "late.txt"); } }), /WORKTREE_CHANGED/);
  assert.equal(await exists(committed.path), true);
});

test("delete path: it goes ahead when nothing changed, and when the dirt only shrank", async (t) => {
  const fx = await fixture(t);
  const same = await fx.make("n1");
  await fs.writeFile(path.join(same.path, "one.txt"), "1\n");
  await remove(fx, same, { force: true });
  assert.equal(await exists(same.path), false);

  const shrunk = await fx.make("n2");
  await fs.writeFile(path.join(shrunk.path, "one.txt"), "1\n");
  await fs.writeFile(path.join(shrunk.path, "two.txt"), "2\n");
  const seen = await worktreeStatus(shrunk.path, shrunk.base);
  await remove(fx, shrunk, { force: true, seen, closeSession: () => fs.rm(path.join(shrunk.path, "two.txt")) });
  assert.equal(await exists(shrunk.path), false);
});

test("delete path without a status the user saw is refused", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("n3");
  await assert.rejects(removeWorktree({ path: wt.path, root: fx.worktreeRoot, projectPath: fx.project, base: wt.base, force: true }), /WORKTREE_CHANGED/);
});

test("a detached HEAD is never removable, and its stranded commits count as unpushed", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("o1");
  wt.git("switch", "--detach");
  assert.deepEqual({ ...(await worktreeStatus(wt.path, wt.base)), head: undefined }, { uncommitted: 0, unpushed: 0, branch: null, head: undefined, removable: false });
  await commit(wt, "stranded.txt");
  const status = await worktreeStatus(wt.path, wt.base);
  assert.equal(status.unpushed, 1);
  assert.equal(status.removable, false);
  await assert.rejects(remove(fx, wt), /WORKTREE_CHANGED/);
  assert.equal(await exists(wt.path), true);
  // Once the commit is on a branch it no longer counts.
  wt.git("branch", "keep-it");
  assert.equal((await worktreeStatus(wt.path, wt.base)).unpushed, 0);
  // The forced delete still works with the status the user saw.
  await remove(fx, wt, { force: true });
  assert.equal(await exists(wt.path), false);
});

test("a base that looks like a flag, or a ref that is also a folder, is read as what it is", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("p1");
  await commit(wt, "one.txt");
  await assert.rejects(worktreeStatus(wt.path, "--all"));
  await fs.mkdir(path.join(wt.path, "main"));
  await fs.writeFile(path.join(wt.path, "main", "x.txt"), "x\n");
  const status = await worktreeStatus(wt.path, "main");
  assert.equal(status.unpushed, 1);
  assert.equal(status.uncommitted, 1);
});

test("it only deletes branches Milagre made", async (t) => {
  const fx = await fixture(t);
  const wt = await fx.make("i1");
  wt.git("switch", "-c", "feature/mine");
  await commit(wt);
  const result = await remove(fx, wt, { force: true });
  assert.equal(result.branchDeleted, false);
  assert.equal(branches(fx).includes("feature/mine"), true);
});
