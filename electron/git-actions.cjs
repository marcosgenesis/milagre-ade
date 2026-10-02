const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { PATHSPEC, fileLineCount } = require("./diffstat.cjs");

// Commit, push and open a PR for a chat's folder, from the "Commit and open PR" dialog. Milagre runs
// git and gh itself, never through a shell: every program gets its arguments as an array, and text
// (the commit message, the PR body) goes in on stdin.

const NO_ORIGIN = "This repo has no origin remote.";
const GH_MISSING = "Install the GitHub CLI (`brew install gh`) to open PRs.";
const GH_LOGIN = "Run `gh auth login` in a terminal.";
const PUSH_REJECTED_HINT = "The remote branch has commits you don't have. Pull or rebase, then push again.";
const DETACHED = "Check out a branch to push.";

const OUTPUT_LIMIT = 6000;
const FILE_LIMIT = 300;
const DIFF_LIMIT = 40_000;
// Hooks may run tests, so commits and pushes get time; reads stay quick.
const READ_TIMEOUT = 20_000;
const COMMIT_TIMEOUT = 5 * 60_000;
const PUSH_TIMEOUT = 5 * 60_000;
const GH_TIMEOUT = 60_000;
// The tree of an empty repository, to diff against before the first commit.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const HOOKS = ["pre-commit", "prepare-commit-msg", "commit-msg"];
// Git's own reasons a commit can fail; anything else with a commit hook installed is the hook's.
const GIT_COMMIT_ERRORS = /Please tell me who you are|Author identity unknown|nothing to commit|empty commit message|unable to auto-detect email|could not lock|index\.lock/i;

/** Keeps the end of long output, where tools print what went wrong. */
function capOutput(text, limit = OUTPUT_LIMIT) {
  const trimmed = String(text ?? "").trim();
  return trimmed.length > limit ? `…\n${trimmed.slice(-limit)}` : trimmed;
}

function prNumber(url) {
  const match = /\/pull\/(\d+)/.exec(url ?? "");
  return match ? Number(match[1]) : null;
}

