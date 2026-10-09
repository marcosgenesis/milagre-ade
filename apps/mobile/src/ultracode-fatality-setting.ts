import { useSyncExternalStore } from "react";
import { readUltracodeFatality, saveUltracodeFatality } from "./hosts-native";

// The phone's "Ultracode Fatality" setting (Settings > Experimental), read once and shared by Settings and the model sheet.
let on = false;
const listeners = new Set<() => void>();
void readUltracodeFatality().then((saved) => {
  on = saved;
  listeners.forEach((listener) => listener());
});

/** Desktop's Ultracode Fatality: turning Ultracode on plays the Mortal Kombat overlay (the phone has no voice yet). */
export function useUltracodeFatality(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => on,
  );
  return [
    value,
    (next) => {
      on = next;
      listeners.forEach((listener) => listener());
      void saveUltracodeFatality(next);
    },
  ];
}
