import type { CoordinatorState, Worktree } from "../model";

/** What archiving a chat would lose from its worktree, as `worktree:status` reports it. */
export type WorktreeStatus = { uncommitted: number; unpushed: number; branch: string | null; removable: boolean };

/** How an archive goes: only hide the chat, or also remove its worktree (`delete` discards what it holds). */
export type ArchiveMode = "hide" | "keep" | "remove" | "delete";

/** Everything the menu needs to offer the right choices for one chat. */
export type ArchivePlan = { milagreOwned: boolean; shared: boolean; status: WorktreeStatus | null };

export type ArchiveChoice = { mode: ArchiveMode; label: string; tone: "plain" | "danger" };

/** Whether `path` is a folder under one of `roots`, the folders Milagre keeps its worktrees in. */
export function isInsideRoots(path: string, roots: string[]): boolean {
  return roots.some((root) => {
    const base = root.replace(/\/+$/, "");
    return base !== "" && path.startsWith(`${base}/`) && path.length > base.length + 1;
  });
}

/** A worktree Milagre created: it recorded a base, and the folder is under its worktree root. */
export function isMilagreWorktree(worktree: Worktree | undefined, roots: string[]): worktree is Worktree {
  return Boolean(worktree?.base) && isInsideRoots(worktree!.path, roots);
}

/** Whether another chat that isn't archived still has messages in the chat's worktree. */
export function worktreeShared(state: CoordinatorState, sessionId: number): boolean {
  const worktreeId = state.sessions[sessionId]?.worktree_id;
  if (worktreeId === undefined) return false;
  const used = new Set(state.messages.map((message) => message.session_id));
  return Object.values(state.sessions).some((session) => session.id !== sessionId && session.worktree_id === worktreeId && !session.archived && used.has(session.id));
}

/**
 * The state without a worktree git no longer lists, and what hung off it, as reading the project again
 * would leave it (see project-state.cjs).
 */
export function withoutWorktree(state: CoordinatorState, worktreeId: number): CoordinatorState {
  if (!state.worktrees[worktreeId]) return state;
  const keep = <T,>(record: Record<string, T>, drop: (item: T) => boolean) => Object.fromEntries(Object.entries(record).filter(([, item]) => !drop(item)));
  const sessions = keep(state.sessions, (session) => session.worktree_id === worktreeId);
  const gone = new Set(Object.values(state.sessions).filter((session) => session.worktree_id === worktreeId).map((session) => session.id));
  return {
    ...state,
    worktrees: keep(state.worktrees, (worktree) => worktree.id === worktreeId),
    sessions,
    connections: keep(state.connections, (connection) => connection.left_worktree_id === worktreeId || connection.right_worktree_id === worktreeId),
    events: state.events.filter((event) => event.worktree_id !== worktreeId),
    messages: state.messages.filter((message) => !gone.has(message.session_id)),
    tasks: keep(state.tasks, (task) => task.worktree_id === worktreeId),
    artifacts: keep(state.artifacts, (artifact) => artifact.worktree_id === worktreeId),
  };
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** What would be lost, in a line: "3 uncommitted files and 2 unpushed commits will be lost". */
export function lossReason(status: WorktreeStatus): string {
  const parts = [
    ...(status.uncommitted > 0 ? [plural(status.uncommitted, "uncommitted file")] : []),
    ...(status.unpushed > 0 ? [plural(status.unpushed, "unpushed commit")] : []),
  ];
  return `${parts.join(" and ")} will be lost`;
}

/**
 * The confirm step after "Archive". A chat whose worktree isn't Milagre's, is shared, or can't be checked
 * only hides. A clean one offers removing the worktree. A dirty one offers keeping it, or deleting it with
 * a line saying what goes.
 */
export function archiveChoices({ plan, running }: { plan: ArchivePlan; running: boolean }): { choices: ArchiveChoice[]; reason: string | null } {
  const { milagreOwned, shared, status } = plan;
  if (!milagreOwned || shared || !status) {
    return { choices: [{ mode: "hide", label: running ? "Stop and archive" : "Confirm archive", tone: "danger" }], reason: null };
  }
  if (status.removable) {
    return { choices: [{ mode: "remove", label: running ? "Stop, archive and remove worktree" : "Archive and remove worktree", tone: "plain" }], reason: null };
  }
  return {
    choices: [
      { mode: "keep", label: running ? "Stop and archive, keep worktree" : "Archive, keep worktree", tone: "plain" },
      { mode: "delete", label: running ? "Stop, archive and delete worktree" : "Archive and delete worktree", tone: "danger" },
    ],
    reason: lossReason(status),
  };
}

/** The notice for a worktree that wouldn't go: "Couldn't remove the worktree: <git's message>. It's still at <path>." */
export function removeFailureNotice(error: unknown, path: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, "").replace(/^fatal: /, "").trim().replace(/[.\s]+$/, "");
  return `Couldn't remove the worktree: ${message}. It's still at ${path}.`;
}
