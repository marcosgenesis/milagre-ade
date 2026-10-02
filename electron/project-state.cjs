// Coordination state persisted in <project>/.milagre/coordination.json, reconciled with the
// worktrees git reports each time a project is read.

function emptyState(projectName) {
  return {
    next_id: 1,
    projects: { 1: { id: 1, name: projectName } },
    worktrees: {},
    sessions: {},
    connections: {},
    events: [],
    messages: [],
    approvals: [],
    tasks: {},
    artifacts: {},
    outputs: [],
    conflicts: [],
  };
}

function reconcileState(rawState, projectName, discoveredWorktrees) {
  const state = rawState ?? emptyState(projectName);
  const existingWorktrees = Object.values(state.worktrees ?? {});
  const existingSessions = Object.values(state.sessions ?? {});
  let nextId = Math.max(state.next_id ?? 1, ...[
    ...existingWorktrees.map((item) => item.id),
    ...existingSessions.map((item) => item.id),
  ]) || 1;
  const allocateId = () => nextId++;
  const existingByPath = new Map(existingWorktrees.map((worktree) => [worktree.path, worktree]));
  const worktrees = {};
  const sessions = {};

  for (const discovered of discoveredWorktrees) {
    const previous = existingByPath.get(discovered.path);
    const worktree = previous ?? { id: allocateId(), project_id: 1, path: discovered.path, name: discovered.name };
    worktrees[worktree.id] = { ...worktree, project_id: 1, path: discovered.path, name: discovered.name };
    // A worktree can hold several chats; keep them all and make sure it has at least one.
    const worktreeSessions = existingSessions.filter((session) => session.worktree_id === worktree.id);
    if (worktreeSessions.length === 0) worktreeSessions.push({ id: allocateId(), worktree_id: worktree.id, agent_name: discovered.name, status: "Created" });
    for (const session of worktreeSessions) {
      sessions[session.id] = { ...session, worktree_id: worktree.id, agent_name: session.agent_name || discovered.name };
    }
  }

  const validWorktreeIds = new Set(Object.values(worktrees).map((worktree) => worktree.id));
  const validSessionIds = new Set(Object.values(sessions).map((session) => session.id));
  const events = (state.events ?? []).filter((event) => validWorktreeIds.has(event.worktree_id));
  const tasks = Object.fromEntries(Object.entries(state.tasks ?? {}).filter(([, task]) => validWorktreeIds.has(task.worktree_id)));
  const artifacts = Object.fromEntries(Object.entries(state.artifacts ?? {}).filter(([, artifact]) => validWorktreeIds.has(artifact.worktree_id)));

  return {
    ...state,
    next_id: nextId,
    projects: { 1: { id: 1, name: projectName } },
    worktrees,
    sessions,
    connections: Object.fromEntries(Object.entries(state.connections ?? {}).filter(([, connection]) => validWorktreeIds.has(connection.left_worktree_id) && validWorktreeIds.has(connection.right_worktree_id))),
    events,
    messages: (state.messages ?? []).filter((message) => validSessionIds.has(message.session_id)),
    tasks,
    artifacts,
  };
}

// A saved running flag is not proof of a live provider after an app restart.
function markDisconnectedSubagents(state, liveSessionIds) {
  return { ...state, sessions: Object.fromEntries(Object.entries(state.sessions).map(([id, session]) => [id,
    liveSessionIds.has(Number(id)) || !session.subagents ? session : { ...session, subagents: session.subagents.map(agent =>
      ["running", "initializing", "waiting"].includes(agent.status) ? { ...agent, status: "unknown", endedAt: agent.updatedAt, latestActivity: "Session disconnected. Last received activity is shown below." } : agent) }
  ])) };
}

module.exports = { emptyState, reconcileState, markDisconnectedSubagents };
