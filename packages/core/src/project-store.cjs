const fs = require("node:fs/promises");
const path = require("node:path");
const {
  migrateImages,
  compactSubagents,
  hydrateSubagents,
  referencedSidecars,
  sweepSubagentContent,
  compactDetails,
  referencedDetails,
  sweepDetailContent,
} = require("./project-content.cjs");
const { MESSAGES_MARKER, isMarker, readMessages, writeMessages } = require("./chat-db.cjs");
const { withChatSummaries } = require("./chat-summaries.cjs");
// ProjectStates owns write ordering. This adapter performs one atomic snapshot write.
const stateFile = (projectPath) => path.join(projectPath, ".milagre", "coordination.json");
let counter = 0;

// Per project, session/agent -> digest of the transcript sidecar its saved state points at, so a save
// writes only the agents whose transcript changed. Updated only after the state itself is on disk.
const MAX_PROJECTS = 50;
const settled = new Map();
// Per project, the message rows chats.db holds (id -> the message object and position written), so a save writes only
// the messages that changed. Set by a read or a save; a project without one rewrites every row on its next save.
const savedMessages = new Map();
// Superseded sidecars are removed once the new state is saved; a younger one may belong to a save still in flight.
const SWEEP_MIN_AGE_MS = 60_000;
const swept = new Set();

// `durable` syncs the bytes and the rename to disk before returning. Only the migration of a linked worktree's old
// chats asks for it, since it renames that file next; routine saves only rename.
async function saveProjectState(projectPath, state, { sweepMinAgeMs = SWEEP_MIN_AGE_MS, durable = false } = {}) {
  const tracker = { known: settled.get(projectPath), next: new Map(), wrote: false };
  // The state in memory is compacted already (see compactProjectDetails); this catches one that wasn't.
  const details = { wrote: false };
  const compacted = await compactDetails(projectPath, await migrateImages(projectPath, state), { tracker: details });
  const persisted = await compactSubagents(projectPath, compacted, tracker);
  // Messages go to chats.db first; coordination.json then points at it. A state from before keeps its array until then.
  let rows;
  if (Array.isArray(persisted.messages)) {
    // The first save after the move keeps the old file once, beside it, in case anything needs it back.
    if (!savedMessages.has(projectPath))
      await fs.copyFile(stateFile(projectPath), `${stateFile(projectPath)}.before-chats-db`, fs.constants.COPYFILE_EXCL).catch(() => {});
    rows = await writeMessages(projectPath, persisted.messages, savedMessages.get(projectPath), { durable });
  }
  const contents = JSON.stringify(rows ? { ...persisted, messages: MESSAGES_MARKER } : persisted);
  const directory = path.dirname(stateFile(projectPath));
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `coordination.json.${process.pid}.${++counter}.tmp`);
  try {
    if (durable) {
      const handle = await fs.open(temporary, "w");
      try {
        await handle.writeFile(contents);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } else await fs.writeFile(temporary, contents);
    await fs.rename(temporary, stateFile(projectPath));
    if (durable) await syncDirectory(directory);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  if (!settled.has(projectPath) && settled.size >= MAX_PROJECTS) {
    const oldest = settled.keys().next().value;
    settled.delete(oldest);
    swept.delete(oldest);
    savedMessages.delete(oldest);
  }
  settled.set(projectPath, tracker.next);
  if (rows) savedMessages.set(projectPath, rows);
  // A new sidecar supersedes the one before it; the first save of a run also clears older leftovers.
  if (tracker.wrote || details.wrote || !swept.has(projectPath)) {
    swept.add(projectPath);
    await sweepSubagentContent(projectPath, referencedSidecars(persisted), { minAgeMs: sweepMinAgeMs });
    await sweepDetailContent(projectPath, referencedDetails(persisted), { minAgeMs: sweepMinAgeMs });
  }
}
/**
 * The saved state, with its messages read from chats.db, subagent transcripts read back and long step details (from
 * before sidecars) moved out.
 */
async function readProjectState(projectPath) {
  const raw = JSON.parse(await fs.readFile(stateFile(projectPath), "utf8"));
  if (isMarker(raw.messages)) {
    const messages = await readMessages(projectPath);
    if (!messages) throw new Error(`This Project's messages are kept in ${path.join(projectPath, ".milagre", "chats.db")}, which is missing.`);
    raw.messages = messages;
    savedMessages.set(projectPath, new Map(messages.map((message, position) => [message.id, { message, position }])));
  } else savedMessages.delete(projectPath);
  const state = await hydrateSubagents(projectPath, raw);
  return compactDetails(projectPath, state);
}
/** For ProjectStates: moves the long step details of the messages a change added into sidecars. */
function compactProjectDetails(projectPath, next, previous) {
  return next.messages === previous?.messages ? next : compactDetails(projectPath, next, { previous: previous?.messages });
}
/** For ProjectStates: what every change goes through before it is kept (tool output moved out, Chat summaries current). */
async function compactProjectState(projectPath, next, previous) {
  return withChatSummaries(await compactProjectDetails(projectPath, next, previous), previous);
}
/** Makes a rename in `directory` durable. Best effort: a file system that can't sync a folder still saves. */
async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch {
  } finally {
    await handle?.close().catch(() => {});
  }
}
module.exports = { saveProjectState, readProjectState, compactProjectDetails, compactProjectState, stateFile, syncDirectory };
