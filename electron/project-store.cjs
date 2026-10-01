const fs = require("node:fs/promises");
const path = require("node:path");

// Writes <project>/.milagre/coordination.json. Several chats can finish at once, so saves for
// one project run one at a time, and each writes a temporary file in the same directory and
// renames it over the old one: the file is always either the previous save or the new one.

const stateFile = (projectPath) => path.join(projectPath, ".milagre", "coordination.json");
const queues = new Map();
let counter = 0;

function saveProjectState(projectPath, state) {
  const key = path.resolve(projectPath);
  const save = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => writeState(key, state));
  queues.set(key, save);
  const forget = () => {
    if (queues.get(key) === save) queues.delete(key);
  };
  save.then(forget, forget);
  return save;
}

async function writeState(projectPath, state) {
  const contents = JSON.stringify(state, null, 2);
  const directory = path.dirname(stateFile(projectPath));
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `coordination.json.${process.pid}.${++counter}.tmp`);
  try {
    await fs.writeFile(temporary, contents);
    await fs.rename(temporary, stateFile(projectPath));
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

module.exports = { saveProjectState, stateFile };
