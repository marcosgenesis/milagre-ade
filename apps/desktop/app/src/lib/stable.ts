import { useCallback, useRef } from "react";

export function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** The previous Set while its members are unchanged, so a memo or memo()'d child keyed on it skips. */
export function useStableSet<T>(set: Set<T>): Set<T> {
  const kept = useRef(set);
  if (!sameSet(kept.current, set)) kept.current = set;
  return kept.current;
}

/** A callback with one identity that always runs the latest closure, so memo()'d children keep skipping. */
export function useEvent<Args extends unknown[], Result>(handler: (...args: Args) => Result): (...args: Args) => Result {
  const latest = useRef(handler);
  latest.current = handler;
  return useCallback((...args: Args) => latest.current(...args), []);
}

/** Structural equality for plain data (objects, arrays, primitives), to a depth where wire rows end. */
export function sameData(a: unknown, b: unknown, depth = 4): boolean {
  if (a === b) return true;
  if (depth === 0 || !a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && sameData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth - 1));
}

/** Rows rebuilt from scratch, with every row (and the list) the previous build already had kept as it was. */
export function reuseRows<T extends { id: string }>(previous: T[], next: T[]): T[] {
  const before = new Map(previous.map((row) => [row.id, row]));
  const rows = next.map((row) => {
    const old = before.get(row.id);
    return old && sameData(old, row) ? old : row;
  });
  return rows.length === previous.length && rows.every((row, index) => row === previous[index]) ? previous : rows;
}
