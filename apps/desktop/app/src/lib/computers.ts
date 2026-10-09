import { useEffect } from "react";
import { useSettings } from "./settings.ts";

/**
 * Tells main whether to connect the saved computers: at launch, and each time Settings › Experimental › Other computers
 * flips. A window without the API (a check's fixture) is left alone.
 */
export function useApplyOtherComputers() {
  const { otherComputers } = useSettings();
  useEffect(() => {
    void Promise.resolve(window.milagre?.computers?.setEnabled?.(otherComputers)).catch(() => {});
  }, [otherComputers]);
}
