type Storage = { getItemAsync: (key: string) => Promise<string | null>; setItemAsync: (key: string, value: string) => Promise<void> };
const keyPrefix = "milagre.folded-projects.v1.";
// As project-order-store: some iOS releases refused SecureStore values above about 2048 bytes.
const MAX_BYTES = 1900;
const NONE: ReadonlySet<string> = new Set();

function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** SecureStore keys allow letters, digits, ".", "-" and "_": a computer's id (a URL) becomes a short hash. */
function keyFor(hostId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < hostId.length; i++) hash = Math.imul(hash ^ hostId.charCodeAt(i), 0x01000193) >>> 0;
  return `${keyPrefix}${hash.toString(16)}`;
}

/** The most recently folded paths whose saved form fits MAX_BYTES; older ones open again next launch. */
export function boundedFolded(hostId: string, paths: string[]): string[] {
  const kept: string[] = [];
  let bytes = utf8Length(JSON.stringify({ h: hostId, f: [] }));
  for (const path of paths.toReversed()) {
    bytes += utf8Length(JSON.stringify(path)) + 1;
    if (bytes > MAX_BYTES) break;
    kept.unshift(path);
  }
  return kept;
}

function parse(raw: string | null, hostId: string): string[] {
  try {
    const value = JSON.parse(raw || "null");
    if (!value || value.h !== hostId || !Array.isArray(value.f)) return [];
    return value.f.filter((path: unknown): path is string => typeof path === "string");
  } catch {
    return [];
  }
}

/**
 * The Project groups folded in the phone's sidebar, per paired computer. Every other group is open: going back to
 * the sidebar, or relaunching, shows a group folded only if it was folded by hand. Held in memory as well, so a
 * sidebar that mounts again reads it at once.
 */
export function createFoldedProjectsStore(storage: Storage) {
  const folded = new Map<string, ReadonlySet<string>>();
  const loading = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  // Serialize writes so a slow save cannot put an older set back on the next launch.
  let pending = Promise.resolve();
  const save = (hostId: string, paths: ReadonlySet<string>) => {
    pending = pending.then(() => storage.setItemAsync(keyFor(hostId), JSON.stringify({ h: hostId, f: boundedFolded(hostId, [...paths]) }))).catch(() => {});
    return pending;
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** The folded paths; none until `load` has read them. */
    folded: (hostId: string): ReadonlySet<string> => folded.get(hostId) ?? NONE,
    loaded: (hostId: string) => folded.has(hostId),
    /** Reads this computer's folded groups once. A fold made before the read ends wins over what was saved. */
    load(hostId: string): Promise<void> {
      if (folded.has(hostId)) return Promise.resolve();
      let work = loading.get(hostId);
      if (!work) {
        work = storage
          .getItemAsync(keyFor(hostId))
          .catch(() => null)
          .then((raw) => {
            if (folded.has(hostId)) return undefined;
            folded.set(hostId, new Set(parse(raw, hostId)));
            notify();
            return undefined;
          });
        loading.set(hostId, work);
      }
      return work;
    },
    /** Folds an open group, or opens a folded one. */
    toggle(hostId: string, path: string) {
      const next = new Set(folded.get(hostId) ?? NONE);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      folded.set(hostId, next);
      notify();
      return save(hostId, next);
    },
  };
}
