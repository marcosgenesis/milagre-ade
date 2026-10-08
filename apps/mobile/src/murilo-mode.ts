import { useSyncExternalStore } from "react";
import { readMuriloMode, saveMuriloMode } from "./hosts-native";

// The phone's "Murilo mode" setting (Settings > Experimental), read once and shared by Settings and every Chat.
let on = false;
const listeners = new Set<() => void>();
void readMuriloMode().then((saved) => {
  on = saved;
  listeners.forEach((listener) => listener());
});

/** Desktop's Murilo mode: a reply's tool calls show in the Chat, one row each, instead of folding into one line. */
export function useMuriloMode(): [boolean, (on: boolean) => void] {
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
      void saveMuriloMode(next);
    },
  ];
}
