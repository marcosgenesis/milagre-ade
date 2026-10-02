import type { AgentSession, ChatMessage, CoordinatorState, DiffStat } from "../model";

/** What the mark at the left of a chat row shows; the first that applies wins. */
export type ChatMark = "waiting" | "running" | "unread" | "idle";

export function chatMark({ waiting, running, unread }: { waiting: boolean; running: boolean; unread: boolean }): ChatMark {
  if (waiting) return "waiting";
  if (running) return "running";
  if (unread) return "unread";
  return "idle";
}

/** The chat's name: the one the user gave it, else the first line of its first message. */
export function chatTitle(session: AgentSession, messages: ChatMessage[]): string {
  if (session.title?.trim()) return session.title.trim();
  const line = messages.find((message) => message.role !== "assistant" && message.body.trim())?.body.trim().split("\n")[0] ?? "";
  if (!line) return session.agent_name;
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

type SessionPatch = Partial<Pick<AgentSession, "title" | "unread" | "archived">>;

/** The state with one session changed; a field patched to undefined, false or "" is removed. Unchanged state is returned as is. */
export function patchSession(state: CoordinatorState, sessionId: number, patch: SessionPatch): CoordinatorState {
  const session = state.sessions[sessionId];
  if (!session) return state;
  const next: Record<string, unknown> = { ...session };
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined || value === false || value === "") delete next[field];
    else next[field] = value;
  }
  if (JSON.stringify(next) === JSON.stringify(session)) return state;
  return { ...state, sessions: { ...state.sessions, [sessionId]: next as unknown as AgentSession } };
}

/** The state with fresh diff stats for some worktrees (by id); unchanged state is returned as is. */
export function withDiffStats(state: CoordinatorState, stats: Record<number, DiffStat | null>): CoordinatorState {
  let worktrees = state.worktrees;
  for (const [id, stat] of Object.entries(stats)) {
    const worktree = worktrees[id];
    if (!worktree || !stat) continue;
    if (worktree.diff?.added === stat.added && worktree.diff?.removed === stat.removed) continue;
    worktrees = { ...worktrees, [id]: { ...worktree, diff: { added: stat.added, removed: stat.removed } } };
  }
  return worktrees === state.worktrees ? state : { ...state, worktrees };
}

/** A line count in a few characters: 980, 2.1k, 14k, 2.1m. */
export function formatLineCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${trimDecimal(count / 1000)}k`;
  return `${trimDecimal(count / 1_000_000)}m`;
}

function trimDecimal(value: number) {
  return value < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
}

/** The folder name at the end of a path. */
export function folderName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}
