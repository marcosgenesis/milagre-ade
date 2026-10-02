const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

// Files a new worktree gets from the project's main checkout, after Conductor's "Files to copy":
// untracked files that git ignores and that match the project's patterns (.gitignore syntax).
const DEFAULT_PATTERNS = [".env*"];
const COPY_LIMITS = { maxFiles: 500, maxBytes: 100 * 1024 * 1024 };
const GIT_LIMITS = { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 30_000 };

function patternLines(text) {
  return text.split(/\r?\n/);
}

/** Which patterns apply: .worktreeinclude at the repo root, else the project's setting, else the default. */
async function resolvePatterns(projectPath, setting) {
  let worktreeInclude = null;
  try {
    worktreeInclude = await fs.readFile(path.join(projectPath, ".worktreeinclude"), "utf8");
  } catch {}
  if (worktreeInclude !== null) return { source: "worktreeinclude", patterns: patternLines(worktreeInclude), worktreeInclude };
  const custom = (setting ?? []).map((line) => line.trim()).filter(Boolean);
  if (custom.length > 0) return { source: "setting", patterns: custom, worktreeInclude: null };
  return { source: "default", patterns: DEFAULT_PATTERNS, worktreeInclude: null };
}

// check-ignore reads the paths from stdin, which execFile can't feed.
function gitWithInput(cwd, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", cwd, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill(), GIT_LIMITS.timeout);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // check-ignore exits 1 when none of the paths is ignored.
      if (code === 0 || code === 1) resolve(Buffer.concat(out).toString("utf8"));
      else reject(new Error(Buffer.concat(err).toString("utf8").trim() || `git exited with ${code}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** The regular files in `projectPath` that the patterns pick and git ignores, as { path, size }, sorted. */
async function findFilesToCopy(projectPath, patterns) {
  if (patterns.every((line) => !line.trim() || line.trim().startsWith("#"))) return [];
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "milagre-copy-"));
  let candidates;
  try {
    const patternFile = path.join(scratch, "patterns");
    await fs.writeFile(patternFile, `${patterns.join("\n")}\n`);
    const { stdout } = await execFileAsync("git", ["-C", projectPath, "ls-files", "-z", "--others", "--ignored", `--exclude-from=${patternFile}`], GIT_LIMITS);
    candidates = stdout.split("\0").filter(Boolean);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
  if (candidates.length === 0) return [];
  const ignored = (await gitWithInput(projectPath, ["check-ignore", "-z", "--stdin", "--no-index"], `${candidates.join("\0")}\0`)).split("\0").filter(Boolean);
  const files = [];
  for (const relative of [...new Set(ignored)].sort()) {
    try {
      const stat = await fs.lstat(path.join(projectPath, relative));
      if (stat.isFile()) files.push({ path: relative, size: stat.size });
    } catch {}
  }
  return files;
}

/** What the effective patterns match right now, for the Settings preview. `setting` may be an unsaved draft. */
async function previewFilesToCopy(projectPath, setting) {
  const resolved = await resolvePatterns(projectPath, setting);
  let matches = [];
  try {
    matches = (await findFilesToCopy(projectPath, resolved.patterns)).map((file) => file.path);
  } catch {}
  return { source: resolved.source, worktreeInclude: resolved.worktreeInclude, matches };
}

/** Copies the matching files into a new worktree. Never throws: what went wrong comes back as notes. */
async function copyFilesToWorktree({ projectPath, worktreePath, setting, limits = {} }) {
  const { maxFiles, maxBytes } = { ...COPY_LIMITS, ...limits };
  const copied = [];
  const notes = [];
  try {
    const resolved = await resolvePatterns(projectPath, setting);
    const files = await findFilesToCopy(projectPath, resolved.patterns);
    let bytes = 0;
    for (const file of files) {
      if (copied.length >= maxFiles || bytes + file.size > maxBytes) {
        notes.push(copied.length >= maxFiles ? `Stopped copying at the ${maxFiles} file cap.` : `Stopped copying at the ${Math.round(maxBytes / (1024 * 1024))} MB cap.`);
        break;
      }
      const target = path.join(worktreePath, file.path);
      if (path.relative(worktreePath, target).startsWith("..")) continue;
      try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        // Never overwrite: a file the worktree already has came from git.
        await fs.copyFile(path.join(projectPath, file.path), target, fs.constants.COPYFILE_EXCL);
        copied.push(file.path);
        bytes += file.size;
      } catch (error) {
        if (error.code !== "EEXIST") notes.push(`Couldn't copy ${file.path}: ${error.message}`);
      }
    }
  } catch (error) {
    notes.push(`Couldn't copy files: ${error.message}`);
  }
  return { copied, notes };
}

module.exports = { COPY_LIMITS, DEFAULT_PATTERNS, copyFilesToWorktree, findFilesToCopy, previewFilesToCopy, resolvePatterns };
