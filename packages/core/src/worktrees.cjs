const { createGit } = require("./git/client.cjs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { copyFilesToWorktree } = require("./worktree-files.cjs");

const client = createGit();
const git = client.read.checked;

// Worktrees live outside the project so they never show up as untracked files in it.
const DEFAULT_WORKTREE_ROOT = path.join(os.homedir(), ".milagre", "worktrees");

// The commit a new worktree starts from. A local branch that only trails its upstream (a `main` behind
// `origin/main`) starts from the freshly fetched upstream; one with commits of its own, one without an
// upstream, or one whose remote can't be reached starts from itself.
async function resolveStartRef(projectPath, baseBranch) {
  let upstream = [];
  try {
    const { stdout } = await git(projectPath, ["for-each-ref", "--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:short)", `refs/heads/${baseBranch}`]);
    upstream = stdout.trim().split("\0");
  } catch {}
  const [remote, remoteRef, trackingRef] = upstream;
  // "." is an upstream that is itself a local branch: nothing to fetch.
  if (!remote || remote === "." || !remoteRef || !trackingRef) return baseBranch;
  try {
    await client.write.checked(projectPath, ["fetch", "--quiet", remote, `+${remoteRef}:refs/remotes/${trackingRef}`], { profile: "NETWORK" });
  } catch {
    // Offline: the last fetched upstream is still newer than nothing.
  }
  try {
    await git(projectPath, ["merge-base", "--is-ancestor", "--end-of-options", baseBranch, trackingRef]);
    return trackingRef;
  } catch {
    return baseBranch;
  }
}

async function listBranches(projectPath) {
  try {
    const { stdout } = await git(projectPath, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"]);
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function slugify(text) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join("-")
    .slice(0, 40)
    .replace(/-+$/, "");
}

// The base comes from a client (a phone, a window): it must name an existing commit and can never be read as an option.
async function checkBase(projectPath, baseBranch) {
  const valid = typeof baseBranch === "string" && baseBranch !== "" && !baseBranch.startsWith("-") && !/[\0\n]/.test(baseBranch);
  if (!valid || !(await client.read.refExists(projectPath, baseBranch))) throw new Error(`The base branch ${JSON.stringify(String(baseBranch))} is missing from this project.`);
}

async function createWorktree({ projectPath, baseBranch, prompt = "", root = DEFAULT_WORKTREE_ROOT, suffix = Math.random().toString(36).slice(2, 6), copyPatterns, copyLimits }) {
  await checkBase(projectPath, baseBranch);
  const name = `${slugify(prompt) || "chat"}-${suffix}`;
  const branch = `milagre/${name}`;
  const worktreePath = path.join(root, path.basename(projectPath), name);
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  const start = await resolveStartRef(projectPath, baseBranch);
  // --no-track: the chat's branch must not push to, or pull from, the branch it started on.
  await client.write.checked(projectPath, ["worktree", "add", "--no-track", "-b", branch, "--end-of-options", worktreePath, start]);
  // Ignored files the project needs (env files) come along; a failed copy never fails the worktree.
  const copy = await copyFilesToWorktree({ projectPath, worktreePath, setting: copyPatterns, limits: copyLimits });
  // `base` is what the chat's changes are measured against (see diffstat.cjs).
  return { branch, path: worktreePath, base: start, ...(copy.copied.length || copy.notes.length ? { copy } : {}) };
}

// Gives a chat's branch the name picked for it once the chat is already running (see worktree-name.cjs).
// The folder keeps its first name: moving it would pull it out from under the agent. Resolves to the new
// branch, or null when there is nothing to rename or git refuses (the branch is gone, or the name is taken).
async function renameWorktreeBranch({ worktreePath, branch, slug }) {
  const suffix = branch.match(/-([a-z0-9]+)$/)?.[1];
  const name = slugify(slug);
  if (!suffix || !name) return null;
  const renamed = `milagre/${name}-${suffix}`;
  if (renamed === branch) return null;
  try {
    await client.write.checked(worktreePath, ["branch", "-m", branch, renamed]);
    return renamed;
  } catch {
    return null;
  }
}

module.exports = { DEFAULT_WORKTREE_ROOT, createWorktree, listBranches, renameWorktreeBranch, slugify };
