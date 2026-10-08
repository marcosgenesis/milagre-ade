import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AppState } from "react-native";
import type { PullRequest } from "@milagre/shared/model";
import type { Client } from "./client";
import { readPullRequest } from "./pr-status";

export type PullRequestTarget = { path: string; refs: string[] };
type Status = Record<string, { branch?: PullRequest; found: Record<string, PullRequest | null> }>;

/** Only expanded/filtered Chat rows request GitHub data, sharing the Chat screen's bounded request pool. */
export function useChatPullRequests(client: Client | null, targets: PullRequestTarget[]) {
  const [status, setStatus] = useState<Status>({});
  const targetsKey = JSON.stringify(targets);
  useFocusEffect(
    useCallback(() => {
      if (!client) return;
      const entries: PullRequestTarget[] = JSON.parse(targetsKey);
      let focused = true;
      const active = () => focused && AppState.currentState === "active";
      const refresh = () => {
        if (!active()) return;
        for (const { path, refs } of entries) {
          for (const ref of [undefined, ...refs]) {
            void readPullRequest(client, path, active, ref)
              .then((value) => {
                if (!active() || value === undefined) return;
                setStatus((previous) => {
                  const old = previous[path] || { found: {} };
                  return {
                    ...previous,
                    [path]: ref ? { ...old, found: { ...old.found, [ref]: value } } : { ...old, branch: value || undefined },
                  };
                });
              })
              .catch(() => {});
          }
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
    }, [client, targetsKey]),
  );
  return status;
}
