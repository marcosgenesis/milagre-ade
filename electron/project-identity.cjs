const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 10_000 });
  return stdout.trim();
}

async function listedWorktrees(cwd) {
  const listing = await git(cwd, "worktree", "list", "--porcelain");
  return listing.split(/\n(?=worktree )/).filter(Boolean).map((block) => {
    const worktreePath = block.match(/^worktree (.+)$/m)?.[1];
    const branchRef = block.match(/^branch (.+)$/m)?.[1];
    return worktreePath ? {
      path: worktreePath,
      name: branchRef?.replace(/^refs\/heads\//, "") || path.basename(worktreePath),
    } : null;
  }).filter(Boolean);
}

async function isDirectory(folder) {
  try { return (await fs.stat(folder)).isDirectory(); } catch { return false; }
}

async function activeWorktrees(projectPath) {
  const listed = await listedWorktrees(projectPath);
  const present = await Promise.all(listed.map((worktree) => isDirectory(worktree.path)));
  return listed.filter((_worktree, index) => present[index]);
}

// Git's common directory is shared by the main checkout and all linked worktrees. The first entry in
// `git worktree list` is the main checkout, where Milagre keeps the Project's coordination state.
async function resolveProject(openedPath) {
  if (typeof openedPath !== "string" || !path.isAbsolute(openedPath)) throw new Error("Choose a Git worktree.");
  const opened = await fs.realpath(openedPath);
  const top = await fs.realpath(await git(opened, "rev-parse", "--show-toplevel"));
  const commonDir = await fs.realpath(path.resolve(top, await git(top, "rev-parse", "--git-common-dir")));
  const main = (await listedWorktrees(top))[0]?.path;
  if (!main || !await isDirectory(main)) throw new Error("The Project's main checkout is missing.");
  const projectPath = await fs.realpath(main);
  return { id: commonDir, path: projectPath, name: path.basename(projectPath) };
}

module.exports = { activeWorktrees, resolveProject };
