import { useCallback, useEffect, useRef, useState } from "react";
import type { UsageSnapshot } from "../../model";
import { mergeSnapshot, seedSnapshot } from "./format";

const POLL_MS = 5 * 60_000;

export function useUsage() {
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
      .readUsage()
      .then((next) => {
        if (version !== generation.current) return;
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
  }, []);

  const refreshIfStale = useCallback(
    (maxAgeMs: number) => {
      if (Date.now() - lastReadAt.current > maxAgeMs) void refresh();
    },
    [refresh],
  );

  useEffect(() => {
    // Saved numbers first, so the sidebar isn't empty while the first read runs.
    const version = generation.current;
    window.milagre
      .getCachedUsage()
      .then((cached) => {
        if (version === generation.current) setSnapshot((current) => seedSnapshot(current, cached));
      })
      .catch(() => {});
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const off = window.milagre.onAccountsChanged?.(() => {
      generation.current++;
      inFlight.current = null;
      setSnapshot(null);
      void refresh();
    });
    return () => {
      window.clearInterval(timer);
      off?.();
    };
  }, [refresh]);

  return { snapshot, loading, refresh, refreshIfStale };
}

export type UsageState = ReturnType<typeof useUsage>;
