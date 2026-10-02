import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ThemedToken } from "shiki/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import type { DiffFileEntry } from "../../electron";
import { resolveCodeLanguage } from "../../lib/code-languages";
import { splitRows, wordChanges, type Range } from "../../lib/diff-layout";
import { parsePatch, type DiffHunk, type DiffLine } from "../../lib/diff-parse";
import { highlight, isLanguageReady, loadLanguage } from "../markdown/highlighter";
import { Counts, StatusBox } from "./ChangesPanel";
import { isLarge, type PatchState } from "./useDiffFiles";

export type DiffLayout = "unified" | "split";

type Decorated = { tokens?: ThemedToken[]; words?: Range[] };

function extensionOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : name;
}

/** Syntax tokens and changed-word ranges for every line of a file's hunks. */
function decorate(hunks: DiffHunk[], path: string, languageReady: boolean): Map<DiffLine, Decorated> {
  const result = new Map<DiffLine, Decorated>();
  const language = resolveCodeLanguage(extensionOf(path));
  for (const hunk of hunks) {
    if (language && languageReady) {
      // Each side is highlighted as the text it would be in its own file, so strings and comments tokenize across lines.
      for (const side of ["remove", "add"] as const) {
        const lines = hunk.lines.filter((line) => line.kind === "context" || line.kind === side);
        const tokens = highlight(lines.map((line) => line.text).join("\n"), language);
        if (tokens) lines.forEach((line, index) => result.set(line, { ...result.get(line), tokens: tokens[index] }));
      }
    }
    for (const { left, right } of splitRows(hunk)) {
      if (left?.kind !== "remove" || right?.kind !== "add") continue;
      const words = wordChanges(left.text, right.text);
      result.set(left, { ...result.get(left), words: words.old });
      result.set(right, { ...result.get(right), words: words.new });
    }
  }
  return result;
}

function Content({ line, decoration }: { line: DiffLine; decoration?: Decorated }) {
  const words = decoration?.words ?? [];
  const wordClass = line.kind === "add" ? "bg-[var(--diff-add-word)]" : "bg-[var(--diff-remove-word)]";
  const pieces: ReactNode[] = [];
  let offset = 0;
  const segments = decoration?.tokens?.length ? decoration.tokens : [{ content: line.text, htmlStyle: undefined } as ThemedToken];
  for (const token of segments) {
    const start = offset;
    const end = offset + token.content.length;
    offset = end;
    // Split the token at word-range edges so the highlight sits behind the syntax colour.
    const cuts = [start, ...words.flatMap(([from, to]) => [from, to]).filter((at) => at > start && at < end), end];
    for (let i = 0; i < cuts.length - 1; i++) {
      const from = cuts[i];
      const to = cuts[i + 1];
      if (from === to) continue;
      const changed = words.some(([a, b]) => from >= a && to <= b);
      pieces.push(
        <span key={`${start}-${from}`} className={`${decoration?.tokens ? "code-token" : ""} ${changed ? wordClass : ""}`} style={token.htmlStyle as CSSProperties | undefined}>
          {token.content.slice(from - start, to - start)}
        </span>,
      );
    }
  }
  return <>{pieces.length ? pieces : "​"}</>;
}

const TINT = { add: "bg-[var(--diff-add)]", remove: "bg-[var(--diff-remove)]", context: "" } as const;
const MARKER = { add: "+", remove: "−", context: "" } as const;
const MARKER_COLOR = { add: "text-green", remove: "text-red", context: "" } as const;

function Gutter({ value }: { value?: number }) {
  return <span className="w-11 shrink-0 select-none pr-2 text-right text-ink-3 tabular-nums">{value}</span>;
}

function HunkHeader({ hunk }: { hunk: DiffHunk }) {
  return <div data-diff-hunk className="h-6 select-none truncate bg-inset px-3 text-[11px] leading-6 text-ink-3">{hunk.header}</div>;
}

