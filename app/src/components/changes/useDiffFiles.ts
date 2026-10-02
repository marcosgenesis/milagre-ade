import { useCallback, useEffect, useRef, useState } from "react";
import type { DiffFileEntry, DiffFileResult, DiffMode } from "../../electron";

// Patches load as files scroll into view; a few at a time keeps git from competing with the agent.
const MAX_IN_FLIGHT = 4;
// Past this many changed lines a file waits for "Show diff" instead of loading and highlighting on scroll.
export const LARGE_DIFF_LINES = 3000;

export type PatchState = { status: "loading" } | { status: "error"; message: string } | ({ status: "ready" } & DiffFileResult);

export type DiffList =
  | { state: "idle" | "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; isRepo: false; message: string }
  | { state: "ready"; isRepo: true; base: string | null; files: DiffFileEntry[]; message?: string };

export function isLarge(file: DiffFileEntry) {
  return file.added + file.removed > LARGE_DIFF_LINES;
}

function patchKey(cwd: string, mode: DiffMode, file: DiffFileEntry) {
  return [cwd, mode, file.path, file.added, file.removed].join("\0");
}

/**
 * The changed files of a chat's folder and their patches. `refresh` re-reads the list and drops every cached
 * patch, since an edit can keep a file's line counts; files still on screen load theirs again. Large files
 * the user opened with "Show diff" stay opened until the folder or mode changes.
 */
export function useDiffFiles({ cwd, base, mode, active }: { cwd: string; base?: string; mode: DiffMode; active: boolean }) {
  const [list, setList] = useState<DiffList>({ state: "idle" });
  const [, setVersion] = useState(0);
  const cache = useRef(new Map<string, PatchState>());
  const queue = useRef<(() => void)[]>([]);
  const inFlight = useRef(0);
  const generation = useRef(0);
  // Bumped whenever the cache is dropped, so a patch read that started before it doesn't land in the new one.
  const epoch = useRef(0);
  const forced = useRef(new Set<string>());
  const request = useRef({ cwd, base, mode });
  request.current = { cwd, base, mode };
  const bump = () => setVersion((version) => version + 1);

  const dropPatches = useCallback(() => {
    epoch.current++;
    queue.current = [];
    cache.current.clear();
  }, []);

  const refresh = useCallback(async () => {
    const { cwd, base, mode } = request.current;
    const current = ++generation.current;
    setList((previous) => (previous.state === "ready" ? previous : { state: "loading" }));
    try {
      const result = await window.milagre.git.diffFiles({ cwd, base, mode });
      if (current === generation.current) {
        dropPatches();
        setList({ state: "ready", ...result });
      }
    } catch (error) {
      if (current === generation.current) setList({ state: "error", message: error instanceof Error ? error.message : "Couldn't read the changes" });
    }
  }, [dropPatches]);

  useEffect(() => {
    dropPatches();
    forced.current.clear();
    setList({ state: "idle" });
    if (active && cwd) void refresh();
    // Invalidates a read still running for the old folder or mode.
    return () => { generation.current++; };
  }, [active, cwd, base, mode, refresh, dropPatches]);

  const pump = useCallback(() => {
    while (inFlight.current < MAX_IN_FLIGHT && queue.current.length) queue.current.shift()!();
  }, []);

  /** Starts loading a file's patch unless it is cached or already loading. `force` is "Show diff" on a large file. */
  const load = useCallback((file: DiffFileEntry, force = false) => {
    const { cwd, base, mode } = request.current;
    const key = patchKey(cwd, mode, file);
    if (force) forced.current.add(file.path);
    if (cache.current.has(key) || file.binary || (isLarge(file) && !forced.current.has(file.path))) return;
    const loadEpoch = epoch.current;
    cache.current.set(key, { status: "loading" });
    bump();
    queue.current.push(() => {
      inFlight.current++;
      window.milagre.git.diffFile({ cwd, base, mode, path: file.path, oldPath: file.oldPath, untracked: file.untracked })
        .then<PatchState, PatchState>((result) => ({ status: "ready", ...result }), (error) => ({ status: "error", message: error instanceof Error ? error.message : "Couldn't read this file" }))
        .then((next) => {
          if (loadEpoch === epoch.current) cache.current.set(key, next);
          inFlight.current--;
          bump();
          pump();
        });
    });
    pump();
  }, [pump]);

  const patchFor = (file: DiffFileEntry) => cache.current.get(patchKey(cwd, mode, file));

  return { list, refresh, load, patchFor };
}
