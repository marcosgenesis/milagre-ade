const { createGit } = require("./git/client.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const client = createGit().read;
const git = client.text;

// Lines a worktree adds and removes against the commit it branched from, uncommitted and untracked
// files included: what the chat's hover card shows. Read in the background and cached in the
// project state, so the card never waits on git.

const UNTRACKED_FILE_LIMIT = 500;
const UNTRACKED_SIZE_LIMIT = 1024 * 1024;
// Milagre's own state lives in the project, and isn't the chat's work even where it isn't ignored.
const PATHSPEC = ["--", ".", ":(exclude).milagre"];

/** Same recorded/default comparison branch as Changes and the commit dialog. */
async function diffBase(cwd, base) {
  return (await client.resolveBase(cwd, base)).ref ?? 'HEAD';
}

function sumNumstat(output) {
  let added = 0;
  let removed = 0;
  for (const line of output.split("\n")) {
    // Binary files report "-\t-".
    const [plus, minus] = line.split("\t");
    if (/^\d+$/.test(plus)) added += Number(plus);
    if (/^\d+$/.test(minus)) removed += Number(minus);
  }
  return { added, removed };
}

/** Lines in an untracked file; 0 for an empty, binary, very large or unreadable one. */
async function fileLineCount(fullPath) {
  try {
    const stat = await fs.stat(fullPath);
    if (!stat.isFile() || stat.size === 0 || stat.size > UNTRACKED_SIZE_LIMIT) return 0;
    const contents = await fs.readFile(fullPath);
    if (contents.includes(0)) return 0;
    const text = contents.toString("utf8");
    return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  } catch {
    return 0;
  }
}

async function untrackedLines(cwd) {
  const files = (await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z", ...PATHSPEC])).split("\0").filter(Boolean).slice(0, UNTRACKED_FILE_LIMIT);
  let lines = 0;
  for (const file of files) lines += await fileLineCount(path.join(cwd, file));
  return lines;
}

/** `{ added, removed }` for the worktree at `cwd` against `base`, or null outside a repository. */
async function readDiffStat(cwd, base) {
  try {
    const ref = await diffBase(cwd, base);
    const mergeBase = ref === "HEAD" ? "HEAD" : (await git(cwd, ["merge-base", ref, "HEAD"])).trim();
    const tracked = sumNumstat(await git(cwd, ["diff", "--numstat", mergeBase, ...PATHSPEC]));
    return { added: tracked.added + (await untrackedLines(cwd)), removed: tracked.removed };
  } catch {
    return null;
  }
}

module.exports = { PATHSPEC, diffBase, fileLineCount, readDiffStat };
