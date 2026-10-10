import { useCallback, useEffect, useRef, useState } from "react";
import type { LinearIssue } from "@milagre/shared/linear";
import { pollWhileActive } from "./useWorktreePullRequests";
import { bridgeForKey } from "../lib/computer-bridge";

const NO_ISSUES: Record<string, LinearIssue> = {};
// The last issues read for each Project: a Project opened again shows them while the next read is under way.
const lastIssues = new Map<string, Record<string, LinearIssue>>();

/**
 * Linear issues the Worktrees under a Project were started from or name, keyed by Worktree path. Polls like the PRs do.
 * `refresh` reads them again at once, e.g. after a link or unlink.
 */
export function useWorktreeLinearIssues(projectPath: string, active: boolean): { issues: Record<string, LinearIssue>; refresh: () => void } {
  const [snapshot, setSnapshot] = useState<{ projectPath: string; issues: Record<string, LinearIssue> }>({ projectPath: "", issues: NO_ISSUES });
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!projectPath || !active) return;
    let disposed = false;
    let lastRefresh = 0;
    const refresh = async () => {
      lastRefresh = Date.now();
      const issues = await readIssues(projectPath);
      if (disposed) return;
      lastIssues.set(projectPath, issues);
      setSnapshot((current) => keepIfSame(current, projectPath, issues));
    };
    refreshRef.current = () => void refresh();
    void refresh();
    const stopPolling = pollWhileActive(
      () => void refresh(),
      () => lastRefresh,
    );
    return () => {
      disposed = true;
      refreshRef.current = () => {};
      stopPolling();
    };
  }, [projectPath, active]);
  const refresh = useCallback(() => refreshRef.current(), []);
  return { issues: !active ? NO_ISSUES : snapshot.projectPath === projectPath ? snapshot.issues : (lastIssues.get(projectPath) ?? NO_ISSUES), refresh };
}

// Never throws: a failed read shows no chips.
async function readIssues(projectPath: string): Promise<Record<string, LinearIssue>> {
  try {
    return (await bridgeForKey(projectPath).readWorktreeLinearIssues(projectPath)) ?? NO_ISSUES;
  } catch {
    return NO_ISSUES;
  }
}

// A poll that finds the same issues keeps the same object, so the sidebar rows don't re-render.
function keepIfSame(current: { projectPath: string; issues: Record<string, LinearIssue> }, projectPath: string, issues: Record<string, LinearIssue>) {
  if (current.projectPath === projectPath && JSON.stringify(current.issues) === JSON.stringify(issues)) return current;
  return { projectPath, issues };
}