function Text({ line, decoration, wrap }: { line: DiffLine; decoration?: Decorated; wrap: boolean }) {
  return <span className={`min-w-0 flex-1 pr-3 ${wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}><Content line={line} decoration={decoration} /></span>;
}

function Unified({ hunks, decorations, wrap }: { hunks: DiffHunk[]; decorations: Map<DiffLine, Decorated>; wrap: boolean }) {
  return (
    <div className="w-max min-w-full">
      {hunks.map((hunk, index) => (
        <Fragment key={index}>
          <HunkHeader hunk={hunk} />
          {hunk.lines.map((line, lineIndex) => (
            <div key={lineIndex} data-diff-row={line.kind} className={`flex min-h-5 ${TINT[line.kind]}`}>
              <Gutter value={line.oldNumber} />
              <Gutter value={line.newNumber} />
              <span className={`w-4 shrink-0 select-none text-center ${MARKER_COLOR[line.kind]}`}>{MARKER[line.kind]}</span>
              <Text line={line} decoration={decorations.get(line)} wrap={wrap} />
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function Half({ line, side, decoration }: { line?: DiffLine; side: "left" | "right"; decoration?: Decorated }) {
  const border = side === "left" ? "border-r border-line" : "";
  if (!line) return <div data-diff-filler className={`min-h-5 bg-inset ${border}`} />;
  return (
    <div data-diff-cell={side} className={`flex min-h-5 min-w-0 ${TINT[line.kind]} ${border}`}>
      <Gutter value={side === "left" ? line.oldNumber : line.newNumber} />
      <span className={`w-4 shrink-0 select-none text-center ${MARKER_COLOR[line.kind]}`}>{MARKER[line.kind]}</span>
      <Text line={line} decoration={decoration} wrap />
    </div>
  );
}

function Split({ hunks, decorations }: { hunks: DiffHunk[]; decorations: Map<DiffLine, Decorated> }) {
  return (
    // Two equal columns that always wrap: sized to the longest line, a narrow window pushed the new side off screen.
    <div className="grid w-full grid-cols-2">
      {hunks.map((hunk, index) => (
        <Fragment key={index}>
          <div className="col-span-2"><HunkHeader hunk={hunk} /></div>
          {splitRows(hunk).map((row, rowIndex) => (
            <Fragment key={rowIndex}>
              <Half line={row.left} side="left" decoration={row.left && decorations.get(row.left)} />
              <Half line={row.right} side="right" decoration={row.right && decorations.get(row.right)} />
            </Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function Message({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="flex items-center justify-center gap-3 px-4 py-6 font-sans text-[12px] text-ink-3">{children}{action}</div>;
}

export const DiffFile = memo(function DiffFile({ file, patch, layout, wrap, collapsed, onToggle, onVisible, onShowLarge }: {
  file: DiffFileEntry;
  patch: PatchState | undefined;
  layout: DiffLayout;
  wrap: boolean;
  collapsed: boolean;
  onToggle: (path: string) => void;
  onVisible: (file: DiffFileEntry) => void;
  onShowLarge: (file: DiffFileEntry) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [, setLoadedCount] = useState(0);
  const language = resolveCodeLanguage(extensionOf(file.path));
  const languageReady = language !== undefined && isLanguageReady(language);
  const ready = patch?.status === "ready" ? patch : undefined;
  const hunks = useMemo(() => (ready ? parsePatch(ready.patch) : []), [ready]);

  // Files load when they come near the viewport, not all at once on open. Staying near while the
  // patch goes missing (the mode changed under a mounted file) loads it again.
  const [near, setNear] = useState(false);
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => setNear(entries[entries.length - 1].isIntersecting), { rootMargin: "800px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (near && !patch) onVisibleRef.current(file);
  }, [near, patch, file]);

  useEffect(() => {
    if (!language || languageReady || hunks.length === 0) return;
    let live = true;
    loadLanguage(language).then(() => { if (live) setLoadedCount((count) => count + 1); }, () => {});
    return () => { live = false; };
  }, [language, languageReady, hunks.length]);

  const decorations = useMemo(() => decorate(hunks, file.path, languageReady), [hunks, file.path, languageReady]);
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const folder = slash >= 0 ? file.path.slice(0, slash) : "";

  let body: ReactNode;
  if (file.binary) body = <Message>Binary file</Message>;
  else if (!patch && isLarge(file)) body = <Message action={<button type="button" data-diff-show onClick={() => onShowLarge(file)} className="rounded-control border border-line px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-hover">Show diff</button>}>This diff is large</Message>;
  else if (!patch || patch.status === "loading") body = <Message>Loading…</Message>;
  else if (patch.status === "error") body = <Message>{patch.message}</Message>;
  else if (patch.binary) body = <Message>Binary file</Message>;
  else if (patch.tooLarge) body = <Message>This file's diff is too large to show</Message>;
  else if (hunks.length === 0) body = <Message>{file.status === "renamed" ? `Renamed from ${file.oldPath}` : "No content changes"}</Message>;
  else body = layout === "split" ? <Split hunks={hunks} decorations={decorations} /> : <Unified hunks={hunks} decorations={decorations} wrap={wrap} />;

  return (
    <section ref={ref} data-diff-file={file.path} className="rounded-card border border-line bg-surface">
      {/* Pinned, the header is the card's top: it draws its own border over the card's (-1px), and the page colour
          fills behind its rounded corners so rows scrolling underneath don't show through them. The fill sits in a
          wrapper, under the header; inside the header it would paint over the header's own background and border. */}
      <div className={`sticky top-0 z-10 -mx-px -mt-px ${collapsed ? "-mb-px" : ""}`}>
        <span aria-hidden className="absolute inset-x-0 top-0 h-[var(--radius-card)] bg-page" />
        <header className={`relative flex h-9 items-center gap-2 border border-line bg-surface px-3 text-[12.5px] ${collapsed ? "rounded-card" : "rounded-t-card"}`}>
          <button type="button" aria-label={collapsed ? "Expand file" : "Collapse file"} aria-expanded={!collapsed} data-diff-collapse onClick={() => onToggle(file.path)} className="-ml-1 flex size-6 shrink-0 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink">
            <HugeiconsIcon icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon} size={14} strokeWidth={1.8} color="currentColor" />
          </button>
          <span className="shrink-0 font-medium text-ink">{name}</span>
          {folder && <span className="min-w-0 flex-1 truncate text-ink-3" dir="rtl"><bdi>{folder}</bdi></span>}
          {!folder && <span className="flex-1" />}
          {!file.binary && <Counts added={file.added} removed={file.removed} />}
          <StatusBox status={file.status} />
        </header>
      </div>
      {!collapsed && <div className="overflow-x-auto rounded-b-card font-mono text-[12px] leading-5" data-diff-body>{body}</div>}
    </section>
  );
});
