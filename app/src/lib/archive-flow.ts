import type { CoordinatorState, Worktree } from "../model";
import { removeFailureNotice, withoutWorktree, worktreeShared } from "./archive.ts";
import type { ArchiveMode, ArchivePlan, WorktreeStatus } from "./archive.ts";

export type RemoveOptions = { force: boolean; base: string; projectPath: string; chatId: string; seen: WorktreeStatus };

/** What archiving a chat touches, passed in so the order of the steps can be tested. */
export type ArchiveDeps = {
  /** The project the chat is in; the archive stops short of changing state if the window has moved on. */
  projectPath: string;
  chatId: string;
  getState: () => CoordinatorState | null;
  currentProjectPath: () => string | undefined;
  /** Interrupts the chat's running turn, if it has one. */
  stop: () => Promise<unknown> | undefined;
  /** Hides the chat (and leaves it if it is open). */
  hide: () => void;
  /** Brings the chat back after `hide`, because its worktree is staying: un-archived, and reselected if it was open and nothing else was opened since. */
  restore: () => void;
  /** Removes the worktree; main closes the chat's agent and checks again against `seen`. */
  remove: (worktree: Worktree, options: RemoveOptions) => Promise<unknown>;
  /** The state after the worktree is gone, and the chats that went with it. */
  applyRemoval: (next: CoordinatorState, removed: { worktreeId: number; sessionIds: number[] }) => void;
  refreshBranches: () => void;
  notify: (message: string) => void;
};

/**
 * Archives a chat. The chat is hidden first, so a worktree that won't go never keeps the archive from happening.
 * The worktree is removed only when the chosen mode asks for it, the menu's status is at hand, and no other chat
 * uses it by now. A refusal or an error becomes a notice, the worktree stays, and the chat is restored.
 */
export async function archiveChat(deps: ArchiveDeps, sessionId: number, mode: ArchiveMode, plan: ArchivePlan | null): Promise<"hidden" | "removed" | "kept"> {
  const latest = deps.getState();
  const worktree = latest ? latest.worktrees[latest.sessions[sessionId]?.worktree_id ?? -1] : undefined;
  const wantsRemoval = mode === "remove" || mode === "delete";
  // Another chat may have started using the worktree since the menu looked at it.
  const removing = wantsRemoval && latest && worktree?.base && plan?.status && !worktreeShared(latest, sessionId) ? worktree : null;
  const stopped = deps.stop();
  deps.hide();
  if (!removing || !plan?.status) return "hidden";
  const sessionIds = Object.values(latest!.sessions).filter((session) => session.worktree_id === removing.id).map((session) => session.id);
  // The turn must have wound down before main closes the agent and looks at the folder.
  await stopped;
  try {
    await deps.remove(removing, { force: mode === "delete", base: removing.base!, projectPath: deps.projectPath, chatId: deps.chatId, seen: plan.status });
  } catch (error) {
    // The worktree stays, and with hide-only archive it would be invisible: the chat comes back with it.
    deps.restore();
    deps.notify(removeFailureNotice(error));
    return "kept";
  }
  // The window moved to another project meanwhile: that project's state isn't ours to change.
  if (deps.currentProjectPath() !== deps.projectPath) return "removed";
  const next = deps.getState();
  if (next) deps.applyRemoval(withoutWorktree(next, removing.id), { worktreeId: removing.id, sessionIds });
  deps.refreshBranches();
  return "removed";
}
