import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import type { LinearStatus } from "@milagre/shared/linear";
import type { Client } from "./client";

/** Whether the connected Mac has Linear switched on and connected. Read on focus: the phone gets no event when either changes. */
export function useLinear(client: Client | null): { active: boolean } {
  const [active, setActive] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!client) {
        setActive(false);
        return;
      }
      let live = true;
      Promise.all([client.call<{ enabled: boolean }>("linear:enabled:read", []), client.call<LinearStatus>("linear:status", [])]).then(
        // An older Mac answers null for commands it lacks: Linear stays off.
        ([value, status]) => live && setActive(value?.enabled === true && status?.connected === true),
        () => live && setActive(false),
      );
      return () => {
        live = false;
      };
    }, [client]),
  );
  return { active };
}
