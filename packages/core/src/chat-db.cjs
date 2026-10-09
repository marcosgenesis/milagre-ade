const fs = require("node:fs/promises");
const path = require("node:path");

// A Project's messages, one row each, in <project>/.milagre/chats.db (see ADR-0007). coordination.json keeps everything
// else, with `messages` set to MESSAGES_MARKER. The rows keep each message's place in the Project's one array (`position`),
// so the array reads back in the order it had, and its global id, which numbers messages across Chats.

const MESSAGES_MARKER = Object.freeze({ storedIn: "chats.db", format: 2 });
const isMarker = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value) && value.storedIn === "chats.db");
const dbFile = (projectPath) => path.join(projectPath, ".milagre", "chats.db");

let sqlite;
/** node:sqlite, loaded once without its "experimental" warning (Node 24 still marks it so; Electron 44 ships it). */
function database() {
  if (!sqlite) {
    const emit = process.emitWarning;
    process.emitWarning = (warning, ...rest) => {
      if (String(warning?.message ?? warning).includes("SQLite is an experimental feature")) return;
      return emit.call(process, warning, ...rest);
    };
    try {
      sqlite = require("node:sqlite");
    } finally {
      process.emitWarning = emit;
    }
  }
  return sqlite;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS messages (
    id NOT NULL UNIQUE,
    session_id INTEGER,
    position INTEGER NOT NULL,
    client_message_id TEXT,
    operation_id TEXT,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_session ON messages (session_id, position);
  CREATE INDEX IF NOT EXISTS messages_position ON messages (position);
`;

/** Opens the Project's database for one read or write and closes it after; a save is a few writes a second at most. */
async function withDatabase(projectPath, work, { create = false } = {}) {
  const file = dbFile(projectPath);
  if (create) await fs.mkdir(path.dirname(file), { recursive: true });
  else
    try {
      await fs.access(file);
    } catch {
      return work(null);
    }
  const db = new (database().DatabaseSync)(file);
  try {
    db.exec(SCHEMA);
    return work(db);
  } finally {
    db.close();
  }
}

/** The Project's messages in their saved order; null when it has no database. */
function readMessages(projectPath) {
  return withDatabase(projectPath, (db) =>
    db
      ? db
          .prepare("SELECT payload FROM messages ORDER BY position")
          .all()
          .map((row) => JSON.parse(row.payload))
      : null,
  );
}

/**
 * Writes the rows of the messages that changed since `saved` (message id -> { message, position } as last written) and
 * deletes the ones `messages` no longer has, in one transaction. Returns the map to pass next time. Without `saved`
 * (the first save of a run, or a Project moving from coordination.json) every row is written and any other removed.
 */
function writeMessages(projectPath, messages, saved, { durable = false } = {}) {
  return withDatabase(
    projectPath,
    (db) => {
      db.exec(`PRAGMA synchronous = ${durable ? "FULL" : "NORMAL"}`);
      const next = new Map();
      const upsert = db.prepare(
        `INSERT INTO messages (id, session_id, position, client_message_id, operation_id, payload) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET session_id = excluded.session_id, position = excluded.position,
           client_message_id = excluded.client_message_id, operation_id = excluded.operation_id, payload = excluded.payload`,
      );
      const remove = db.prepare("DELETE FROM messages WHERE id = ?");
      db.exec("BEGIN");
      try {
        if (!saved) db.exec("DELETE FROM messages");
        messages.forEach((message, position) => {
          const last = saved?.get(message.id);
          if (!last || last.message !== message || last.position !== position)
            upsert.run(message.id, message.session_id ?? null, position, message.clientMessageId ?? null, message.operationId ?? null, JSON.stringify(message));
          next.set(message.id, { message, position });
        });
        if (saved) for (const id of saved.keys()) if (!next.has(id)) remove.run(id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return next;
    },
    { create: true },
  );
}

module.exports = { MESSAGES_MARKER, isMarker, dbFile, readMessages, writeMessages, database };
