import { useEffect, useState } from "react";
import { useBridge } from "../lib/computer-bridge";

export function useProjectFiles(root: string, query: string, enabled: boolean) {
  const bridge = useBridge();
  const [result, setResult] = useState({ root: "", query: "", files: [] as string[], error: "" });
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    const timer = setTimeout(() => {
      bridge
        .searchProjectFiles(root, query)
        .then(
          (files) => {
            if (current) setResult({ root, query, files, error: "" });
          },
          () => {
            if (current) setResult({ root, query, files: [], error: "Could not search files. Check that the worktree still exists." });
          },
        )
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 100);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [root, query, enabled]);
  const matches = result.root === root && result.query === query;
  return { files: matches ? result.files : [], error: matches ? result.error : "", loading };
}
