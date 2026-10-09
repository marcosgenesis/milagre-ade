import { useEffect, useState } from "react";
import { bridgeForKey, isRemoteKey } from "./computer-bridge.ts";

// Images of a remote chat, read through media:read and kept as data URLs while recent: thumbnails, the lightbox and
// the image menus show the same bytes. A read that fails isn't kept, so the next look tries again. What's kept is
// bounded by its size (a data URL's length), least recently used out first.
export const MAX_KEPT_BYTES = 64 * 1024 * 1024;
const reads = new Map<string, { read: Promise<string>; bytes: number }>();
let kept = 0;

const forget = (key: string) => {
  const entry = reads.get(key);
  if (!entry) return;
  kept -= entry.bytes;
  reads.delete(key);
};

export function remoteImageDataUrl(scope: string, path: string): Promise<string> {
  const key = JSON.stringify([scope, path]);
  const known = reads.get(key);
  if (known) {
    reads.delete(key);
    reads.set(key, known);
    return known.read;
  }
  const entry = { read: Promise.resolve(""), bytes: 0 };
  entry.read = bridgeForKey(scope)
    .readMedia({ scope, path })
    .then((media) => {
      const url = `data:${media.type};base64,${media.base64}`;
      if (reads.get(key) === entry) {
        entry.bytes = url.length;
        kept += url.length;
        // The newest read stays even when it alone is over the bound.
        for (const [oldest] of reads) {
          if (kept <= MAX_KEPT_BYTES || oldest === key) break;
          forget(oldest);
        }
      }
      return url;
    });
  reads.set(key, entry);
  entry.read.catch(() => {
    if (reads.get(key) === entry) forget(key);
  });
  return entry.read;
}

type Loaded = { scope: string | null; sources: Record<string, string>; failed: Record<string, true> };

/**
 * Each path's data URL once read, for a remote scope; nothing for this Mac's, whose chats use milagre-media://.
 * `failed` names the paths whose read was refused or failed.
 */
export function useRemoteMedia(scope: string | null, paths: string[]): { sources: Record<string, string>; failed: Record<string, true> } {
  const [loaded, setLoaded] = useState<Loaded>({ scope: null, sources: {}, failed: {} });
  const wanted = JSON.stringify(paths);
  useEffect(() => {
    if (!scope || !isRemoteKey(scope)) return;
    let live = true;
    for (const path of JSON.parse(wanted) as string[])
      void remoteImageDataUrl(scope, path).then(
        (src) => {
          if (live)
            setLoaded((previous) => {
              const base = previous.scope === scope ? previous : { scope, sources: {}, failed: {} };
              return base.sources[path] === src ? base : { ...base, sources: { ...base.sources, [path]: src } };
            });
        },
        () => {
          if (live)
            setLoaded((previous) => {
              const base = previous.scope === scope ? previous : { scope, sources: {}, failed: {} };
              return base.failed[path] ? base : { ...base, failed: { ...base.failed, [path]: true } };
            });
        },
      );
    return () => {
      live = false;
    };
  }, [scope, wanted]);
  // Another scope's images never show under this one.
  return loaded.scope === scope ? loaded : { sources: {}, failed: {} };
}
