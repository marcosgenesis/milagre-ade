// A Project's state is replaced on every change, never changed in place, and the new state shares every part that
// didn't change with the one before. So what changed can be found by identity alone, without walking the parts that
// stayed: a diffstat or a title touches one session, a reply adds one message. The host sends that patch in place of
// the whole state (megabytes for a large Project), and a client that holds the state it was made from applies it.
//
// A patch is one of:
//   { v: value }                          the value as it is now (a new key, a changed scalar, or past the depth)
//   { o: { key: patch }, d: [key] }       an object: changed keys, and keys it no longer has
//   { a: length, s: { index: patch } }    an array: its length now, and the items that changed
// Applying a patch to the state it was made from gives a state equal to the new one, which shares with the old one
// whatever the patch leaves alone.

const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** What turns `previous` into `next`; undefined when they are the same object. Below `depth` levels, values go whole. */
export function diffState(previous, next, depth = 4) {
  if (previous === next) return undefined;
  if (depth <= 0) return { v: next };
  if (Array.isArray(previous) && Array.isArray(next)) {
    const changed = {};
    let count = 0;
    for (let index = 0; index < next.length; index++) {
      if (index < previous.length && previous[index] === next[index]) continue;
      changed[index] = index < previous.length ? diffState(previous[index], next[index], depth - 1) : { v: next[index] };
      count++;
    }
    // Most items changed (a list filtered or reordered): the array itself is shorter to send.
    if (count > next.length / 2 && count > 8) return { v: next };
    return { a: next.length, s: changed };
  }
  if (plain(previous) && plain(next)) {
    const changed = {};
    const removed = [];
    for (const key of Object.keys(next)) {
      if (!Object.hasOwn(previous, key)) changed[key] = { v: next[key] };
      else if (previous[key] !== next[key]) changed[key] = diffState(previous[key], next[key], depth - 1);
    }
    for (const key of Object.keys(previous)) if (!Object.hasOwn(next, key)) removed.push(key);
    return removed.length ? { o: changed, d: removed } : { o: changed };
  }
  return { v: next };
}

/** `previous` with `patch` applied; the parts the patch doesn't touch are the same objects as in `previous`. */
export function applyStatePatch(previous, patch) {
  if (patch === undefined) return previous;
  if (Object.hasOwn(patch, "v")) return patch.v;
  if (Object.hasOwn(patch, "a")) {
    const base = Array.isArray(previous) ? previous : [];
    const next = base.slice(0, patch.a);
    next.length = patch.a;
    for (const [index, item] of Object.entries(patch.s ?? {})) next[Number(index)] = applyStatePatch(base[Number(index)], item);
    return next;
  }
  const next = { ...(plain(previous) ? previous : {}) };
  for (const [key, item] of Object.entries(patch.o ?? {})) next[key] = applyStatePatch(next[key], item);
  for (const key of patch.d ?? []) delete next[key];
  return next;
}
