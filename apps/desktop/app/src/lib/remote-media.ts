import { useEffect, useState } from "react";
import { bridgeForKey, isRemoteKey } from "./computer-bridge.ts";

// Images of a remote chat, read through media:read and kept as data URLs while recent: thumbnails, the lightbox and
// the image menus show the same bytes. A read that fails isn't kept, so the next look tries again.
const KEPT = 64;
const reads = new Map<string, Promise<string>>();

export function remoteImageDataUrl(scope: string, path: string): Promise<string> {
  const key = `${scope}\n${path}`;
  const known = reads.get(key);
  if (known) {
    reads.delete(key);
    reads.set(key, known);
    return known;
  }
  const read = bridgeForKey(scope)
    .readMedia({ scope, path })
    .then((media) => `data:${media.type};base64,${media.base64}`);
  reads.set(key, read);
  read.catch(() => {
    if (reads.get(key) === read) reads.delete(key);
  });
  while (reads.size > KEPT) reads.delete(reads.keys().next().value!);
  return read;
}

/** Each path's data URL once read, for a remote scope; nothing for this Mac's, whose chats use milagre-media://. */
export function useRemoteMedia(scope: string | null, paths: string[]): Record<string, string> {
  const [sources, setSources] = useState<Record<string, string>>({});
  const joined = paths.join("\n");
  useEffect(() => {
    if (!scope || !isRemoteKey(scope)) return;
    let live = true;
    for (const path of joined.split("\n").filter(Boolean))
      void remoteImageDataUrl(scope, path).then(
        (src) => {
          if (live) setSources((previous) => (previous[path] === src ? previous : { ...previous, [path]: src }));
        },
        () => {},
      );
    return () => {
      live = false;
    };
  }, [scope, joined]);
  return sources;
}
