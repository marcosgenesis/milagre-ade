const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_ENTRIES = 500;
const outside = () => Object.assign(new Error("Only folders in the home folder can be listed."), { code: "OUTSIDE_HOME" });
const inside = (root, target) => target === root || target.startsWith(root + path.sep);

/** Whether a folder is a git checkout and the branch its HEAD names, read from its files: no git process per folder. */
async function checkoutOf(folder) {
  const marker = path.join(folder, ".git");
  const stat = await fs.stat(marker).catch(() => null);
  if (!stat) return { git: false, branch: null };
  try {
    let gitDir = marker;
    // A worktree or submodule has a .git file pointing at its git folder.
    if (stat.isFile()) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(await fs.readFile(marker, "utf8"))?.[1]?.trim();
      if (!pointer) return { git: true, branch: null };
      gitDir = path.resolve(folder, pointer);
    }
    const head = (await fs.readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
    return { git: true, branch: /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1] ?? null };
  } catch {
    return { git: true, branch: null };
  }
}

/**
 * One folder's subfolders, for a paired desktop's remote folder picker (spec "Remote-only helpers"): each one's name, real
 * path, whether it is a git checkout and its branch, and whether it is already a Project. Starts at `home`; a path
 * outside it is refused, checked as written and again after realpath, so a symlink can't lead out. Hidden folders and
 * files are left out; at most MAX_ENTRIES. `projectPaths()` gives the real paths of the Projects this Mac knows.
 * @param {{ path?: unknown } | undefined} request
 * @param {{ home: string; projectPaths: () => Promise<string[]> }} options
 */
async function listDirs(request, { home, projectPaths }) {
  const realHome = await fs.realpath(home);
  const asked = request?.path;
  if (asked !== undefined && asked !== null && (typeof asked !== "string" || !path.isAbsolute(asked))) throw outside();
  const lexical = typeof asked === "string" ? path.resolve(asked) : realHome;
  if (!inside(realHome, lexical) && !inside(path.resolve(home), lexical)) throw outside();
  const folder = await fs.realpath(lexical).catch(() => {
    throw Object.assign(new Error("That folder is no longer there."), { code: "ENOENT" });
  });
  if (!inside(realHome, folder)) throw outside();
  const projects = new Set(await projectPaths().catch(() => []));
  const entries = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    let real = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) {
      real = await fs.realpath(real).catch(() => "");
      if (!real || !inside(realHome, real) || !(await fs.stat(real).catch(() => null))?.isDirectory()) continue;
    } else if (!entry.isDirectory()) continue;
    entries.push({ name: entry.name, path: real, ...(await checkoutOf(real)), project: projects.has(real) });
    if (entries.length >= MAX_ENTRIES) break;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { path: folder, home: realHome, parent: folder === realHome ? null : path.dirname(folder), entries };
}

module.exports = { listDirs };
