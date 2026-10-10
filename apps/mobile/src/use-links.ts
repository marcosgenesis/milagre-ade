import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type { Client } from "./client";
import { linksOf, refreshLinks, subscribeLinks } from "./links-store";

// The store lives in links-store.ts, apart from React Native; these are what the screens and the session use.
export { refreshLinks, setLinks } from "./links-store";

/** The Links of the connected computer, read when a screen using them mounts and whenever the app comes back. */
export function useLinks(client: Client | null) {
  // Only this computer's copy: a late answer from one the phone left can't stand in for it.
  const data = useSyncExternalStore(subscribeLinks, () => linksOf(client));
  useEffect(() => {
    if (!client) return;
    void refreshLinks(client);
    const watch = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshLinks(client);
    });
    return () => watch.remove();
  }, [client]);
  const refresh = useCallback(() => (client ? refreshLinks(client) : Promise.resolve()), [client]);
  return useMemo(() => {
    const projects = data?.projects ?? [];
    return {
      available: !!data?.available,
      links: data?.links ?? [],
      projects,
      /** The registry id of the local Project at this path; Link scopes (milagre-link:) have none. */
      projectIdOf: (path: string) => projects.find((project) => project.path === path)?.id,
      projectNameOf: (id: string) => projects.find((project) => project.id === id)?.name,
      refresh,
    };
  }, [data, refresh]);
}
