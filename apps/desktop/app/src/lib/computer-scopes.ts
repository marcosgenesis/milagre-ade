import { useEffect, useState } from "react";
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
    ...links.map((link) => ({ key: `milagre-link:${link.id}`, name: link.name, initial: "", link, computerId })),
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

/**
 * Each paired computer's Projects and Links, read from it (from its cache in main while it is away), again when its
 * state changes, and when a Project is hidden or shown. A failed read keeps the last list.
 */
export function useComputerScopes(computers: ComputerView[]): ComputerScope[] {
  const [byComputer, setByComputer] = useState<Record<string, ComputerScope[]>>({});
  const [changed, setChanged] = useState(0);
  const states = computers.map((computer) => `${computer.id}:${computer.state}`).join("\n");
  useEffect(() => {
    const bump = () => setChanged((count) => count + 1);
    window.addEventListener(RECENT_PROJECTS_CHANGED, bump);
    return () => window.removeEventListener(RECENT_PROJECTS_CHANGED, bump);
  }, []);
  useEffect(() => {
    let live = true;
    for (const computer of computers) {
      if (computer.state === "off") continue;
      const bridge = bridgeFor(computer.id);
      void Promise.all([bridge.listRecentProjects().catch(() => null), bridge.listNamedLinks().catch(() => null)]).then(([recent, links]) => {
        if (!live || !Array.isArray(recent)) return;
        setByComputer((previous) => ({ ...previous, [computer.id]: computerScopes(computer.id, recent, Array.isArray(links) ? links : []) }));
      });
    }
    return () => {
      live = false;
    };
  }, [states, changed]);
  const ids = new Set(computers.map((computer) => computer.id));
  return Object.entries(byComputer)
    .filter(([id]) => ids.has(id))
    .flatMap(([, scopes]) => scopes);
}
