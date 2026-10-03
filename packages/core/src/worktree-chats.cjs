const fs = require("node:fs/promises");
const path = require("node:path");
const { hydrateSubagents, migrateImages } = require("./project-content.cjs");

// Before #117, a linked worktree opened as a project kept its chats in its own .milagre/coordination.json. Since #117
// the repository's project reads only the main checkout's file, so those chats went missing from the list. This brings
// them into the main checkout's state once, then renames the old file so it is never merged again.

const values = (items) => (Array.isArray(items) ? items : Object.values(items ?? {}));
const oldChatsFile = (worktreePath) => path.join(worktreePath, ".milagre", "coordination.json");

function messagesBySession(messages) {
  const grouped = new Map();
  for (const message of values(messages)) {
    if (!grouped.has(message.session_id)) grouped.set(message.session_id, []);
    grouped.get(message.session_id).push(message);
  }
  return grouped;
}

// The same chat copied by hand keeps its first message and its length, even when it lost its provider id.
const fingerprint = (worktreePath, messages) => JSON.stringify([worktreePath, messages.length, messages[0]?.body ?? ""]);

/**
 * The old file's chats with messages merged into the main checkout's state; neither input is changed.
 * A chat the main state already has (same provider id, or same worktree, first message and length when one side has
 * no provider id) is skipped. Worktrees match by path; sessions, messages, added worktrees and tasks get fresh ids
 * from next_id, and every reference moves with them. `listed`, when given, holds the worktree paths git lists now:
 * a chat in any other worktree is skipped, since reconciling would drop it anyway.
 */
function mergeWorktreeChats(main, old, { listed } = {}) {
  const counts = { migrated: 0, duplicates: 0, empty: 0, gone: 0, messages: 0, addedWorktrees: 0 };
  const mainWorktrees = values(main.worktrees);
  const usedIds = [...mainWorktrees, ...values(main.sessions), ...values(main.messages), ...values(main.tasks)].map((item) => Number(item.id)).filter(Number.isFinite);
  let nextId = Math.max(Number(main.next_id) || 1, ...usedIds.map((id) => id + 1));
  const take = () => nextId++;

  const worktreePathById = new Map(mainWorktrees.map((worktree) => [worktree.id, worktree.path]));
  const knownNative = new Set(values(main.sessions).map((session) => session.native_session_id).filter(Boolean));
  const knownCopies = new Map();
  const remember = (key, nativeId) => knownCopies.set(key, [...(knownCopies.get(key) ?? []), nativeId]);
  const mainMessages = messagesBySession(main.messages);
  for (const session of values(main.sessions)) {
    const messages = mainMessages.get(session.id);
    if (messages?.length) remember(fingerprint(worktreePathById.get(session.worktree_id), messages), session.native_session_id);
  }

  const oldWorktrees = new Map(values(old.worktrees).map((worktree) => [worktree.id, worktree]));
  const oldMessages = messagesBySession(old.messages);
  const chosen = [];
  for (const session of values(old.sessions)) {
    const messages = oldMessages.get(session.id);
    if (!messages?.length) { counts.empty++; continue; }
    const worktree = oldWorktrees.get(session.worktree_id);
    if (!worktree || (listed && !listed.has(worktree.path))) { counts.gone++; continue; }
    const key = fingerprint(worktree.path, messages);
    const nativeId = session.native_session_id;
    if ((nativeId && knownNative.has(nativeId)) || (knownCopies.get(key) ?? []).some((other) => !other || !nativeId)) { counts.duplicates++; continue; }
    if (nativeId) knownNative.add(nativeId);
    remember(key, nativeId);
    chosen.push({ session, worktree, messages });
  }
  if (!chosen.length) return { state: main, ...counts };

  const projectId = values(main.projects)[0]?.id ?? 1;
  const worktrees = { ...main.worktrees };
  const mainByPath = new Map(mainWorktrees.map((worktree) => [worktree.path, worktree.id]));
  const worktreeIds = new Map();
  for (const { worktree } of chosen) {
    if (worktreeIds.has(worktree.id)) continue;
    let id = mainByPath.get(worktree.path);
    if (id === undefined) {
      id = take();
      worktrees[id] = { ...worktree, id, project_id: projectId };
      mainByPath.set(worktree.path, id);
      counts.addedWorktrees++;
    }
    worktreeIds.set(worktree.id, id);
  }

  const sessionIds = new Map(chosen.map(({ session }) => [session.id, take()]));
  const sessions = { ...main.sessions };
  for (const { session } of chosen) {
    const id = sessionIds.get(session.id);
    const copy = { ...session, id, worktree_id: worktreeIds.get(session.worktree_id) };
    // A handover link survives only when the chat at its other end came along too.
    for (const link of ["handedOverTo", "handedOverFrom"]) {
      if (sessionIds.has(copy[link])) copy[link] = sessionIds.get(copy[link]);
      else delete copy[link];
    }
    sessions[id] = copy;
  }

  const messages = [...values(main.messages)];
  for (const { session, messages: own } of chosen) {
    for (const message of own) messages.push({ ...message, id: take(), session_id: sessionIds.get(session.id) });
    counts.messages += own.length;
  }

  // Tasks follow the worktrees the chats came from; one the main state already lists there is not added twice.
  const tasks = { ...main.tasks };
  const knownTasks = new Set(values(main.tasks).map((task) => JSON.stringify([task.worktree_id, task.title])));
  for (const task of values(old.tasks)) {
    const worktreeId = worktreeIds.get(task.worktree_id);
    if (worktreeId === undefined || knownTasks.has(JSON.stringify([worktreeId, task.title]))) continue;
    const id = take();
    tasks[id] = { ...task, id, worktree_id: worktreeId };
  }

  counts.migrated = chosen.length;
  // Only CoordinatorState keys come across; the old file's legacy keys stay behind.
  return { state: { ...main, next_id: nextId, worktrees, sessions, messages, tasks }, ...counts };
}

