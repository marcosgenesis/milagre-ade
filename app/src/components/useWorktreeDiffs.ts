import { useCallback, useEffect, useRef } from "react";
import type { CoordinatorState, DiffStat } from "../model";
import { chatInProject, sessionIdFromKey } from "../lib/agent-runs";
import { withDiffStats } from "../lib/chat-list";

// A burst of edits makes one git call; focusing the window again re-reads at most this often.
const EDIT_DEBOUNCE = 1200;
const FOCUS_THROTTLE = 5000;

/**
 * Keeps each worktree's diff stat in the project state, so the chat hover card shows it at once.
 * Re-read in the background when the project opens, when the window regains focus (edits made
 * outside Milagre), and after an agent's tool step or turn ends in one of the worktree's chats.
 * `refresh` re-reads some worktrees at once, e.g. after a commit from the "Commit and open PR" dialog.
 */
export function useWorktreeDiffs(projectPath: string, getState: () => CoordinatorState | null, commit: (next: CoordinatorState) => void) {
  const projectPathRef = useRef(projectPath);
  const getStateRef = useRef(getState);
  const commitRef = useRef(commit);
  projectPathRef.current = projectPath;
  getStateRef.current = getState;
  commitRef.current = commit;
  const timers = useRef(new Map<number, number>());
  const lastFullRead = useRef(0);

  /** Re-reads the given worktrees, or every worktree that has a chat. */
  const refresh = useCallback(async (worktreeIds?: number[]) => {
    const state = getStateRef.current();
    const path = projectPathRef.current;
    if (!state || !path) return;
    const ids = worktreeIds ?? [...new Set(state.messages.map((message) => state.sessions[message.session_id]?.worktree_id).filter((id): id is number => id !== undefined))];
    const stats = await Promise.all(ids.map(async (id): Promise<[number, DiffStat | null]> => {
      const worktree = state.worktrees[id];
      if (!worktree) return [id, null];
      return [id, await window.milagre.readDiffStat(worktree.path, worktree.base).catch(() => null)];
    }));
    // Read the state again: turns may have finished, or another project opened, while git ran.
    const latest = getStateRef.current();
    if (!latest || projectPathRef.current !== path) return;
    const next = withDiffStats(latest, Object.fromEntries(stats));
    if (next !== latest) commitRef.current(next);
  }, []);

  const refreshAll = useCallback(() => {
    lastFullRead.current = Date.now();
    void refresh();
  }, [refresh]);

  const schedule = useCallback((worktreeId: number) => {
    window.clearTimeout(timers.current.get(worktreeId));
    timers.current.set(worktreeId, window.setTimeout(() => {
      timers.current.delete(worktreeId);
      void refresh([worktreeId]);
    }, EDIT_DEBOUNCE));
  }, [refresh]);

  useEffect(() => {
    if (projectPath) refreshAll();
  }, [projectPath, refreshAll]);

  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastFullRead.current >= FOCUS_THROTTLE) refreshAll();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshAll]);

  useEffect(() => window.milagre.onAgentEvent(({ chatId, event }) => {
    if (!chatInProject(projectPathRef.current, chatId)) return;
    if (event.type !== "step-completed" && event.type !== "turn-completed" && event.type !== "turn-cancelled" && event.type !== "turn-failed") return;
    const worktreeId = getStateRef.current()?.sessions[sessionIdFromKey(chatId)]?.worktree_id;
    if (worktreeId !== undefined) schedule(worktreeId);
  }), [schedule]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { refresh };
}
