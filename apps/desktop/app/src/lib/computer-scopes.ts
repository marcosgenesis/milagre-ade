import { useCallback, useEffect, useMemo, useState } from "react";
import type { NamedProjectLink } from "@milagre/shared/model";
import { LOCAL_COMPUTER } from "@milagre/shared/chat-scopes";
import type { ComputerView } from "../electron";
import { bridgeFor } from "./computer-bridge.ts";
import { RECENT_PROJECTS_CHANGED, type RecentProject } from "./project-list.ts";

/** One Project or Link of a computer, keyed as the window keeps it (`${id}|path`, `milagre-link:${id}|uuid`). */
export type ComputerScope = { key: string; name: string; initial: string; link: NamedProjectLink | null; computerId: string };

/** A computer's Projects (those not hidden) then its Links, from its own lists; main has already qualified their keys. */
export function computerScopes(computerId: string, recent: RecentProject[], links: NamedProjectLink[]): ComputerScope[] {
  return [
    ...recent
      .filter((project) => !project.hidden)
      .map((project) => ({ key: project.path, name: project.name, initial: project.name.slice(0, 1).toUpperCase(), link: null, computerId })),
    ...links.filter((link) => !link.hidden).map((link) => ({ key: `milagre-link:${link.id}`, name: link.name, initial: "", link, computerId })),
  ];
}

/**
 * Every computer's scopes in one list (spec "sidebar-scopes.ts … merged by Project name order"): Projects by name, then
 * Links by name; on a tie This Mac's first, then the computers in the popover's order.
 */
export function mergeScopes<T extends { key: string; name: string; link: unknown; computerId: string }>(scopes: T[], computerOrder: string[]): T[] {
  const rank = (scope: T) => (scope.computerId === LOCAL_COMPUTER ? -1 : computerOrder.indexOf(scope.computerId));
  return [...scopes].sort(
    (a, b) =>
      Number(Boolean(a.link)) - Number(Boolean(b.link)) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      rank(a) - rank(b) ||
      a.key.localeCompare(b.key),
  );
}

/** Remote scopes minus those the window already holds as its own (the open Project of another computer is among the local ones). */
export function withoutLocal<T extends { key: string }>(remote: T[], local: { key: string }[]): T[] {
  return remote.filter((scope) => !local.some((item) => item.key === scope.key));
}

/** Another computer's Project as the project chooser lists it, hidden ones included. */
export type ComputerProject = RecentProject & { computerId: string };

/**
 * Each paired computer's Projects and Links, read from it (from its cache in main while it is away), again when its
 * state changes, and when a Project is hidden or shown. A failed read keeps the last list. `scopes` are what the sidebar
 * lists; `projects` every Project, hidden too, for the chooser. `setHidden` shows a choice before the computer answers.
 */
export function useComputerScopes(computers: ComputerView[]): {
  scopes: ComputerScope[];
  projects: ComputerProject[];
  setHidden: (key: string, hidden: boolean) => void;
} {
  const [byComputer, setByComputer] = useState<Record<string, { recent: RecentProject[]; links: NamedProjectLink[] }>>({});
  const [changed, setChanged] = useState(0);
  const states = computers.map((computer) => `${computer.id}:${computer.state}`).join("\n");
  useEffect(() => {
    const bump = () => setChanged((count) => count + 1);
    window.addEventListener(RECENT_PROJECTS_CHANGED, bump);
    return () => window.removeEventListener(RECENT_PROJECTS_CHANGED, bump);
  }, []);
  useEffect(() => {
    let live = true;
    // A computer turned off keeps no scopes.
    const off = computers.filter((computer) => computer.state === "off").map((computer) => computer.id);
    if (off.length > 0)
      setByComputer((previous) =>
        off.some((id) => id in previous) ? Object.fromEntries(Object.entries(previous).filter(([id]) => !off.includes(id))) : previous,
      );
    for (const computer of computers) {
      if (computer.state === "off") continue;
      const bridge = bridgeFor(computer.id);
      void Promise.all([bridge.listRecentProjects().catch(() => null), bridge.listNamedLinks().catch(() => null)]).then(([recent, links]) => {
        if (!live || !Array.isArray(recent)) return;
        setByComputer((previous) => ({ ...previous, [computer.id]: { recent, links: Array.isArray(links) ? links : [] } }));
      });
    }
    return () => {
      live = false;
    };
  }, [states, changed]);
  const setHidden = useCallback(
    (key: string, hidden: boolean) =>
      setByComputer((previous) =>
        Object.fromEntries(
          Object.entries(previous).map(([id, lists]) => {
            if (key.startsWith("milagre-link:")) {
              const linkId = key.slice("milagre-link:".length);
              return [
                id,
                lists.links.some((link) => link.id === linkId)
                  ? { ...lists, links: lists.links.map((link) => (link.id === linkId ? { ...link, hidden } : link)) }
                  : lists,
              ];
            }
            return [
              id,
              lists.recent.some((project) => project.path === key)
                ? { ...lists, recent: lists.recent.map((project) => (project.path === key ? { ...project, hidden } : project)) }
                : lists,
            ];
          }),
        ),
      ),
    [],
  );
  return useMemo(() => {
    const listed = computers.filter((computer) => byComputer[computer.id]).map((computer) => [computer.id, byComputer[computer.id]!] as const);
    return {
      scopes: listed.flatMap(([id, lists]) => computerScopes(id, lists.recent, lists.links)),
      projects: listed.flatMap(([id, lists]) => [
        ...lists.recent.map((project) => ({ ...project, computerId: id })),
        ...lists.links.map((link) => ({ path: `milagre-link:${link.id}`, name: link.name, openedAt: link.createdAt, hidden: link.hidden, computerId: id })),
      ]),
      setHidden,
    };
  }, [byComputer, computers, setHidden]);
}
