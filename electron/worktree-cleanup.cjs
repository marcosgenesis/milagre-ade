const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

// A hung git must not leave the archive menu on "Checking worktree…": the check fails and the chat only hides.
const GIT_TIMEOUT_MS = 10_000;

// The message a removal refused because the worktree changed after the user looked; the renderer words the notice.
const CHANGED_AFTER_CHECK = "WORKTREE_CHANGED";

async function git(cwd, args) {
  try {
    return (await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: GIT_TIMEOUT_MS })).stdout;
  } catch (error) {
    throw new Error(error.stderr?.trim() || error.message);
  }
}

/** The commit a ref names, or null. `--end-of-options` keeps a ref that looks like a flag from being one. */
async function commitOf(cwd, ref) {
  try {
    return (await git(cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`])).trim() || null;
  } catch {
    return null;
  }
}

/**
 * What archiving a chat would lose from its worktree. `uncommitted` counts `git status` entries (untracked
 * included, ignored files such as a copied .env not); `unpushed` counts commits on neither the branch's
 * upstream nor `base` (just `base` when there is no upstream). On a detached HEAD it counts the commits no
 * branch, remote or `base` reaches, and the worktree is never removable by the safe path. `head` is the
 * commit it is at. Throws when git can't tell.
 */
async function worktreeStatus(worktreePath, base) {
  const porcelain = await git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]);
  const uncommitted = porcelain.split("\n").filter(Boolean).length;
  const head = await commitOf(worktreePath, "HEAD");
  if (!head) throw new Error("This worktree has no commits to check.");
  const name = (await git(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const branch = name === "HEAD" ? null : name;
  const baseCommit = base ? await commitOf(worktreePath, base) : null;
  if (!baseCommit) throw new Error("This worktree's base can't be found, so its commits can't be checked.");
  const reach = [baseCommit];
  let unpushed;
  if (branch) {
    const upstream = await commitOf(worktreePath, "@{upstream}");
    if (upstream) reach.push(upstream);
    unpushed = Number((await git(worktreePath, ["rev-list", "--count", head, "--not", ...reach, "--"])).trim());
  } else {
    unpushed = Number((await git(worktreePath, ["rev-list", "--count", head, "--not", "--branches", "--remotes", ...reach, "--"])).trim());
  }
  return { uncommitted, unpushed, branch, head, removable: branch !== null && uncommitted === 0 && unpushed === 0 };
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

const sameStatus = (now, seen) => Boolean(seen) && now.head === seen.head && now.uncommitted <= seen.uncommitted && now.unpushed <= seen.unpushed;

/**
 * Removes a worktree Milagre made, then its `milagre/` branch. It refuses a path outside `root`, the main checkout,
 * the project folder itself, and a worktree of another repository. Then it closes the chat's agent session
 * (`closeSession`) so nothing keeps running in the folder, and looks again: the safe remove (no `force`) needs the
 * worktree to be removable still; the forced one (`force`) refuses if `seen`, the status the user saw, has grown
 * or HEAD moved. Either refusal throws CHANGED_AFTER_CHECK. The safe remove is git's own (a dirty worktree is
 * refused) with `branch -d` (an unmerged branch is kept: it's pushed or empty); the forced one uses --force and -D.
 */
async function removeWorktree({ path: worktreePath, root, projectPath, base, seen, force = false, closeSession }) {
  const realRoot = await fs.realpath(root).catch(() => null);
  const real = await fs.realpath(worktreePath);
  if (!realRoot || !isInside(realRoot, real)) throw new Error(`${worktreePath} is outside Milagre's worktree folder.`);
  const listing = await git(real, ["worktree", "list", "--porcelain"]);
  const main = listing.match(/^worktree (.+)$/m)?.[1];
  if (!main) throw new Error(`${worktreePath} is not a git worktree.`);
  const realMain = await fs.realpath(main);
  if (realMain === real) throw new Error(`${worktreePath} is the main checkout.`);
  const top = (await git(real, ["rev-parse", "--show-toplevel"])).trim();
  if ((await fs.realpath(top)) !== real) throw new Error(`${worktreePath} is not the top of a worktree.`);
  if (projectPath) {
    const realProject = await fs.realpath(projectPath);
    if (realProject === real) throw new Error(`${worktreePath} is the project folder.`);
    const commonDir = async (cwd) => fs.realpath(path.resolve(cwd, (await git(cwd, ["rev-parse", "--git-common-dir"])).trim()));
    if ((await commonDir(real)) !== (await commonDir(realProject))) throw new Error(`${worktreePath} belongs to another repository.`);
  }

  // The agent may still be writing: close its session, then look at the folder as it is now.
  await closeSession?.();
  const now = await worktreeStatus(real, base);
  if (force ? !sameStatus(now, seen) : !now.removable) throw new Error(`${CHANGED_AFTER_CHECK}: ${worktreePath} changed after it was checked.`);

  await git(realMain, ["worktree", "remove", ...(force ? ["--force"] : []), real]);

  // Only branches Milagre made: a chat that switched its worktree to another branch must not delete it.
  let branchDeleted = false;
  if (now.branch?.startsWith("milagre/")) {
    try {
      await git(realMain, ["branch", force ? "-D" : "-d", now.branch]);
      branchDeleted = true;
    } catch {}
  }
  return { removed: true, branch: now.branch, branchDeleted };
}

module.exports = { CHANGED_AFTER_CHECK, removeWorktree, worktreeStatus };
