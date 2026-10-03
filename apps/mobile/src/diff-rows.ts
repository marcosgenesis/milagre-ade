import { parsePatch, type DiffLine } from '@milagre/shared/diff-parse';
import { splitRows, wordChanges, type Range } from '@milagre/shared/diff-layout';

export type DiffRow = { type: 'hunk'; key: string; header: string } | { type: 'line'; key: string; line: DiffLine; words: Range[] };

/** A file's patch as flat list rows: each hunk header, then its lines with the words that changed against their pair. */
export function diffRows(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  parsePatch(patch).forEach((hunk, hunkIndex) => {
    const words = new Map<DiffLine, Range[]>();
    for (const { left, right } of splitRows(hunk)) {
      if (left?.kind !== 'remove' || right?.kind !== 'add') continue;
      const changes = wordChanges(left.text, right.text);
      words.set(left, changes.old);
      words.set(right, changes.new);
    }
    rows.push({ type: 'hunk', key: `h${hunkIndex}`, header: hunk.header });
    hunk.lines.forEach((line, lineIndex) => rows.push({ type: 'line', key: `${hunkIndex}:${lineIndex}`, line, words: words.get(line) ?? [] }));
  });
  return rows;
}

/** The line's text cut at the changed-word edges, so the changed pieces can carry their own highlight. */
export function wordSegments(text: string, words: Range[]): { text: string; changed: boolean }[] {
  const segments: { text: string; changed: boolean }[] = [];
  let at = 0;
  for (const [from, to] of words) {
    if (from > at) segments.push({ text: text.slice(at, from), changed: false });
    if (to > from) segments.push({ text: text.slice(from, to), changed: true });
    at = Math.max(at, to);
  }
  if (at < text.length || !segments.length) segments.push({ text: text.slice(at), changed: false });
  return segments;
}

/** Desktop's rule: a file with more changed lines than this waits for "Show diff". */
export const LARGE_DIFF_LINES = 3000;
