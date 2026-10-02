import type { CoordinatorState, Subagent } from "../model";

export const subagentActive = (agent: Subagent) => ["initializing", "running", "waiting"].includes(agent.status);

/** Archive is a reversible view choice; provider-owned execution continues. */
export function archiveSubagent(state: CoordinatorState, parentId: number, id: string, archived: boolean): CoordinatorState {
  const session = state.sessions[parentId];
  if (!session?.subagents?.some(agent => agent.id === id)) return state;
  return { ...state, sessions: { ...state.sessions, [parentId]: { ...session, subagents: session.subagents.map(agent => agent.id === id ? { ...agent, archived } : agent) } } };
}

const transcriptBody = (agent: Subagent) => agent.transcript.map(entry => entry.text).join("\n\n") || agent.prompt || "No child output received yet.";

/** Unlink the view, not the provider runtime. Preserve provenance to route future updates. */
export function detachSubagent(state: CoordinatorState, parentId: number, id: string): { state: CoordinatorState; sessionId?: number } {
  const parent = state.sessions[parentId];
  const agent = parent?.subagents?.find(agent => agent.id === id);
  if (!agent) return { state };
  if (agent.detachedSessionId) return { state, sessionId: agent.detachedSessionId };
  const sessionId = state.next_id;
  const messageId = sessionId + 1;
  const linked = { ...agent, detachedSessionId: sessionId };
  return {
    sessionId,
    state: {
      ...state, next_id: messageId + 1,
      sessions: {
        ...state.sessions,
        [parentId]: { ...parent, subagents: parent.subagents!.map(child => child.id === id ? linked : child) },
        [sessionId]: { id: sessionId, worktree_id: parent.worktree_id, agent_name: parent.agent_name, status: "Created", provider: parent.provider, title: agent.title, subagentSource: { parentSessionId: parentId, subagentId: id, messageId }, subagentSnapshot: linked },
      },
      messages: [...state.messages, { id: messageId, session_id: sessionId, role: "assistant", context: null, body: transcriptBody(agent) }],
    },
  };
}

export function updateDetachedSubagent(state: CoordinatorState, parentId: number, agent: Subagent): CoordinatorState {
  const target = agent.detachedSessionId && state.sessions[agent.detachedSessionId];
  if (!target || target.subagentSource?.parentSessionId !== parentId || target.subagentSource.subagentId !== agent.id) return state;
  return {
    ...state,
    sessions: { ...state.sessions, [target.id]: { ...target, subagentSnapshot: agent } },
    messages: state.messages.map(message => message.id === target.subagentSource!.messageId ? { ...message, body: transcriptBody(agent) } : message),
  };
}
