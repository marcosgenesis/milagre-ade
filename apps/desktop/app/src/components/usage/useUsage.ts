import { useCallback, useEffect, useRef, useState } from "react";
import type { UsageSnapshot } from "../../model";
import { mergeSnapshot, seedSnapshot } from "./format";

const POLL_MS = 5 * 60_000;

export function useUsage(scopeKey?: string) {
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const [snapshotScope, setSnapshotScope] = useState(scopeKey);
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const lastReadAt = useRef(0);
  const generation = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    setLoading(true);
    const version = generation.current;
    inFlight.current = window.milagre
      .readUsage(scopeKey)
      .then((next) => {
        if (version !== generation.current || currentScope.current !== scopeKey) return;
        setSnapshotScope(scopeKey);
        lastReadAt.current = Date.now();
        setSnapshot((previous) => mergeSnapshot(previous, next, Date.now()));
      })
      .catch(() => {})
      .finally(() => {
        if (version === generation.current) {
          inFlight.current = null;
          setLoading(false);
        }
      });
    return inFlight.current;
  }, [scopeKey]);

  const refreshIfStale = useCallback(
    (maxAgeMs: number) => {
      if (Date.now() - lastReadAt.current > maxAgeMs) void refresh();
    },
    [refresh],
  );

  useEffect(() => {
    generation.current++;
    inFlight.current = null;
    lastReadAt.current = 0;
    setSnapshot(null);
    setLoading(false);
    // Saved numbers first, so the sidebar isn't empty while the first read runs.
    const version = generation.current;
    window.milagre
      .getCachedUsage(scopeKey)
      .then((cached) => {
        if (version === generation.current && currentScope.current === scopeKey) {
          setSnapshotScope(scopeKey);
          setSnapshot((current) => seedSnapshot(current, cached));
        }
      })
      .catch(() => {});
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const off = window.milagre.onAccountsChanged?.(() => {
      generation.current++;
      inFlight.current = null;
      lastReadAt.current = 0;
      setSnapshot(null);
      void refresh();
    });
    return () => {
      generation.current++;
      window.clearInterval(timer);
      off?.();
    };
  }, [refresh]);

  return { snapshot: snapshotScope === scopeKey ? snapshot : null, loading, refresh, refreshIfStale };
}

export type UsageState = ReturnType<typeof useUsage>;
