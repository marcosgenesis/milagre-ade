const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  try {
    return (await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" })).stdout;
  } catch (error) {
    throw new Error(error.stderr?.trim() || error.message);
  }
}

/**
 * What archiving a chat would lose from its worktree. `uncommitted` counts `git status` entries (untracked
 * included, ignored files such as a copied .env not); `unpushed` counts commits on neither the branch's
 * upstream nor `base`, or just not on `base` when there is no upstream. Throws when git can't tell.
 */
async function worktreeStatus(worktreePath, base) {
  const porcelain = await git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]);
  const uncommitted = porcelain.split("\n").filter(Boolean).length;
  const head = (await git(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const branch = head === "HEAD" ? null : head;
  if (!base) throw new Error("This worktree has no base to compare against.");
  const exclude = [base];
  try {
    exclude.push((await git(worktreePath, ["rev-parse", "--abbrev-ref", "@{upstream}"])).trim());
  } catch {}
  const unpushed = Number((await git(worktreePath, ["rev-list", "--count", "HEAD", "--not", ...exclude])).trim());
  return { uncommitted, unpushed, branch, removable: uncommitted === 0 && unpushed === 0 };
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Removes a worktree Milagre made, then its `milagre/` branch. Without `force` it is git's own safe remove
 * (a dirty worktree is refused) and `branch -d` (an unmerged branch is kept: it's pushed or empty, so nothing
 * is lost). With `force` the worktree and its branch go whatever they hold. Refuses a path outside `root` and
 * the main checkout.
 */
async function removeWorktree({ path: worktreePath, root, force = false }) {
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

  const head = (await git(real, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  await git(realMain, ["worktree", "remove", ...(force ? ["--force"] : []), real]);

  // Only branches Milagre made: a chat that switched its worktree to another branch must not delete it.
  let branchDeleted = false;
  if (head.startsWith("milagre/")) {
    try {
      await git(realMain, ["branch", force ? "-D" : "-d", head]);
      branchDeleted = true;
    } catch {}
  }
  return { removed: true, branch: head === "HEAD" ? null : head, branchDeleted };
}

module.exports = { removeWorktree, worktreeStatus };
