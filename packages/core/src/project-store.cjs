const fs = require('node:fs/promises');
const path = require('node:path');
const { migrateImages, compactSubagents, hydrateSubagents } = require('./project-content.cjs');
// ProjectStates owns write ordering. This adapter performs one atomic snapshot write.
const stateFile = projectPath => path.join(projectPath, '.milagre', 'coordination.json');
let counter = 0;
async function saveProjectState(projectPath, state) {
  const persisted = await compactSubagents(projectPath, await migrateImages(projectPath, state));
  const contents = JSON.stringify(persisted);
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
async function readProjectState(projectPath) {
  return hydrateSubagents(projectPath, JSON.parse(await fs.readFile(stateFile(projectPath), 'utf8')));
}
module.exports = { saveProjectState, readProjectState, stateFile };
