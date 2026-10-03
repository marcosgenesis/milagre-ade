const { requireWorktreeRoot } = require("@milagre/core/editors");

// project:reveal. Opens a project or worktree folder in the file manager. Only the top folder of a
// git checkout opens, so the renderer can't point it at "/" or any other folder.
async function revealFolder(folder, { open, checkRoot = requireWorktreeRoot }) {
  await checkRoot(folder);
  const error = await open(folder);
  if (error) throw new Error(error);
}

module.exports = { revealFolder };
