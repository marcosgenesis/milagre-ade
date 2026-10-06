const { scopeFromKey, scopeKey, isLinkScopeKey } = require('@milagre/shared/chat-scopes');
function createChatScopes({ projects, links, validateLink }) {
  const target = key => { const scope = scopeFromKey(key); return scope.kind === 'link' ? [links, scope.linkId] : [projects, scope.projectPath]; };
  return {
    has(key) { const [store, id] = target(key); return store.has(id); },
    projects: () => [...projects.projects(), ...links.ids().map(linkId => scopeKey({ kind: 'link', linkId }))],
    worktreePaths: () => [...projects.worktreePaths(), ...links.ids().flatMap(id => Object.values(links.cached(id)?.sessions ?? {}).flatMap(session => session.worktrees.map(member => member.worktreePath)))],
    workspacePaths: () => links.ids().flatMap(id => Object.values(links.cached(id)?.sessions ?? {}).map(session => session.workspacePath)),
    get(key) { const [store, id] = target(key); return store.get(id); },
    update(key, change, options) { const [store, id] = target(key); return store.update(id, change, options); },
    flush(key) { if (key === undefined) return Promise.all([projects.flush(), links.flush()]); const [store, id] = target(key); return store.flush(id); },
    storageDirectory(key) { const scope = scopeFromKey(key); return scope.kind === 'link' ? links.directory(scope.linkId) : scope.projectPath; },
    async executionContext(key, sessionId) {
      const [store, id] = target(key); const state = await store.get(id); const session = state.sessions[sessionId];
      if (!session) throw new Error('Chat no longer exists');
      if (!isLinkScopeKey(key)) return { cwd: state.worktrees[session.worktree_id]?.path };
      await validateLink(id);
      const fs = require('node:fs/promises');
      for (const member of session.worktrees) {
        try { if (await fs.realpath(member.worktreePath) !== member.worktreePath) throw new Error('Worktree target changed'); }
        catch { throw new Error(`Project ${member.projectName || member.alias}: its shared Worktree is unavailable.`); }
      }
      return {
        cwd: session.workspacePath,
        workspaceRoots: session.worktrees.map(member => member.worktreePath),
        workspaceInstructions: `This is one shared Chat in a named Project Link. The following Worktrees belong to this Chat and may be edited directly under its permission mode:\n${session.worktrees.map(member => `${member.alias}: ${member.worktreePath}`).join('\n')}\nRead each member's AGENTS.md and provider instructions before editing it. Run Git commands in the chosen member Worktree. The workspace directory is not a repository. Main checkouts are outside the owned set. External canvas-linked Worktrees still follow the read-only and Delegation rules above.`,
      };
    },
  };
}
module.exports = { createChatScopes };
