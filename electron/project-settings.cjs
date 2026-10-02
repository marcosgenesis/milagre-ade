const fs = require("node:fs/promises");
const path = require("node:path");

// Per-project settings kept in Milagre's own data folder, keyed by project path. They live there, not in
// <project>/.milagre/coordination.json, because the renderer rewrites that whole file on every save and
// the user may have it inside their repository.

function normalizeFilesToCopy(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((line) => typeof line === "string").map((line) => line.trim()).filter(Boolean);
}

function createProjectSettings(file) {
  let queue = Promise.resolve();

  async function read() {
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      return parsed && typeof parsed === "object" && parsed.projects && typeof parsed.projects === "object" ? parsed : { projects: {} };
    } catch {
      return { projects: {} };
    }
  }

  return {
    async get(projectPath) {
      const entry = (await read()).projects[path.resolve(projectPath)] ?? {};
      return { filesToCopy: normalizeFilesToCopy(entry.filesToCopy) };
    },
    // Saves run one at a time; an empty list removes the setting, which brings the default back.
    setFilesToCopy(projectPath, filesToCopy) {
      const save = queue.catch(() => {}).then(async () => {
        const data = await read();
        const key = path.resolve(projectPath);
        const lines = normalizeFilesToCopy(filesToCopy);
        const entry = { ...(data.projects[key] ?? {}) };
        if (lines.length > 0) entry.filesToCopy = lines;
        else delete entry.filesToCopy;
        if (Object.keys(entry).length > 0) data.projects[key] = entry;
        else delete data.projects[key];
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(data, null, 2));
        await fs.rename(temporary, file);
        return { filesToCopy: lines };
      });
      queue = save;
      return save;
    },
  };
}

module.exports = { createProjectSettings };
