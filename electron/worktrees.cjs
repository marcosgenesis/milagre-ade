const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

// Worktrees live outside the project so they never show up as untracked files in it.
const DEFAULT_WORKTREE_ROOT = path.join(os.homedir(), ".milagre", "worktrees");

async function git(cwd, args) {
  try {
    return await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  } catch (error) {
    throw new Error(error.stderr?.trim() || error.message);
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

async function createWorktree({ projectPath, baseBranch, prompt = "", root = DEFAULT_WORKTREE_ROOT, suffix = Math.random().toString(36).slice(2, 6) }) {
  const name = `${slugify(prompt) || "chat"}-${suffix}`;
  const branch = `milagre/${name}`;
  const worktreePath = path.join(root, path.basename(projectPath), name);
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  await git(projectPath, ["worktree", "add", "-b", branch, worktreePath, baseBranch]);
  return { branch, path: worktreePath };
}

module.exports = { createWorktree, listBranches, slugify };
