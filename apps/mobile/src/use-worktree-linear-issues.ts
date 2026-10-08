import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AppState } from "react-native";
import type { LinearIssue } from "@milagre/shared/linear";
import type { Client } from "./client";

/** Project path to its Worktrees' issues, keyed by Worktree path. */
type Loaded = Record<string, Record<string, LinearIssue>>;

/**
 * The Linear issue of each Worktree in these Projects, keyed by Worktree path. Read while focused, every 30 s and when the app
 * comes back to the foreground, like the Pull request chips. Pass no paths to stop reading (Linear off or no client).
 */
export function useWorktreeLinearIssues(client: Client | null, projectPaths: string[]): Record<string, LinearIssue> {
  const [loaded, setLoaded] = useState<Loaded>({});
  const pathsKey = JSON.stringify(projectPaths);
  useFocusEffect(
    useCallback(() => {
      if (!client) return;
      const paths: string[] = JSON.parse(pathsKey);
      if (!paths.length) return;
      let focused = true;
      const active = () => focused && AppState.currentState === "active";
      const refresh = () => {
        if (!active()) return;
        for (const projectPath of paths) {
          // A failed read keeps what was shown; the daemon answers {} itself when Linear is off or disconnected.
          client
            .call<Record<string, LinearIssue>>("linear:worktree-issues", [projectPath])
            .then((issues) => active() && setLoaded((previous) => ({ ...previous, [projectPath]: issues || {} })))
            .catch(() => {});
        }
      };
      refresh();
      const timer = setInterval(refresh, 30000);
      const subscription = AppState.addEventListener("change", refresh);
      return () => {
        focused = false;
        clearInterval(timer);
        subscription.remove();
      };
    }, [client, pathsKey]),
  );
  return useMemo(() => {
    const merged: Record<string, LinearIssue> = {};
    for (const projectPath of JSON.parse(pathsKey) as string[]) Object.assign(merged, loaded[projectPath]);
    return merged;
  }, [loaded, pathsKey]);
}