function createGitActions({ execFile = childProcess.execFile, env = process.env } = {}) {
  // No prompt may wait on a terminal nobody sees: git and ssh fail instead of asking for credentials.
  const baseEnv = () => ({
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes",
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
  });

  /** Runs a program and settles with its outcome; it never throws. */
  function run(command, args, { cwd, input, timeout = READ_TIMEOUT } = {}) {
    return new Promise((resolve) => {
      let child;
      try {
        child = execFile(command, args, { cwd, env: baseEnv(), encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout }, (error, stdout, stderr) => {
          resolve({
            ok: !error,
            code: error ? (typeof error.code === "number" ? error.code : null) : 0,
            missing: error?.code === "ENOENT",
            timedOut: Boolean(error?.killed),
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
          });
        });
      } catch (error) {
        resolve({ ok: false, code: null, missing: error.code === "ENOENT", timedOut: false, stdout: "", stderr: error.message });
        return;
      }
      child.stdin?.on("error", () => {});
      child.stdin?.end(input ?? "");
    });
  }

  const git = (cwd, args, options) => run("git", ["-C", cwd, ...args], { cwd, ...options });
  const gitOut = async (cwd, args) => {
    const result = await git(cwd, args);
    return result.ok ? result.stdout.trim() : null;
  };

  async function currentBranch(cwd) {
    return gitOut(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  }

  async function hasOrigin(cwd) {
    return (await git(cwd, ["remote", "get-url", "origin"])).ok;
  }

  async function refExists(cwd, ref) {
    return (await git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).ok;
  }

  /**
   * The branch a PR goes into, as the remote names it, and a ref to compare with: the base the worktree
   * was created from (a remote-tracking `origin/main` names `main`), else the remote's default branch,
   * else a local main or master.
   */
  async function resolveBase(cwd, recorded) {
    if (recorded && (await refExists(cwd, recorded))) {
      const full = await gitOut(cwd, ["rev-parse", "--symbolic-full-name", recorded]);
      const remote = /^refs\/remotes\/[^/]+\/(.+)$/.exec(full ?? "");
      const local = /^refs\/heads\/(.+)$/.exec(full ?? "");
      if (remote || local) return { name: (remote ?? local)[1], ref: recorded };
    }
    const remoteHead = await gitOut(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
    const name = remoteHead?.replace(/^refs\/remotes\/origin\//, "")
      || ((await refExists(cwd, "refs/heads/main")) || (await refExists(cwd, "refs/remotes/origin/main")) ? "main"
        : (await refExists(cwd, "refs/heads/master")) || (await refExists(cwd, "refs/remotes/origin/master")) ? "master"
          : "main");
    for (const ref of [`refs/remotes/origin/${name}`, `refs/heads/${name}`]) if (await refExists(cwd, ref)) return { name, ref };
    return { name, ref: null };
  }

  async function countCommits(cwd, args) {
    const count = await gitOut(cwd, ["rev-list", "--count", ...args]);
    return count && /^\d+$/.test(count) ? Number(count) : 0;
  }

  /** Commits on HEAD the remote doesn't have: ahead of the upstream, or of every origin branch. */
  async function unpushedCount(cwd) {
    if (!(await refExists(cwd, "HEAD"))) return 0;
    if (await refExists(cwd, "@{upstream}")) return countCommits(cwd, ["@{upstream}..HEAD"]);
    return countCommits(cwd, ["HEAD", "--not", "--remotes=origin"]);
  }

  async function changedFiles(cwd) {
    const status = await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", ...PATHSPEC]);
    if (!status.ok) return [];
    const entries = status.stdout.split("\0").filter(Boolean).slice(0, FILE_LIMIT).map((entry) => ({ code: entry.slice(0, 2), path: entry.slice(3) }));
    const head = (await refExists(cwd, "HEAD")) ? "HEAD" : EMPTY_TREE;
    const numstat = await git(cwd, ["diff", "--numstat", "-z", "--no-renames", head, ...PATHSPEC]);
    const counts = new Map();
    for (const record of numstat.ok ? numstat.stdout.split("\0") : []) {
      const [added, removed, file] = record.split("\t");
      if (file) counts.set(file, { added: /^\d+$/.test(added) ? Number(added) : 0, removed: /^\d+$/.test(removed) ? Number(removed) : 0 });
    }
    const files = [];
    for (const { code, path: file } of entries) {
      if (code === "??") {
        files.push({ path: file, status: "added", added: await fileLineCount(path.join(cwd, file)), removed: 0 });
        continue;
      }
      const status = code.includes("D") ? "deleted" : code.includes("A") ? "added" : "modified";
      files.push({ path: file, status, ...(counts.get(file) ?? { added: 0, removed: 0 }) });
    }
    // Byte order, as git lists paths.
    return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  /** The branch's PR and whether gh can open one: `{ ghReady, ghMessage, pr }`. */
  async function findPr(cwd, branch) {
    const result = await run("gh", ["pr", "view", branch, "--json", "url,state"], { cwd, timeout: GH_TIMEOUT });
    if (result.missing) return { ghReady: false, ghMessage: GH_MISSING, pr: null };
    if (!result.ok && isAuthFailure(result)) return { ghReady: false, ghMessage: GH_LOGIN, pr: null };
    if (!result.ok && /no (open )?pull requests? found/i.test(result.stderr)) return { ghReady: true, ghMessage: null, pr: null };
    if (!result.ok) return { ghReady: false, ghMessage: capOutput(result.stderr || result.stdout, 600) || "gh couldn't look up this branch's PR.", pr: null };
    try {
      const view = JSON.parse(result.stdout);
      const open = String(view.state).toUpperCase() === "OPEN" && view.url;
      return { ghReady: true, ghMessage: null, pr: open ? { number: prNumber(view.url), url: view.url, state: "OPEN" } : null };
    } catch {
      return { ghReady: true, ghMessage: null, pr: null };
    }
  }

  function isAuthFailure(result) {
    return result.code === 4 || /gh auth login|not logged in|authentication required/i.test(result.stderr);
  }

  /** What the dialog shows about a chat's folder; `{ isRepo: false }` outside a repository. */
  async function readChanges({ cwd, base }) {
    const top = await gitOut(cwd, ["rev-parse", "--show-toplevel"]);
    if (!top) return { isRepo: false };
    const [branch, files, origin, unpushed, resolved] = await Promise.all([currentBranch(cwd), changedFiles(cwd), hasOrigin(cwd), unpushedCount(cwd), resolveBase(cwd, base)]);
    const onBase = branch === resolved.name;
    const ahead = resolved.ref ? await countCommits(cwd, [`${resolved.ref}..HEAD`]) : 0;
    // gh is only asked when a PR could come of it.
    const gh = origin && branch && !onBase ? await findPr(cwd, branch) : { ghReady: false, ghMessage: null, pr: null };
    return {
      isRepo: true,
      path: top,
      branch,
      base: resolved.name,
      files,
      hasChanges: files.length > 0,
      unpushed,
      ahead,
      hasOrigin: origin,
      onBase,
      ...gh,
    };
  }

  // A failing commit is the hook's doing when a commit hook is installed and git gave none of its own reasons.
  async function hookFailed(cwd, output) {
    if (GIT_COMMIT_ERRORS.test(output)) return false;
    for (const hook of HOOKS) {
      const hookPath = await gitOut(cwd, ["rev-parse", "--git-path", `hooks/${hook}`]);
      if (!hookPath) continue;
      try {
        await fs.access(path.resolve(cwd, hookPath), fs.constants.X_OK);
        return true;
      } catch {}
    }
    return false;
  }

  /** `git add -A`, then `git commit -F -` with the message on stdin. Hooks run; nothing is skipped. */
  async function commit({ cwd, message }) {
    const text = String(message ?? "").trim();
    if (!text) return { ok: false, kind: "error", message: "Write a commit message first." };
    const added = await git(cwd, ["add", "-A", ...PATHSPEC], { timeout: COMMIT_TIMEOUT });
    if (!added.ok) return { ok: false, kind: "error", message: capOutput(added.stderr || added.stdout) };
    if ((await git(cwd, ["diff", "--cached", "--quiet"])).ok) return { ok: false, kind: "nothing", message: "There's nothing to commit." };
    const committed = await git(cwd, ["commit", "-F", "-"], { input: `${text}\n`, timeout: COMMIT_TIMEOUT });
    if (!committed.ok) {
      const output = capOutput([committed.stdout, committed.stderr].filter((part) => part.trim()).join("\n"));
      if (committed.timedOut) return { ok: false, kind: "error", message: "The commit took too long and was stopped.", output };
      if (await hookFailed(cwd, output)) return { ok: false, kind: "hook", message: "The commit failed in a git hook.", output };
      return { ok: false, kind: "error", message: output || "The commit failed." };
    }
    const [sha, shortSha] = await Promise.all([gitOut(cwd, ["rev-parse", "HEAD"]), gitOut(cwd, ["rev-parse", "--short", "HEAD"])]);
    return { ok: true, sha, shortSha };
  }

  /** `git push -u origin <branch>`. Never forced. */
  async function push({ cwd }) {
    if (!(await hasOrigin(cwd))) return { ok: false, kind: "no-origin", message: NO_ORIGIN };
    const branch = await currentBranch(cwd);
    if (!branch) return { ok: false, kind: "error", message: DETACHED };
    const result = await git(cwd, ["push", "-u", "origin", branch], { timeout: PUSH_TIMEOUT });
    if (result.ok) return { ok: true, branch, remote: "origin" };
    const output = capOutput(result.stderr || result.stdout);
    if (/\[rejected\]|non-fast-forward|fetch first|\(stale info\)/i.test(output)) return { ok: false, kind: "rejected", message: output, hint: PUSH_REJECTED_HINT };
    return { ok: false, kind: "error", message: result.timedOut ? "The push took too long and was stopped." : output || "The push failed." };
  }

  /** `gh pr create` from the current branch into the base, with the body on stdin. */
  async function openPr({ cwd, base, title, body }) {
    if (!(await hasOrigin(cwd))) return { ok: false, kind: "no-origin", message: NO_ORIGIN };
    const branch = await currentBranch(cwd);
    if (!branch) return { ok: false, kind: "error", message: DETACHED };
    const resolved = await resolveBase(cwd, base);
    if (branch === resolved.name) return { ok: false, kind: "on-base", message: `You're on ${resolved.name}. Open a PR from a worktree branch.` };
    const prTitle = String(title ?? "").trim();
    if (!prTitle) return { ok: false, kind: "error", message: "Add a PR title first." };
    const result = await run("gh", ["pr", "create", "--base", resolved.name, "--head", branch, "--title", prTitle, "--body-file", "-"], { cwd, input: String(body ?? ""), timeout: GH_TIMEOUT });
    if (result.missing) return { ok: false, kind: "gh-missing", message: GH_MISSING };
    if (!result.ok && isAuthFailure(result)) return { ok: false, kind: "gh-auth", message: GH_LOGIN };
    if (!result.ok) return { ok: false, kind: "error", message: capOutput(result.stderr || result.stdout) || "gh couldn't open the PR." };
    const url = result.stdout.match(/https?:\/\/\S+\/pull\/\d+/g)?.at(-1);
    if (!url) return { ok: false, kind: "error", message: capOutput(result.stdout) || "gh didn't print the PR's link." };
    return { ok: true, url, number: prNumber(url) };
  }

  async function untrackedDiff(cwd, budget) {
    const listed = await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z", ...PATHSPEC]);
    let diff = "";
    for (const file of (listed.ok ? listed.stdout.split("\0").filter(Boolean) : []).slice(0, FILE_LIMIT)) {
      if (diff.length >= budget) break;
      // --no-index exits 1 when the files differ, which they always do here.
      const result = await git(cwd, ["diff", "--no-index", "--no-color", "--no-ext-diff", "--", "/dev/null", file]);
      diff += result.stdout;
    }
    return diff;
  }

  /**
   * What the commit message and PR text are written from: the uncommitted diff (or, with nothing to
   * commit, the branch's diff against its base), the branch's commits, and the repo's recent subjects.
   */
  async function readTextContext({ cwd, base }) {
    const [branch, resolved, files] = await Promise.all([currentBranch(cwd), resolveBase(cwd, base), changedFiles(cwd)]);
    const hasChanges = files.length > 0;
    const hasHead = await refExists(cwd, "HEAD");
    let diff = "";
    if (hasChanges) {
      const tracked = await git(cwd, ["diff", "--no-color", "--no-ext-diff", hasHead ? "HEAD" : EMPTY_TREE, ...PATHSPEC]);
      diff = tracked.stdout;
      if (diff.length < DIFF_LIMIT) diff += await untrackedDiff(cwd, DIFF_LIMIT - diff.length);
    } else if (resolved.ref) {
      diff = (await git(cwd, ["diff", "--no-color", "--no-ext-diff", `${resolved.ref}...HEAD`, ...PATHSPEC])).stdout;
    }
    const lines = async (args) => ((await gitOut(cwd, args)) ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    const [recentSubjects, branchCommits] = await Promise.all([
      hasHead ? lines(["log", "-n", "15", "--format=%s"]) : [],
      hasHead && resolved.ref && branch !== resolved.name ? lines(["log", "-n", "20", "--format=%s", `${resolved.ref}..HEAD`]) : [],
    ]);
    return { diff, recentSubjects, branchCommits, branch, base: resolved.name, hasChanges };
  }

  return { readChanges, commit, push, openPr, readTextContext };
}

module.exports = { DETACHED, GH_LOGIN, GH_MISSING, NO_ORIGIN, PUSH_REJECTED_HINT, capOutput, createGitActions };
