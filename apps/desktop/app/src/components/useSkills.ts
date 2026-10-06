import { useEffect, useState } from "react";
import type { SkillCatalog } from "../model";

const EMPTY_CATALOG: SkillCatalog = { skills: [], warnings: [] };

export function useSkills(projectPath: string, open: boolean) {
  const [result, setResult] = useState<{ path: string; catalog: SkillCatalog } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (typeof window.milagre.listSkills !== "function") {
      // oxlint-disable-next-line react/set-state-in-effect -- pre-existing, see PR body
      setResult({ path: projectPath, catalog: { skills: [], warnings: ["Restart Milagre to enable skill discovery."] } });
      setLoading(false);
      return;
    }
    setLoading(true);
    window.milagre.listSkills(projectPath).then((catalog) => {
      if (!cancelled) setResult({ path: projectPath, catalog });
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Could not load skills. Reopen the menu to retry.";
      const warning = message.includes("No handler registered") ? "Restart Milagre to enable skill discovery." : message;
      if (!cancelled) setResult({ path: projectPath, catalog: { skills: [], warnings: [warning] } });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projectPath, open]);

  const catalog = result?.path === projectPath ? result.catalog : EMPTY_CATALOG;
  return { skills: catalog.skills, warnings: catalog.warnings, loading };
}
