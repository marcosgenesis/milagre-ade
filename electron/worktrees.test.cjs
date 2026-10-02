const assert = require("node:assert/strict");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createWorktree, listBranches, renameWorktreeBranch, slugify } = require("./worktrees.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "milagre-worktrees-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, "shop");
  await fs.mkdir(project);
  const git = (...args) => execFileSync("git", ["-C", project, "-c", "user.name=Milagre", "-c", "user.email=milagre@example.com", ...args], { encoding: "utf8" });
  git("init", "-b", "main");
  await fs.writeFile(path.join(project, "README.md"), "shop\n");
  git("add", ".");
  git("commit", "-m", "init");
  git("branch", "release/v2");
  return { root, project, git };
}

test("slugify keeps the first words of a prompt as a branch-safe name", () => {
  assert.equal(slugify("Fix the login redirect, please!"), "fix-the-login-redirect-please");
  assert.equal(slugify("Corrija a navegação do menu lateral agora mesmo"), "corrija-a-navegacao-do-menu");
  assert.equal(slugify("   ?!  "), "");
});

test("listBranches returns local branches and nothing outside a repository", async (t) => {
  const { root, project } = await fixture(t);
  assert.deepEqual((await listBranches(project)).sort(), ["main", "release/v2"]);
  assert.deepEqual(await listBranches(root), []);
});

test("createWorktree branches from the base outside the project", async (t) => {
  const { root, project, git } = await fixture(t);
  const worktreeRoot = path.join(root, "worktrees");
  const created = await createWorktree({ projectPath: project, baseBranch: "release/v2", prompt: "Add a checkout page", root: worktreeRoot, suffix: "ab12" });

  assert.deepEqual(created, { branch: "milagre/add-a-checkout-page-ab12", path: path.join(worktreeRoot, "shop", "add-a-checkout-page-ab12"), base: "release/v2" });
  assert.equal((await fs.readFile(path.join(created.path, "README.md"), "utf8")), "shop\n");
  assert.match(git("worktree", "list", "--porcelain"), /branch refs\/heads\/milagre\/add-a-checkout-page-ab12/);
  assert.equal(git("rev-parse", created.branch).trim(), git("rev-parse", "release/v2").trim());
});

test("createWorktree falls back to a generic name and reports git errors", async (t) => {
  const { root, project } = await fixture(t);
  const worktreeRoot = path.join(root, "worktrees");
  const created = await createWorktree({ projectPath: project, baseBranch: "main", prompt: "", root: worktreeRoot, suffix: "zz99" });
  assert.equal(created.branch, "milagre/chat-zz99");
  await assert.rejects(createWorktree({ projectPath: project, baseBranch: "missing", prompt: "x", root: worktreeRoot, suffix: "q1" }), /missing/);
});

test("renameWorktreeBranch renames a running worktree's branch and keeps its folder", async (t) => {
  const { root, project, git } = await fixture(t);
  const created = await createWorktree({ projectPath: project, baseBranch: "main", prompt: "the sidebar thing is broken", root: path.join(root, "worktrees"), suffix: "ef56" });

  assert.equal(await renameWorktreeBranch({ worktreePath: created.path, branch: created.branch, slug: "Fix sidebar collapse" }), "milagre/fix-sidebar-collapse-ef56");
  assert.equal(execFileSync("git", ["-C", created.path, "branch", "--show-current"], { encoding: "utf8" }).trim(), "milagre/fix-sidebar-collapse-ef56");
  assert.match(git("worktree", "list", "--porcelain"), /the-sidebar-thing-is-broken-ef56\nHEAD [0-9a-f]+\nbranch refs\/heads\/milagre\/fix-sidebar-collapse-ef56/);

  // Nothing to do, or the old branch is already gone.
  assert.equal(await renameWorktreeBranch({ worktreePath: created.path, branch: "milagre/fix-sidebar-collapse-ef56", slug: "fix-sidebar-collapse" }), null);
  assert.equal(await renameWorktreeBranch({ worktreePath: created.path, branch: "milagre/fix-sidebar-collapse-ef56", slug: "" }), null);
  assert.equal(await renameWorktreeBranch({ worktreePath: created.path, branch: created.branch, slug: "other-name" }), null);
});

// A project cloned from a remote whose main has since moved on; the local main is one commit behind.
async function trailingClone(t) {
  const { root, project: remote, git: remoteGit } = await fixture(t);
  const project = path.join(root, "clone");
  execFileSync("git", ["clone", "--quiet", remote, project]);
  const git = (...args) => execFileSync("git", ["-C", project, "-c", "user.name=Milagre", "-c", "user.email=milagre@example.com", ...args], { encoding: "utf8" });
  await fs.writeFile(path.join(remote, "NEWS.md"), "shipped\n");
  remoteGit("add", ".");
  remoteGit("commit", "-m", "ship");
  return { root, project, git, remote, remoteGit };
}

test("createWorktree starts a trailing branch from its freshly fetched upstream", async (t) => {
  const { root, project, git, remoteGit } = await trailingClone(t);
  const created = await createWorktree({ projectPath: project, baseBranch: "main", prompt: "x", root: path.join(root, "worktrees"), suffix: "up1" });
  assert.equal(git("rev-parse", created.branch).trim(), remoteGit("rev-parse", "main").trim());
  assert.equal(await fs.readFile(path.join(created.path, "NEWS.md"), "utf8"), "shipped\n");
  // The chat's branch doesn't track the branch it started from.
  assert.throws(() => git("rev-parse", "--abbrev-ref", `${created.branch}@{upstream}`));
});

test("createWorktree keeps a branch's own unpushed commits", async (t) => {
  const { root, project, git } = await trailingClone(t);
  await fs.writeFile(path.join(project, "LOCAL.md"), "mine\n");
  git("add", ".");
  git("commit", "-m", "local");
  const created = await createWorktree({ projectPath: project, baseBranch: "main", prompt: "x", root: path.join(root, "worktrees"), suffix: "lo1" });
  assert.equal(git("rev-parse", created.branch).trim(), git("rev-parse", "main").trim());
});

test("createWorktree starts from the local branch when the remote can't be reached", async (t) => {
  const { root, project, git, remote } = await trailingClone(t);
  await fs.rm(remote, { recursive: true, force: true });
  const created = await createWorktree({ projectPath: project, baseBranch: "main", prompt: "x", root: path.join(root, "worktrees"), suffix: "off1" });
  assert.equal(git("rev-parse", created.branch).trim(), git("rev-parse", "main").trim());
});
