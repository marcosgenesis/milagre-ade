const fs = require('node:fs/promises');
const path = require('node:path');
const { migrateImages, compactSubagents, hydrateSubagents, referencedSidecars, sweepSubagentContent } = require('./project-content.cjs');
// ProjectStates owns write ordering. This adapter performs one atomic snapshot write.
const stateFile = projectPath => path.join(projectPath, '.milagre', 'coordination.json');
let counter = 0;

// Per project, session/agent -> digest of the transcript sidecar its saved state points at, so a save
// writes only the agents whose transcript changed. Updated only after the state itself is on disk.
const MAX_PROJECTS = 50;
const settled = new Map();
// Superseded sidecars are removed once the new state is saved; a younger one may belong to a save still in flight.
const SWEEP_MIN_AGE_MS = 60_000;
const swept = new Set();

async function saveProjectState(projectPath, state, { sweepMinAgeMs = SWEEP_MIN_AGE_MS } = {}) {
  const tracker = { known: settled.get(projectPath), next: new Map(), wrote: false };
  const persisted = await compactSubagents(projectPath, await migrateImages(projectPath, state), tracker);
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
  if (!settled.has(projectPath) && settled.size >= MAX_PROJECTS) { const oldest = settled.keys().next().value; settled.delete(oldest); swept.delete(oldest); }
  settled.set(projectPath, tracker.next);
  // A new sidecar supersedes the one before it; the first save of a run also clears older leftovers.
  if (tracker.wrote || !swept.has(projectPath)) {
    swept.add(projectPath);
    await sweepSubagentContent(projectPath, referencedSidecars(persisted), { minAgeMs: sweepMinAgeMs });
  }
}
async function readProjectState(projectPath) {
  return hydrateSubagents(projectPath, JSON.parse(await fs.readFile(stateFile(projectPath), 'utf8')));
}
module.exports = { saveProjectState, readProjectState, stateFile };
