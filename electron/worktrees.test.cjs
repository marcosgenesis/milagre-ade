const assert = require("node:assert/strict");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createWorktree, listBranches, slugify } = require("./worktrees.cjs");

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

  assert.deepEqual(created, { branch: "milagre/add-a-checkout-page-ab12", path: path.join(worktreeRoot, "shop", "add-a-checkout-page-ab12") });
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
