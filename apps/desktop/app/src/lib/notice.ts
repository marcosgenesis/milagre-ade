import { useSyncExternalStore } from "react";

// One small notice at a time, shown for a few seconds: "File not found" after a link that goes nowhere.
const NOTICE_MS = 3500;

let current: { id: number; text: string } | null = null;
let counter = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function showNotice(text: string) {
  current = { id: ++counter, text };
  clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    listeners.forEach((listener) => listener());
  }, NOTICE_MS);
  listeners.forEach((listener) => listener());
}

export function useNotice() {
  return useSyncExternalStore(subscribe, () => current);
}
