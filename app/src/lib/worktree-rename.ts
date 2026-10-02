import type { CoordinatorState } from "../model";

/** A new worktree's branch, renamed from its prompt's first words to the name picked for its chat. */
export type WorktreeRename = { projectPath: string; path: string; from: string; name: string };

/** The state with the worktree at `path` renamed, along with its chats still named after the old branch. */
export function renameWorktree(state: CoordinatorState, { path, from, name }: WorktreeRename): CoordinatorState {
  const worktree = Object.values(state.worktrees).find((item) => item.path === path && item.name === from);
  if (!worktree) return state;
  const sessions = Object.fromEntries(Object.entries(state.sessions).map(([id, session]) => [
    id,
    session.worktree_id === worktree.id && session.agent_name === from ? { ...session, agent_name: name } : session,
  ]));
  return { ...state, worktrees: { ...state.worktrees, [worktree.id]: { ...worktree, name } }, sessions };
}
