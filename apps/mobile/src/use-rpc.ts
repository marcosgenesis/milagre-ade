import { useEffect, useState } from "react";
import type { Client } from "./client";

export function useRpc<T>(client: Client | null, method: string, args: unknown[]) {
  const encoded = JSON.stringify(args);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ client: Client; identity: string; data: T | null; error: string } | null>(null);
  const identity = JSON.stringify([method, encoded, revision]);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client
      .call<T>(method, JSON.parse(encoded))
      .then((data) => {
        if (!cancelled) setLoaded({ client, identity, data, error: "" });
      })
      .catch((error) => {
        if (!cancelled) setLoaded({ client, identity, data: null, error: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [client, method, encoded, identity]);
  const current = loaded?.client === client && loaded?.identity === identity ? loaded : null;
  return { data: current?.data ?? null, error: current?.error || "", loading: !!client && !current, refresh: () => setRevision((value) => value + 1) };
}
