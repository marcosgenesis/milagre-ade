const fs = require("node:fs/promises");
const path = require("node:path");

// Per-project settings kept in Milagre's own data folder, keyed by project path. They live there, not in
// <project>/.milagre/coordination.json, because the renderer rewrites that whole file on every save and
// the user may have it inside their repository.

function normalizeFilesToCopy(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((line) => typeof line === "string").map((line) => line.trim()).filter(Boolean);
}

function normalizeSetupCommand(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createProjectSettings(file) {
  let queue = Promise.resolve();

  // Only a missing file or damaged JSON reads as empty. Any other failure (permissions, a disk error) must not
  // look like "no settings", or the next save would wipe every project's patterns. Reading for a worktree
  // that is being made is not strict: it falls back to the default instead of failing the worktree.
  async function read({ strict }) {
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT" || !strict) return { projects: {} };
      throw error;
    }
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" && parsed.projects && typeof parsed.projects === "object" ? parsed : { projects: {} };
    } catch (error) {
      if (error instanceof SyntaxError) return { projects: {} };
      throw error;
    }
  }

  // Saves run one at a time. `change` edits the project's entry; an entry left empty is removed.
  function update(projectPath, change) {
    const save = queue.catch(() => {}).then(async () => {
      const data = await read({ strict: true });
      const key = path.resolve(projectPath);
      // oxlint-disable-next-line unicorn/no-useless-fallback-in-spread -- pre-existing, see PR body
      const entry = { ...(data.projects[key] ?? {}) };
      change(entry);
      if (Object.keys(entry).length > 0) data.projects[key] = entry;
      else delete data.projects[key];
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(data, null, 2));
      await fs.rename(temporary, file);
    });
    queue = save;
    return save;
  }

  return {
    async get(projectPath) {
      const entry = (await read({ strict: false })).projects[path.resolve(projectPath)] ?? {};
      return { filesToCopy: normalizeFilesToCopy(entry.filesToCopy), setupCommand: normalizeSetupCommand(entry.setupCommand) };
    },
    // An empty list removes the setting, which brings the default back.
    async setFilesToCopy(projectPath, filesToCopy) {
      const lines = normalizeFilesToCopy(filesToCopy);
      await update(projectPath, (entry) => {
        if (lines.length > 0) entry.filesToCopy = lines;
        else delete entry.filesToCopy;
      });
      return { filesToCopy: lines };
    },
    // An empty command removes the setting: new worktrees run nothing.
    async setSetupCommand(projectPath, setupCommand) {
      const command = normalizeSetupCommand(setupCommand);
      await update(projectPath, (entry) => {
        if (command) entry.setupCommand = command;
        else delete entry.setupCommand;
      });
      return { setupCommand: command };
    },
  };
}

module.exports = { createProjectSettings };
