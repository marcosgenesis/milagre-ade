import { useEffect, useState } from "react";
import type { SkillCatalog } from "../model";
import { bridgeForKey } from "../lib/computer-bridge";

const EMPTY_CATALOG: SkillCatalog = { skills: [], warnings: [] };

// `revision` reads the disk again when it changes (Settings > Skills > Reload).
export function useSkills(projectPath: string, open: boolean, revision = 0) {
  const [result, setResult] = useState<{ path: string; catalog: SkillCatalog } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const bridge = bridgeForKey(projectPath);
    if (typeof bridge.listSkills !== "function") {
      setResult({ path: projectPath, catalog: { skills: [], warnings: ["Restart Milagre to enable skill discovery."] } });
      setLoading(false);
      return;
    }
    setLoading(true);
    bridge
      .listSkills(projectPath)
      .then((catalog) => {
        if (!cancelled) setResult({ path: projectPath, catalog });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Could not load skills. Reopen the menu to retry.";
        const warning = message.includes("No handler registered") ? "Restart Milagre to enable skill discovery." : message;
        if (!cancelled) setResult({ path: projectPath, catalog: { skills: [], warnings: [warning] } });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, open, revision]);

  const catalog = result?.path === projectPath ? result.catalog : EMPTY_CATALOG;
  return { skills: catalog.skills, shadowed: catalog.shadowed ?? [], warnings: catalog.warnings, loading };
}
