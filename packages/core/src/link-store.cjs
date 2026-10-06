const fs = require('node:fs/promises');
const path = require('node:path');
const { validLinkId } = require('@milagre/shared/chat-scopes');
const { ProjectStates } = require('./project-states.cjs');
const { readProjectState, saveProjectState } = require('./project-store.cjs');

function createLinkStore({ dataDir }) {
  const root = path.join(dataDir, 'links');
  const directory = id => { if (!validLinkId(id)) throw new Error('Invalid Link ID'); return path.join(root, id); };
  const states = new ProjectStates({
    read: async id => { try { return await readProjectState(directory(id)); } catch (error) { if (error.code !== 'ENOENT') throw error; return { next_id: 1, sessions: {}, messages: [], preparations: {} }; } },
    save: (id, state) => saveProjectState(directory(id), state, { durable: true }),
  });
  return {
    directory, cached: id => states.states.get(id),
    has: id => states.has(id), ids: () => states.projects(),
    get: id => { directory(id); return states.get(id); },
    update: (id, change, options) => { directory(id); return states.update(id, change, options); },
    flush: id => states.flush(id), close: () => states.close(),
    async ownedWorktrees() {
      const ids = new Set(states.projects());
      try { for (const name of await fs.readdir(root)) if (validLinkId(name)) ids.add(name); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const owned = new Map();
      for (const id of ids) {
        const state = await states.get(id);
        for (const session of Object.values(state.sessions)) for (const member of session.worktrees ?? []) owned.set(member.worktreePath, { linkId: id, sessionId: session.id });
        for (const prep of Object.values(state.preparations)) for (const member of prep.members) owned.set(member.worktreePath, { linkId: id, sessionId: prep.chatId });
      }
      return owned;
    },
  };
}
module.exports = { createLinkStore };
