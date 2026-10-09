/**
 * A Projects list's order for this session: keys already shown keep their place, and a key seen for the first
 * time (a project just added) goes on top. Opening a project reorders the host's recent list; the list doesn't follow.
 */
export function stableOrder(previous, next) {
  const present = new Set(next);
  const kept = previous.filter((key) => present.has(key));
  const known = new Set(kept);
  return [...next.filter((key) => !known.has(key)), ...kept];
}

/** `next`'s items in the order `previous` showed them, by stableOrder on `keyOf`. */
export function keepOrder(previous, next, keyOf) {
  const byKey = new Map(next.map((item) => [keyOf(item), item]));
  return stableOrder(previous.map(keyOf), [...byKey.keys()]).map((key) => byKey.get(key));
}
