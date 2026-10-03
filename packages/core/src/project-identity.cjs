const { createGit } = require("./git/client.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const client = createGit().read;

async function git(cwd, ...args) {
  return (await client.text(cwd, args)).trim();
}

const listedWorktrees = cwd => client.worktreeList(cwd);

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
  const commonDir = await client.commonDir(top);
  const main = (await listedWorktrees(top))[0]?.path;
  if (!main || !await isDirectory(main)) throw new Error("The Project's main checkout is missing.");
  const projectPath = await fs.realpath(main);
  return { id: commonDir, path: projectPath, name: path.basename(projectPath) };
}

module.exports = { activeWorktrees, resolveProject };