/** Parses a linked worktree's old file, with any subagent transcript sidecars it points at; null when there is none. */
async function readOldChats(worktreePath) {
  let text;
  try { text = await fs.readFile(oldChatsFile(worktreePath), "utf8"); }
  catch (error) { if (error.code === "ENOENT" || error.code === "ENOTDIR") return null; throw error; }
  const state = JSON.parse(text);
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("not a coordination state");
  return hydrateSubagents(worktreePath, state);
}

/**
 * Brings the chats of each linked worktree's old file into the main checkout's state. `state` is the main checkout's
 * stored state (or one to start from when it has none). The caller holds the project's runtime owner, so no other
 * load merges at the same time. One save covers every file, through the app's own atomic save; only then is each
 * merged file renamed to coordination.json.migrated-<ISO time>. A file that can't be read or parsed, or a save that
 * fails, leaves the files as they are and logs one line; the project still opens with the state it had.
 * Returns the state to use and, per worktree, how many chats came back.
 */
async function migrateWorktreeChats({ projectPath, state, linkedWorktrees, listed, save, now = () => new Date(), warn = console.warn }) {
  let merged = state;
  const done = [];
  const restored = [];
  for (const worktree of linkedWorktrees) {
    const file = oldChatsFile(worktree.path);
    let old;
    try { old = await readOldChats(worktree.path); }
    catch (error) { warn(`Milagre couldn't read the chats saved in ${file}: ${error.message}`); continue; }
    if (!old) continue;
    const result = mergeWorktreeChats(merged, old, { listed });
    merged = result.state;
    done.push(file);
    if (result.migrated) restored.push({ worktree: worktree.name, count: result.migrated });
  }
  if (restored.length) {
    try {
      merged = await migrateImages(projectPath, merged);
      await save(projectPath, merged);
    } catch (error) {
      warn(`Milagre couldn't bring back the chats saved in ${done.join(", ")}: ${error.message}`);
      return { state, restored: [] };
    }
  }
  const stamp = now().toISOString();
  for (const file of done) {
    // A rename that fails leaves the file to be read again; the duplicate check then skips what it already merged.
    await fs.rename(file, `${file}.migrated-${stamp}`).catch((error) => warn(`Milagre brought back the chats in ${file} but couldn't rename it: ${error.message}`));
  }
  return { state: restored.length ? merged : state, restored };
}

module.exports = { mergeWorktreeChats, migrateWorktreeChats, readOldChats, oldChatsFile };
