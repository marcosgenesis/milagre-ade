const assert = require("node:assert/strict");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { GH_LOGIN, GH_MISSING, NO_ORIGIN, createGitActions } = require("./git-actions.cjs");

// A stand-in for the GitHub CLI: it records each call (arguments, stdin, folder) and answers
// `gh pr view` and `gh pr create` from a state file beside it. Never the real gh.
const FAKE_GH = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const stateFile = path.join(__dirname, "gh-state.json");
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
const args = process.argv.slice(2);
const stdin = args.includes("--body-file") ? fs.readFileSync(0, "utf8") : "";
fs.appendFileSync(path.join(__dirname, "gh-calls.jsonl"), JSON.stringify({ args, stdin, cwd: process.cwd() }) + "\\n");
if (state.loggedOut) {
  process.stderr.write("To get started with GitHub CLI, please run:  gh auth login\\n");
  process.exit(4);
}
const prs = state.prs || {};
if (args[0] === "pr" && args[1] === "view") {
  const pr = prs[args[2]];
  if (!pr) {
    process.stderr.write('no pull requests found for branch "' + args[2] + '"\\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ url: pr.url, state: pr.state }) + "\\n");
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "create") {
  if (state.createError) {
    process.stderr.write(state.createError + "\\n");
    process.exit(1);
  }
  const number = state.nextNumber || 12;
  const url = "https://github.com/example/shop/pull/" + number;
  prs[args[args.indexOf("--head") + 1]] = { url, state: "OPEN" };
  fs.writeFileSync(stateFile, JSON.stringify({ ...state, prs, nextNumber: number + 1 }));
  process.stderr.write("Creating pull request in example/shop\\n");
  process.stdout.write(url + "\\n");
  process.exit(0);
}
process.stderr.write("unknown command\\n");
process.exit(1);
`;

/**
 * A project on main with a local bare repo as origin, and a worktree on its own branch. Git reads no
 * global or system config, and PATH holds the fake gh and the system tools only, so the real gh is
 * out of reach.
 */
async function fixture(t, { origin = true, gh = true } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-actions-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  await fs.mkdir(bin);
  if (gh) await fs.writeFile(path.join(bin, "gh"), FAKE_GH, { mode: 0o755 });
  const gitconfig = path.join(root, "gitconfig");
  await fs.writeFile(gitconfig, "[user]\n\tname = Milagre\n\temail = milagre@example.com\n[init]\n\tdefaultBranch = main\n");
  const env = { HOME: root, PATH: `${bin}:/usr/bin:/bin`, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1" };
  const run = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();

  const project = path.join(root, "shop");
  await fs.mkdir(project);
  run(project, "init", "-b", "main");
  await fs.writeFile(path.join(project, "README.md"), "shop\n");
  await fs.writeFile(path.join(project, "cart.js"), "export const cart = [];\n");
  run(project, "add", ".");
  run(project, "commit", "-m", "init");
  const bare = path.join(root, "origin.git");
  if (origin) {
    run(root, "init", "--bare", "-b", "main", bare);
    run(project, "remote", "add", "origin", bare);
    run(project, "push", "-u", "origin", "main");
  }
  const worktree = path.join(root, "checkout-page");
  run(project, "worktree", "add", "--no-track", "-b", "milagre/checkout-page", worktree, "main");

  const ghCalls = async () => {
    try {
      return (await fs.readFile(path.join(bin, "gh-calls.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  };
  const setGh = (state) => fs.writeFile(path.join(bin, "gh-state.json"), JSON.stringify(state));
  return { root, project, worktree, bare, env, run, ghCalls, setGh, actions: createGitActions({ env }) };
}

test("readChanges lists staged, unstaged and untracked files with their line counts", async (t) => {
  const { worktree, run, actions } = await fixture(t);
  await fs.writeFile(path.join(worktree, "cart.js"), "export const cart = [];\nexport const total = 0;\n");
  await fs.writeFile(path.join(worktree, "checkout.js"), "one\ntwo\nthree\n");
  await fs.writeFile(path.join(worktree, "README.md"), "shop\nstaged line\n");
  run(worktree, "add", "README.md");
  // Milagre's own state isn't the chat's work.
  await fs.mkdir(path.join(worktree, ".milagre"));
  await fs.writeFile(path.join(worktree, ".milagre", "coordination.json"), "{}\n");

  const changes = await actions.readChanges({ cwd: worktree, base: "main" });
  assert.equal(changes.isRepo, true);
  assert.equal(changes.branch, "milagre/checkout-page");
  assert.equal(changes.base, "main");
  assert.equal(changes.hasChanges, true);
  assert.deepEqual(changes.files, [
    { path: "README.md", status: "modified", added: 1, removed: 0 },
    { path: "cart.js", status: "modified", added: 1, removed: 0 },
    { path: "checkout.js", status: "added", added: 3, removed: 0 },
  ]);
  assert.equal(changes.hasOrigin, true);
  assert.equal(changes.onBase, false);
  assert.equal(changes.unpushed, 0);
});

test("readChanges says when a folder is not a repository", async (t) => {
  const { root, actions } = await fixture(t);
  const plain = path.join(root, "plain");
  await fs.mkdir(plain);
  assert.deepEqual(await actions.readChanges({ cwd: plain }), { isRepo: false });
});

test("commit stages everything and takes the message from stdin", async (t) => {
  const { worktree, run, actions } = await fixture(t);
  await fs.writeFile(path.join(worktree, "checkout.js"), "export function checkout() {}\n");
  await fs.writeFile(path.join(worktree, "cart.js"), "export const cart = [1];\n");
  await fs.mkdir(path.join(worktree, ".milagre"));
  await fs.writeFile(path.join(worktree, ".milagre", "coordination.json"), "{}\n");
  const message = "feat: add the checkout page\n\nIt reads the cart's \"total\" and $HOME stays literal.";

  const result = await actions.commit({ cwd: worktree, message });
  assert.equal(result.ok, true);
  assert.equal(result.sha, run(worktree, "rev-parse", "HEAD"));
  assert.equal(result.shortSha, run(worktree, "rev-parse", "--short", "HEAD"));
  assert.equal(run(worktree, "log", "-1", "--format=%B"), message);
  assert.deepEqual(run(worktree, "show", "--name-only", "--format=", "HEAD").split("\n").sort(), ["cart.js", "checkout.js"]);
  // Only Milagre's state is left over.
  assert.equal(run(worktree, "status", "--porcelain", "--untracked-files=all"), "?? .milagre/coordination.json");
});

test("commit refuses an empty message and an empty change", async (t) => {
  const { worktree, actions } = await fixture(t);
  assert.equal((await actions.commit({ cwd: worktree, message: "  \n" })).ok, false);
  const nothing = await actions.commit({ cwd: worktree, message: "fix: nothing" });
  assert.equal(nothing.ok, false);
  assert.equal(nothing.kind, "nothing");
});

test("commit surfaces a failing hook with its output, and makes no commit", async (t) => {
  const { worktree, run, actions } = await fixture(t);
  const hooks = run(worktree, "rev-parse", "--git-path", "hooks");
  await fs.mkdir(path.resolve(worktree, hooks), { recursive: true });
  await fs.writeFile(path.resolve(worktree, hooks, "pre-commit"), "#!/bin/sh\necho 'lint: missing semicolon in checkout.js' >&2\nexit 1\n", { mode: 0o755 });
  await fs.writeFile(path.join(worktree, "checkout.js"), "export function checkout() {}\n");
  const head = run(worktree, "rev-parse", "HEAD");

  const result = await actions.commit({ cwd: worktree, message: "feat: checkout" });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "hook");
  assert.match(result.output, /lint: missing semicolon in checkout\.js/);
  assert.equal(run(worktree, "rev-parse", "HEAD"), head);
});

test("push publishes the branch and sets its upstream", async (t) => {
  const { worktree, bare, run, actions } = await fixture(t);
  await fs.writeFile(path.join(worktree, "checkout.js"), "export function checkout() {}\n");
  const { sha } = await actions.commit({ cwd: worktree, message: "feat: checkout" });

  const result = await actions.push({ cwd: worktree });
  assert.deepEqual(result, { ok: true, branch: "milagre/checkout-page", remote: "origin" });
  assert.equal(run(bare, "rev-parse", "refs/heads/milagre/checkout-page"), sha);
  assert.equal(run(worktree, "rev-parse", "--abbrev-ref", "@{upstream}"), "origin/milagre/checkout-page");
});

test("push reports a rejected push without forcing it", async (t) => {
  const { root, worktree, bare, run, actions } = await fixture(t);
  await fs.writeFile(path.join(worktree, "checkout.js"), "v1\n");
  await actions.commit({ cwd: worktree, message: "feat: checkout v1" });
  assert.equal((await actions.push({ cwd: worktree })).ok, true);
  // Someone else pushes to the same branch.
  const other = path.join(root, "other");
  run(root, "clone", "--branch", "milagre/checkout-page", bare, other);
  await fs.writeFile(path.join(other, "checkout.js"), "theirs\n");
  run(other, "commit", "-am", "feat: their change");
  run(other, "push", "origin", "milagre/checkout-page");
  const theirs = run(bare, "rev-parse", "refs/heads/milagre/checkout-page");
  await fs.writeFile(path.join(worktree, "checkout.js"), "mine\n");
  await actions.commit({ cwd: worktree, message: "feat: my change" });

  const result = await actions.push({ cwd: worktree });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "rejected");
  assert.match(result.message, /rejected/);
  assert.match(result.hint, /pull|rebase/i);
  assert.equal(run(bare, "rev-parse", "refs/heads/milagre/checkout-page"), theirs);
});

test("a repo without origin can commit but not push or open a PR", async (t) => {
  const { worktree, actions, ghCalls } = await fixture(t, { origin: false });
  await fs.writeFile(path.join(worktree, "checkout.js"), "v1\n");
  const changes = await actions.readChanges({ cwd: worktree, base: "main" });
  assert.equal(changes.hasOrigin, false);
  assert.equal(changes.base, "main");
  assert.equal((await actions.commit({ cwd: worktree, message: "feat: checkout" })).ok, true);
  assert.deepEqual(await actions.push({ cwd: worktree }), { ok: false, kind: "no-origin", message: NO_ORIGIN });
  assert.deepEqual(await actions.openPr({ cwd: worktree, base: "main", title: "Checkout", body: "" }), { ok: false, kind: "no-origin", message: NO_ORIGIN });
  assert.deepEqual(await ghCalls(), []);
});

test("without gh, opening a PR says how to install it", async (t) => {
  const { worktree, actions } = await fixture(t, { gh: false });
  const changes = await actions.readChanges({ cwd: worktree, base: "main" });
  assert.equal(changes.ghReady, false);
  assert.equal(changes.ghMessage, GH_MISSING);
  assert.deepEqual(await actions.openPr({ cwd: worktree, base: "main", title: "Checkout", body: "" }), { ok: false, kind: "gh-missing", message: GH_MISSING });
});

test("when gh is signed out, opening a PR says to log in", async (t) => {
  const { worktree, actions, setGh } = await fixture(t);
  await setGh({ loggedOut: true });
  const changes = await actions.readChanges({ cwd: worktree, base: "main" });
  assert.equal(changes.ghReady, false);
  assert.equal(changes.ghMessage, GH_LOGIN);
  assert.deepEqual(await actions.openPr({ cwd: worktree, base: "main", title: "Checkout", body: "" }), { ok: false, kind: "gh-auth", message: GH_LOGIN });
});

test("openPr passes the base, head and title, and the body on stdin", async (t) => {
  const { worktree, actions, ghCalls } = await fixture(t);
  await fs.writeFile(path.join(worktree, "checkout.js"), "v1\n");
  await actions.commit({ cwd: worktree, message: "feat: checkout" });
  await actions.push({ cwd: worktree });
  const body = "Adds the checkout page.\n\n- Reads the cart total";

  // A base recorded as the remote-tracking ref still names the remote's branch.
  const result = await actions.openPr({ cwd: worktree, base: "origin/main", title: "feat: add the checkout page", body });
  assert.deepEqual(result, { ok: true, url: "https://github.com/example/shop/pull/12", number: 12 });
  const calls = await ghCalls();
  assert.deepEqual(calls.at(-1), {
    args: ["pr", "create", "--base", "main", "--head", "milagre/checkout-page", "--title", "feat: add the checkout page", "--body-file", "-"],
    stdin: body,
    cwd: worktree,
  });
});

test("openPr shows gh's own message for any other failure", async (t) => {
  const { worktree, actions, setGh } = await fixture(t);
  await setGh({ createError: "pull request create failed: GraphQL: No commits between main and milagre/checkout-page" });
  const result = await actions.openPr({ cwd: worktree, base: "main", title: "Checkout", body: "" });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "error");
  assert.match(result.message, /No commits between main and milagre\/checkout-page/);
});

test("readChanges finds the branch's open PR", async (t) => {
  const { worktree, actions, setGh, ghCalls } = await fixture(t);
  await setGh({ prs: { "milagre/checkout-page": { url: "https://github.com/example/shop/pull/7", state: "OPEN" } } });
  const changes = await actions.readChanges({ cwd: worktree, base: "main" });
  assert.equal(changes.ghReady, true);
  assert.deepEqual(changes.pr, { number: 7, url: "https://github.com/example/shop/pull/7", state: "OPEN" });
  assert.deepEqual((await ghCalls()).at(-1).args, ["pr", "view", "milagre/checkout-page", "--json", "url,state"]);

  // A merged or closed PR isn't open: a new one can be opened.
  await setGh({ prs: { "milagre/checkout-page": { url: "https://github.com/example/shop/pull/7", state: "MERGED" } } });
  assert.equal((await actions.readChanges({ cwd: worktree, base: "main" })).pr, null);
  await setGh({});
  const none = await actions.readChanges({ cwd: worktree, base: "main" });
  assert.equal(none.ghReady, true);
  assert.equal(none.pr, null);
});

test("readChanges counts commits waiting to be pushed when nothing is left to commit", async (t) => {
  const { worktree, actions } = await fixture(t);
  await fs.writeFile(path.join(worktree, "checkout.js"), "v1\n");
  await actions.commit({ cwd: worktree, message: "feat: checkout" });
  let changes = await actions.readChanges({ cwd: worktree, base: "main" });
  assert.equal(changes.hasChanges, false);
  assert.deepEqual(changes.files, []);
  assert.equal(changes.unpushed, 1);
  assert.equal(changes.ahead, 1);

  await actions.push({ cwd: worktree });
  await fs.writeFile(path.join(worktree, "checkout.js"), "v2\n");
  await actions.commit({ cwd: worktree, message: "feat: checkout v2" });
  changes = await actions.readChanges({ cwd: worktree, base: "main" });
  assert.equal(changes.unpushed, 1);
  assert.equal(changes.ahead, 2);
});

test("the main checkout on its base branch can't open a PR", async (t) => {
  const { project, actions, ghCalls } = await fixture(t);
  await fs.writeFile(path.join(project, "cart.js"), "export const cart = [2];\n");
  const changes = await actions.readChanges({ cwd: project });
  assert.equal(changes.branch, "main");
  assert.equal(changes.base, "main");
  assert.equal(changes.onBase, true);
  assert.equal(changes.hasChanges, true);
  // No PR can come of it, so gh isn't asked.
  assert.deepEqual(await ghCalls(), []);
  const result = await actions.openPr({ cwd: project, title: "Cart", body: "" });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "on-base");
});

test("readTextContext gives the diff, untracked files included, and the repo's recent subjects", async (t) => {
  const { worktree, run, actions } = await fixture(t);
  for (let index = 1; index <= 16; index++) run(worktree, "commit", "--allow-empty", "-m", `chore: step ${index}`);
  await fs.writeFile(path.join(worktree, "cart.js"), "export const cart = [3];\n");
  await fs.writeFile(path.join(worktree, "checkout.js"), "export function checkout() {}\n");

  const context = await actions.readTextContext({ cwd: worktree, base: "main" });
  assert.match(context.diff, /-export const cart = \[\];\n\+export const cart = \[3\];/);
  assert.match(context.diff, /\+export function checkout\(\) \{\}/);
  assert.equal(context.recentSubjects.length, 15);
  assert.equal(context.recentSubjects[0], "chore: step 16");
  assert.equal(context.branchCommits.length, 16);
  assert.equal(context.branch, "milagre/checkout-page");
  assert.equal(context.base, "main");

  // With nothing left to commit, the PR is described by the branch's own changes.
  await actions.commit({ cwd: worktree, message: "feat: checkout" });
  const committed = await actions.readTextContext({ cwd: worktree, base: "main" });
  assert.match(committed.diff, /\+export function checkout\(\) \{\}/);
  assert.equal(committed.hasChanges, false);
});
