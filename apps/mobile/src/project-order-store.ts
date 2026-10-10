import { keepOrder } from "@milagre/shared/stable-order";

type Storage = { getItemAsync: (key: string) => Promise<string | null>; setItemAsync: (key: string, value: string) => Promise<void> };
const key = "milagre.project-order.v1";
// Computers whose order is kept; the one saved longest ago is forgotten first.
const MAX_COMPUTERS = 12;

/** `projects` in the order `saved` had them: a gone one drops out and a new one goes on top, as on the Mac. */
export function applyProjectOrder<T extends { path: string }>(saved: string[], projects: T[]): T[] {
  return keepOrder(
    saved.map((path) => ({ path })),
    projects,
    (item) => item.path,
  ) as T[];
}

function parse(raw: string | null): Record<string, string[]> {
  try {
    const value = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([host, order]) =>
        Array.isArray(order) ? [[host, order.filter((path): path is string => typeof path === "string")]] : [],
      ),
    );
  } catch {
    return {};
  }
}

/** The Projects list's order on each paired computer, so a relaunch keeps it instead of starting from the Mac's recent order. */
export function createProjectOrderStore(storage: Storage) {
  // Serialize writes so a slow save cannot put an older order back on the next launch.
  let pending = Promise.resolve();
  return {
    /** The Projects in this computer's saved order; unchanged when nothing is saved or storage fails. */
    async apply<T extends { path: string }>(hostId: string, projects: T[]): Promise<T[]> {
      try {
        await pending;
        const saved = parse(await storage.getItemAsync(key))[hostId];
        return saved ? applyProjectOrder(saved, projects) : projects;
      } catch {
        return projects;
      }
    },
    save(hostId: string, order: string[]) {
      pending = pending
        .then(async () => {
          const all = parse(await storage.getItemAsync(key));
          if (JSON.stringify(all[hostId]) === JSON.stringify(order)) return;
          delete all[hostId];
          all[hostId] = order;
          await storage.setItemAsync(key, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-MAX_COMPUTERS))));
        })
        .catch(() => {});
      return pending;
    },
  };
}
