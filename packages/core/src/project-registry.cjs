const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { resolveProject } = require("./project-identity.cjs");

const DEFAULT_ROOTS = [path.join(os.homedir(), "Developer"), path.join(os.homedir(), ".milagre", "worktrees")];
const SKIP = new Set([".git", "node_modules", ".next", ".cache"]);

async function coordinationProjects(roots) {
  const found = [];
  const pending = [...roots];
  while (pending.length) {
    const directory = pending.pop();
    let children;
    try { children = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      if (child.name === ".milagre") {
        try {
          if ((await fs.stat(path.join(directory, child.name, "coordination.json"))).isFile()) found.push(directory);
        } catch {}
      } else if (!SKIP.has(child.name) && !child.name.startsWith(".")) {
        pending.push(path.join(directory, child.name));
      }
    }
  }
  return found;
}

async function present(entry) {
  try {
    const identity = await resolveProject(entry.path);
    return identity.id === entry.id && identity.path === entry.path;
  } catch { return false; }
}

function validEntry(entry) {
  return entry && typeof entry.id === "string" && path.isAbsolute(entry.id)
    && typeof entry.path === "string" && path.isAbsolute(entry.path);
}

function createProjectRegistry(file, { roots = DEFAULT_ROOTS, now = () => new Date() } = {}) {
  let queue = Promise.resolve();
  let counter = 0;

  async function read() {
    let data;
    try { data = JSON.parse(await fs.readFile(file, "utf8")); }
    catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return { scanned: false, projects: [] };
      throw error;
    }
    if (!data || !Array.isArray(data.projects)) return { scanned: false, projects: [] };
    const seen = new Set();
    const projects = data.projects.filter((entry) => {
      if (!validEntry(entry) || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
    return { scanned: data.scanned === true, projects };
  }

  async function write(data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${++counter}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(data, null, 2));
      await fs.rename(temporary, file);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  function update(change) {
    const next = queue.catch(() => {}).then(async () => {
      const previous = await read();
      const projects = (await Promise.all(previous.projects.map(async (entry) => await present(entry) ? { ...entry } : null))).filter(Boolean);
      const current = { ...previous, projects };
      const result = await change(current);
      if (JSON.stringify(result) !== JSON.stringify(previous)) await write(result);
      return result.projects;
    });
    queue = next;
    return next;
  }

  return {
    // Called when the canvas first needs the registry. The marker is persisted even if the scan finds nothing.
    list: () => update(async (data) => {
      if (data.scanned) return data;
      for (const folder of await coordinationProjects(roots)) {
        let identity;
        try { identity = await resolveProject(folder); } catch { continue; }
        if (!data.projects.some((entry) => entry.id === identity.id)) {
          data.projects.push({ ...identity, position: null, openedAt: now().toISOString() });
        }
      }
      data.scanned = true;
      return data;
    }),
    add: (identity) => update(async (data) => {
      const previous = data.projects.find((entry) => entry.id === identity.id);
      data.projects = [
        { ...identity, position: previous?.position ?? null, openedAt: now().toISOString() },
        ...data.projects.filter((entry) => entry.id !== identity.id),
      ];
      return data;
    }),
    setPosition: (id, position) => update(async (data) => {
      if (typeof id !== "string" || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error("Invalid Project position.");
      const entry = data.projects.find((project) => project.id === id);
      if (!entry) throw new Error("Project is not in the registry.");
      entry.position = { x: position.x, y: position.y };
      return data;
    }),
  };
}

module.exports = { coordinationProjects, createProjectRegistry };
