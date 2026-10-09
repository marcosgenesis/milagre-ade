const fs = require("node:fs");
const path = require("node:path");
const { database } = require("@milagre/core/chat-db");

// Spec "Offline cache": the transcripts of a computer's last 20 opened chats.
const MAX_CHATS = 20;
const ID = /^[A-Za-z0-9-]{1,64}$/;
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entries (
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    payload TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (kind, key)
  );
  CREATE INDEX IF NOT EXISTS entries_at ON entries (kind, at);
`;
const checked = (computerId) => {
  if (typeof computerId !== "string" || !ID.test(computerId)) throw new Error("That isn't a computer's id.");
  return computerId;
};

/**
 * Each paired computer's last copy (spec "Offline cache"), in `<dir>/<computerId>/cache.sqlite`, keyed as the computer
 * itself names things (no window qualifier): its Project, Link and registry lists (kinds "recent", "links", "registry",
 * key ""), each scope's last whole state ("scope", by scope key: { name, state }), and its last 20 chat windows ("chat",
 * by chat key: { messages, hasMore, total }). node:sqlite, as ADR-0007; one handle per computer, closed by remove/close.
 * @param {{ dir: string; now?: () => number }} options
 */
function createComputerCaches({ dir, now = Date.now }) {
  /** @type {Map<string, any>} */
  const open = new Map();
  function db(computerId) {
    const id = checked(computerId);
    let handle = open.get(id);
    if (!handle) {
      fs.mkdirSync(path.join(dir, id), { recursive: true, mode: 0o700 });
      handle = new (database().DatabaseSync)(path.join(dir, id, "cache.sqlite"));
      handle.exec(SCHEMA);
      open.set(id, handle);
    }
    return handle;
  }
  return {
    /** @param {string} computerId @param {string} kind @param {string} key @param {unknown} value */
    put(computerId, kind, key, value) {
      const handle = db(computerId);
      handle
        .prepare(
          "INSERT INTO entries (kind, key, payload, at) VALUES (?, ?, ?, ?) ON CONFLICT (kind, key) DO UPDATE SET payload = excluded.payload, at = excluded.at",
        )
        .run(kind, key, JSON.stringify(value), now());
      if (kind === "chat")
        handle
          .prepare("DELETE FROM entries WHERE kind = 'chat' AND key NOT IN (SELECT key FROM entries WHERE kind = 'chat' ORDER BY at DESC LIMIT ?)")
          .run(MAX_CHATS);
    },
    /** @param {string} computerId @param {string} kind @param {string} key */
    get(computerId, kind, key) {
      if (!fs.existsSync(path.join(dir, checked(computerId), "cache.sqlite"))) return null;
      const row = db(computerId).prepare("SELECT payload FROM entries WHERE kind = ? AND key = ?").get(kind, key);
      return row ? JSON.parse(String(row.payload)) : null;
    },
    /** Removing a computer deletes its folder. @param {string} computerId */
    async remove(computerId) {
      const id = checked(computerId);
      open.get(id)?.close();
      open.delete(id);
      await fs.promises.rm(path.join(dir, id), { recursive: true, force: true, maxRetries: 5 });
    },
    close() {
      for (const handle of open.values()) handle.close();
      open.clear();
    },
  };
}

module.exports = { createComputerCaches };
