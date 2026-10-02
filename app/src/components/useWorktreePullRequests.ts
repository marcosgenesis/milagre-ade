import { useEffect, useRef, useState } from "react";
import type { CoordinatorState, PullRequest } from "../model";
import { chatInProject, sessionIdFromKey } from "../lib/agent-runs";
import { updateConflictDismissals } from "../lib/conflict-action";

const DISMISSED_CONFLICTS = "milagre.dismissed-conflict-actions";

/** PRs stay transient: refresh on opening a project, focus, turn completion, and while visible. */
export function useWorktreePullRequests(projectPath: string, state: CoordinatorState | null) {
  const [dismissedConflicts, setDismissedConflicts] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(DISMISSED_CONFLICTS) ?? "[]");
      return Array.isArray(saved) ? saved.filter((url): url is string => typeof url === "string") : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(DISMISSED_CONFLICTS, JSON.stringify(dismissedConflicts)); } catch { /* Keep working in memory. */ }
  }, [dismissedConflicts]);
  const dismissConflictAction = (pr: PullRequest) => setDismissedConflicts((current) => updateConflictDismissals(current, pr, true));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [snapshot, setSnapshot] = useState<{ projectPath: string; prs: Record<string, PullRequest | null> }>({ projectPath: "", prs: {} });
  const pathsKey = JSON.stringify([...new Set(state?.messages.flatMap((message) => {
    const session = state.sessions[message.session_id];
    const worktree = session && !session.archived ? state.worktrees[session.worktree_id] : undefined;
    return worktree ? [worktree.path] : [];
  }) ?? [])].sort());

  useEffect(() => {
    if (!projectPath) return;
    const paths: string[] = JSON.parse(pathsKey);
    let disposed = false;
    let lastRefresh = 0;
    const pending = new Set<string>();
    const refresh = async (selected = paths) => {
      lastRefresh = Date.now();
      await Promise.all(selected.map(async (path) => {
        if (pending.has(path)) return;
        pending.add(path);
        try {
          const pr = await window.milagre.readPullRequest(path).catch(() => null);
          if (!disposed) {
            setDismissedConflicts((current) => updateConflictDismissals(current, pr));
            setSnapshot((current) => ({
              projectPath,
              prs: { ...(current.projectPath === projectPath ? current.prs : {}), [path]: pr },
            }));
          }
        } finally {
          pending.delete(path);
        }
      }));
    };
    void refresh();
    const onFocus = () => { if (Date.now() - lastRefresh >= 5000) void refresh(); };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    window.addEventListener("focus", onFocus);
    const unsubscribe = window.milagre.onAgentEvent(({ chatId, event }) => {
      if (!chatInProject(projectPath, chatId) || !["turn-completed", "turn-cancelled", "turn-failed"].includes(event.type)) return;
      const current = stateRef.current;
      const session = current?.sessions[sessionIdFromKey(chatId)];
      const path = session && current?.worktrees[session.worktree_id]?.path;
      if (path && paths.includes(path)) void refresh([path]);
    });
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [projectPath, pathsKey]);

  return { pullRequests: snapshot.projectPath === projectPath ? snapshot.prs : {}, dismissedConflicts, dismissConflictAction };
}
