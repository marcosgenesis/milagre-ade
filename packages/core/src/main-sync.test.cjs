const assert = require("node:assert/strict");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { syncMainBranch } = require("./main-sync.cjs");

const ID = ["-c", "user.name=Milagre", "-c", "user.email=milagre@example.com"];
const gitIn =
  (dir) =>
  (...args) =>
    execFileSync("git", ["-C", dir, ...ID, ...args], { encoding: "utf8" }).trim();
const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

// A clone whose main is one commit behind its remote. With `onWork`, the clone has another branch checked out.
async function fixture(t, { onWork = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-main-sync-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote");
  await fs.mkdir(remote);
  const remoteGit = gitIn(remote);
  remoteGit("init", "-q", "-b", "main");
  await fs.writeFile(path.join(remote, "README.md"), "shop\n");
  remoteGit("add", ".");
  remoteGit("commit", "-qm", "init");
  const project = path.join(root, "project");
  execFileSync("git", ["clone", "--quiet", remote, project]);
  const git = gitIn(project);
  if (onWork) git("switch", "-q", "-c", "work");
  await fs.writeFile(path.join(remote, "NEWS.md"), "shipped\n");
  remoteGit("add", ".");
  remoteGit("commit", "-qm", "ship");
  return { root, remote, project, git, behind: git("rev-parse", "main"), ahead: remoteGit("rev-parse", "main") };
}

test("main that isn't checked out anywhere fast-forwards without touching the checkout", async (t) => {
  const { project, git, ahead } = await fixture(t, { onWork: true });
  const result = await syncMainBranch(project, { now: () => 42 });
  assert.deepEqual(result, { at: 42, outcome: "updated", branch: "main", commit: ahead.slice(0, 7) });
  assert.equal(git("rev-parse", "main"), ahead);
  assert.equal(git("branch", "--show-current"), "work");
  assert.equal(await exists(path.join(project, "NEWS.md")), false);
});

test("a clean main checkout fast-forwards its files", async (t) => {
  const { project, git, ahead } = await fixture(t);
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "updated");
  assert.equal(git("rev-parse", "HEAD"), ahead);
  assert.equal(await fs.readFile(path.join(project, "NEWS.md"), "utf8"), "shipped\n");
});

test("a second sync reports up to date", async (t) => {
  const { project, ahead } = await fixture(t);
  await syncMainBranch(project);
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "up-to-date");
  assert.equal(result.commit, ahead.slice(0, 7));
});

test("main with commits of its own is skipped and left alone", async (t) => {
  const { project, git } = await fixture(t);
  await fs.writeFile(path.join(project, "LOCAL.md"), "mine\n");
  git("add", ".");
  git("commit", "-qm", "local");
  const before = git("rev-parse", "main");
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "skipped");
  assert.match(result.message, /main has commits that aren't on origin/);
  assert.equal(git("rev-parse", "main"), before);
});

test("a main checkout with uncommitted changes is skipped", async (t) => {
  const { project, git, behind } = await fixture(t);
  await fs.writeFile(path.join(project, "README.md"), "edited\n");
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "skipped");
  assert.equal(result.message, "The main checkout has uncommitted changes");
  assert.equal(git("rev-parse", "main"), behind);
  assert.equal(await fs.readFile(path.join(project, "README.md"), "utf8"), "edited\n");
});

test("a main checkout in the middle of a merge is skipped", async (t) => {
  const { project, git, behind } = await fixture(t);
  await fs.writeFile(path.join(project, ".git", "MERGE_HEAD"), `${behind}\n`);
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "skipped");
  assert.equal(result.message, "The main checkout is in the middle of a merge");
  assert.equal(git("rev-parse", "main"), behind);
});

test("an unreachable remote fails without changing anything", async (t) => {
  const { project, remote, git, behind } = await fixture(t);
  await fs.rm(remote, { recursive: true, force: true });
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "failed");
  assert.equal(result.message, "Could not reach origin");
  assert.equal(git("rev-parse", "main"), behind);
});

test("main without an upstream is skipped", async (t) => {
  const { project, git } = await fixture(t);
  git("branch", "--unset-upstream", "main");
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "skipped");
  assert.equal(result.message, "main has no remote branch");
});

test("an untracked file in the way is skipped with git's reason", async (t) => {
  const { project, git, behind } = await fixture(t);
  await fs.writeFile(path.join(project, "NEWS.md"), "my draft\n");
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "skipped");
  assert.match(result.message, /would be overwritten/);
  assert.equal(git("rev-parse", "main"), behind);
  assert.equal(await fs.readFile(path.join(project, "NEWS.md"), "utf8"), "my draft\n");
});

test("main checked out in another worktree updates that worktree", async (t) => {
  const { root, project, git, ahead } = await fixture(t, { onWork: true });
  const other = path.join(root, "other");
  git("worktree", "add", "-q", other, "main");
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "updated");
  assert.equal(await fs.readFile(path.join(other, "NEWS.md"), "utf8"), "shipped\n");
  assert.equal(git("rev-parse", "main"), ahead);
});

test("a dirty other worktree is named in the skip message", async (t) => {
  const { root, project, git } = await fixture(t, { onWork: true });
  const other = path.join(root, "other");
  git("worktree", "add", "-q", other, "main");
  await fs.writeFile(path.join(other, "README.md"), "edited\n");
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "skipped");
  assert.equal(result.message, "other has uncommitted changes on main");
});

test("a detached worktree named like main is not mistaken for its checkout", async (t) => {
  const { root, project, git, behind, ahead } = await fixture(t, { onWork: true });
  const decoy = path.join(root, "main");
  git("worktree", "add", "-q", "--detach", decoy, behind);
  await fs.writeFile(path.join(decoy, "README.md"), "edited\n");
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "updated");
  assert.equal(git("rev-parse", "main"), ahead);
});

test("a folder that isn't a repository resolves instead of throwing", async (t) => {
  const { root } = await fixture(t);
  const result = await syncMainBranch(root);
  assert.equal(result.outcome, "skipped");
  assert.equal(result.message, "No local main branch");
});
