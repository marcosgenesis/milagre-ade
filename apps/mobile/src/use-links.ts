import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type { CanvasLink } from "@milagre/shared/chat-links";
import type { Client, RegisteredProject } from "./client";
import { linksUnsupported } from "./chat-links";

/** The connected computer's canvas Links and the Project registry that maps a Project's path to the id Links use. */
type Loaded = { client: Client; available: boolean; links: CanvasLink[]; projects: RegisteredProject[] };

// One copy for every screen, so a Link made from the chat list shows in the Chat's details at once, and back.
let loaded: Loaded | null = null;
const listeners = new Set<() => void>();
const reading = new Map<Client, Promise<void>>();

function set(next: Loaded) {
  loaded = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reads the computer's Links again. A Mac older than Links on the phone rejects the call: the Link UI hides rather than
 * show an error. Any other failure keeps what was read before, so a dropped request doesn't make icons blink away.
 */
function refreshLinks(client: Client) {
  const running = reading.get(client);
  if (running) return running;
  const work = read(client).finally(() => {
    reading.delete(client);
  });
  reading.set(client, work);
  return work;
}
async function read(client: Client) {
  try {
    const [links, projects] = await Promise.all([client.call<CanvasLink[]>("canvas:links"), client.call<RegisteredProject[]>("project:registry")]);
    const available = Array.isArray(links) && Array.isArray(projects);
    set({ client, available, links: available ? links : [], projects: available ? projects : [] });
  } catch (error) {
    if (linksUnsupported(error) || loaded?.client !== client) set({ client, available: false, links: [], projects: [] });
  }
}

/** Takes the Links a change answered with (canvas:link-add and canvas:link-remove return the whole list). */
export function setLinks(client: Client, links: CanvasLink[]) {
  if (loaded?.client === client) set({ ...loaded, links });
  else void refreshLinks(client);
}

/** The Links of the connected computer, read when a screen using them mounts and whenever the app comes back. */
export function useLinks(client: Client | null) {
  const current = useSyncExternalStore(subscribe, () => loaded);
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
    const data = current?.client === client ? current : null;
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
  }, [current, client, refresh]);
}
