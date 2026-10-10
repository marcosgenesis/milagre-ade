import type { CanvasLink } from "@milagre/shared/chat-links";
import type { RegisteredProject } from "./client";

/** What reads a computer's Links: its client. Kept apart from React Native, so the store runs in unit tests. */
type Caller = { call: <T>(method: string, args: unknown[]) => Promise<T> };
/** A computer's canvas Links and the Project registry that maps a Project's path to the id Links use. */
export type LinksState = { available: boolean; links: CanvasLink[]; projects: RegisteredProject[] };

/** What the bridge answers for a method its daemon doesn't list: a Mac older than Links on the phone. */
const linksUnsupported = (error: unknown) => /not available from mobile/i.test((error as Error)?.message ?? "");

// One copy per computer, shared by every screen, so a Link made from the chat list shows in the Chat's details at once.
// Keyed by client: a late answer from the computer the phone just left lands on that computer's copy, never this one's.
const states = new WeakMap<Caller, LinksState>();
const listeners = new Set<() => void>();
// The read running for each client, and whether something changed while it ran, so it reads once more after.
const reading = new Map<Caller, { work: Promise<void>; again: boolean }>();

function set(client: Caller, next: LinksState) {
  states.set(client, next);
  for (const listener of listeners) listener();
}

export function linksOf(client: Caller | null): LinksState | null {
  return client ? (states.get(client) ?? null) : null;
}

export function subscribeLinks(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reads the computer's Links again. A call while a read runs (a "links" signal, a change the phone made) doesn't reuse
 * that read, whose answer may predate the change: it queues one more read after it, and resolves when that one ends.
 */
export function refreshLinks(client: Caller): Promise<void> {
  const running = reading.get(client);
  if (running) {
    running.again = true;
    return running.work;
  }
  const entry = { work: Promise.resolve(), again: false };
  entry.work = (async () => {
    try {
      do {
        entry.again = false;
        await read(client);
      } while (entry.again);
    } finally {
      reading.delete(client);
    }
  })();
  reading.set(client, entry);
  return entry.work;
}

/**
 * A Mac older than Links on the phone rejects the call: the Link UI hides rather than show an error. Any other failure
 * keeps what was read before, so a dropped request doesn't make icons blink away.
 */
async function read(client: Caller) {
  try {
    const [links, projects] = await Promise.all([client.call<CanvasLink[]>("canvas:links", []), client.call<RegisteredProject[]>("project:registry", [])]);
    const available = Array.isArray(links) && Array.isArray(projects);
    set(client, { available, links: available ? links : [], projects: available ? projects : [] });
  } catch (error) {
    if (linksUnsupported(error) || !states.has(client)) set(client, { available: false, links: [], projects: [] });
  }
}

/** Takes the Links a change answered with (canvas:link-add and canvas:link-remove return the whole list). */
export function setLinks(client: Caller, links: CanvasLink[]) {
  const current = states.get(client);
  if (current) set(client, { ...current, links });
  // A read that started before the change would put the old list back; it reads once more instead.
  const running = reading.get(client);
  if (running) running.again = true;
  else if (!current) void refreshLinks(client);
}
