import type { CoordinatorState, Subagent } from "../model";

export const subagentActive = (agent: Subagent) => ["initializing", "running", "waiting"].includes(agent.status);

/** Archive is a reversible view choice; provider-owned execution continues. */
export function archiveSubagent(state: CoordinatorState, parentId: number, id: string, archived: boolean): CoordinatorState {
  const session = state.sessions[parentId];
  if (!session?.subagents?.some(agent => agent.id === id)) return state;
  return { ...state, sessions: { ...state.sessions, [parentId]: { ...session, subagents: session.subagents.map(agent => agent.id === id ? { ...agent, archived } : agent) } } };
}

export const subagentFinished = (agent: Subagent) => ["completed", "failed", "cancelled"].includes(agent.status);

export function archiveFinishedSubagents(state: CoordinatorState, parentId: number): CoordinatorState {
  const session = state.sessions[parentId];
  if (!session?.subagents?.some(agent => !agent.archived && subagentFinished(agent))) return state;
  return { ...state, sessions: { ...state.sessions, [parentId]: { ...session, subagents: session.subagents.map(agent => !agent.archived && subagentFinished(agent) ? { ...agent, archived: true } : agent) } } };
}
