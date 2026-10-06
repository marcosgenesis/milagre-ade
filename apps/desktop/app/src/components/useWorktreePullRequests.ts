import { isTurnEnd } from "@milagre/shared/agent-runs";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CoordinatorState, PullRequest } from "../model";
import { chatInProject, sessionIdFromKey } from "../lib/agent-runs";
import { pullRequestRefs, type PullRequestRef } from "../lib/chat-pull-requests";
import { type PullRequestBlocker, updateBlockerDismissals } from "../lib/pr-blockers";

// Conflict entries are bare PR URLs, so this key keeps its name from when conflicts were the only blocker.
const DISMISSED_BLOCKERS = "milagre.dismissed-conflict-actions";

const POLL_MS = 30_000;
const FOCUS_GAP_MS = 5000;

/**
 * Runs `refresh` every `POLL_MS` only while the window is visible and focused. A hidden or blurred window
 * stops its timer (no wake-ups, no gh calls); coming back refreshes once, unless it just did, and resumes.
 */
function pollWhileActive(refresh: () => void, lastRefresh: () => number): () => void {
  const active = () => document.visibilityState === "visible" && document.hasFocus();
  let interval: number | undefined;
  const stop = () => { window.clearInterval(interval); interval = undefined; };
  const resume = () => {
    if (!active()) return;
    if (Date.now() - lastRefresh() >= FOCUS_GAP_MS) refresh();
    interval ??= window.setInterval(refresh, POLL_MS);
  };
  const pause = () => { if (!active()) stop(); };
  const onVisibility = () => (active() ? resume() : stop());
  if (active()) interval = window.setInterval(refresh, POLL_MS);
  window.addEventListener("focus", resume);
  window.addEventListener("blur", pause);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    stop();
    window.removeEventListener("focus", resume);
    window.removeEventListener("blur", pause);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** PRs stay transient: refresh on opening a project, focus, turn completion, and while visible. */
export function useWorktreePullRequests(projectPath: string, state: CoordinatorState | null) {
  const [dismissedBlockers, setDismissedBlockers] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(DISMISSED_BLOCKERS) ?? "[]");
      return Array.isArray(saved) ? saved.filter((url): url is string => typeof url === "string") : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(DISMISSED_BLOCKERS, JSON.stringify(dismissedBlockers)); } catch { /* Keep working in memory. */ }
  }, [dismissedBlockers]);
  const dismissBlockerAction = (pr: PullRequest, blocker: PullRequestBlocker) => setDismissedBlockers((current) => updateBlockerDismissals(current, pr, blocker));
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
            setDismissedBlockers((current) => updateBlockerDismissals(current, pr));
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
    const stopPolling = pollWhileActive(() => void refresh(), () => lastRefresh);
    const unsubscribe = window.milagre.onAgentEvent(({ chatId, event }) => {
      if (!chatInProject(projectPath, chatId) || !isTurnEnd(event)) return;
      const current = stateRef.current;
      const session = current?.sessions[sessionIdFromKey(chatId)];
      const path = session && current?.worktrees[session.worktree_id]?.path;
      if (path && paths.includes(path)) void refresh([path]);
    });
    return () => {
      disposed = true;
      stopPolling();
      unsubscribe();
    };
  }, [projectPath, pathsKey]);

  // PRs the chats created or merged, looked up from each chat's folder (numbers resolve in its repository).
  const chatRefs = useMemo(() => {
    const byPath: Record<string, PullRequestRef[]> = {};
    for (const session of Object.values(state?.sessions ?? {})) {
      const worktree = !session.archived ? state?.worktrees[session.worktree_id] : undefined;
      if (!worktree) continue;
      const refs = pullRequestRefs(state!.messages.filter((message) => message.session_id === session.id));
      if (refs.length) byPath[worktree.path] = [...new Set([...(byPath[worktree.path] ?? []), ...refs])];
    }
    return byPath;
  // oxlint-disable-next-line react/preserve-manual-memoization -- pre-existing, see PR body
  }, [state?.messages, state?.sessions, state?.worktrees]);
  const chatRefsKey = JSON.stringify(Object.entries(chatRefs).sort(([a], [b]) => a.localeCompare(b)));
  const [chatSnapshot, setChatSnapshot] = useState<{ projectPath: string; prs: Record<string, Record<PullRequestRef, PullRequest | null>> }>({ projectPath: "", prs: {} });
  const chatSnapshotRef = useRef(chatSnapshot);
  chatSnapshotRef.current = chatSnapshot;

  useEffect(() => {
    if (!projectPath) return;
    const entries: Array<[string, PullRequestRef[]]> = JSON.parse(chatRefsKey);
    if (!entries.length) return;
    let disposed = false;
    let lastRefresh = 0;
    // A merged PR can't change again, so it's read once; new and open ones follow the branch PR's refreshes.
    const refresh = async () => {
      lastRefresh = Date.now();
      const known = chatSnapshotRef.current.projectPath === projectPath ? chatSnapshotRef.current.prs : {};
      await Promise.all(entries.map(async ([path, refs]) => {
        const selected = refs.filter((ref) => known[path]?.[ref]?.state !== "MERGED");
        if (!selected.length) return;
        const prs = await window.milagre.readPullRequests(path, selected).catch(() => selected.map(() => null));
        if (disposed) return;
        setChatSnapshot((current) => {
          const previous = current.projectPath === projectPath ? current.prs : {};
          const read = Object.fromEntries(selected.map((ref, index) => [ref, prs[index] ?? null]));
          return { projectPath, prs: { ...previous, [path]: { ...previous[path], ...read } } };
        });
      }));
    };
    void refresh();
    const stopPolling = pollWhileActive(() => void refresh(), () => lastRefresh);
    return () => {
      disposed = true;
      stopPolling();
    };
  }, [projectPath, chatRefsKey]);

  return {
    pullRequests: snapshot.projectPath === projectPath ? snapshot.prs : {},
    chatPullRequests: chatSnapshot.projectPath === projectPath ? chatSnapshot.prs : {},
    dismissedBlockers,
    dismissBlockerAction,
  };
}
