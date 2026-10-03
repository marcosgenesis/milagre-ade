import { useSyncExternalStore } from "react";

/** The composer's text, held outside React state so typing re-renders only the components that read it. */
export function createDraftStore() {
  let value = "";
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: string) => {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type DraftStore = ReturnType<typeof createDraftStore>;

export function useDraft(store: DraftStore): string {
  return useSyncExternalStore(store.subscribe, store.get);
}
