import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Layout2ColumnIcon, LayoutTopIcon, RefreshIcon, TextWrapIcon } from "@hugeicons/core-free-icons";
import Tooltip from "../primitives/Tooltip";
import { EASE_OUT, SPRING_LAYOUT } from "../../lib/ease";
import { useScrollFade } from "../../lib/use-scroll-fade";
import type { DiffFileEntry } from "../../electron";
import { DiffFile, type DiffLayout } from "./DiffFile";
import type { Changes } from "./useChanges";

const LAYOUT_KEY = "milagre:diff-layout";
const WRAP_KEY = "milagre:diff-wrap";

/** Unified/Split and Wrap, remembered across launches. */
export function useDiffPreferences() {
  const [layout, setLayoutState] = useState<DiffLayout>(() => (localStorage.getItem(LAYOUT_KEY) === "split" ? "split" : "unified"));
  const [wrap, setWrapState] = useState(() => localStorage.getItem(WRAP_KEY) === "on");
  const setLayout = useCallback((next: DiffLayout) => { localStorage.setItem(LAYOUT_KEY, next); setLayoutState(next); }, []);
  const setWrap = useCallback((next: boolean) => { localStorage.setItem(WRAP_KEY, next ? "on" : "off"); setWrapState(next); }, []);
  return { layout, setLayout, wrap, setWrap };
}

function ToolButton({ label, active, disabled, onClick, children, ...rest }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode } & Record<`data-${string}`, string | undefined>) {
  return (
    <Tooltip label={label} side="bottom" align="end">
      <button type="button" aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick} {...rest}
        className={`flex size-7 items-center justify-center rounded-chip transition-colors enabled:hover:bg-hover enabled:hover:text-ink disabled:opacity-40 ${active ? "bg-hover text-ink" : "text-ink-3"}`}>
        {children}
      </button>
    </Tooltip>
  );
}

export function DiffToolbar({ changes, prefs }: { changes: Changes; prefs: ReturnType<typeof useDiffPreferences> }) {
  const icon = (glyph: typeof RefreshIcon) => <HugeiconsIcon icon={glyph} size={15} strokeWidth={1.8} color="currentColor" />;
  return (
    <div data-diff-toolbar className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
      <ToolButton label="Unified" active={prefs.layout === "unified"} onClick={() => prefs.setLayout("unified")} data-diff-layout="unified">{icon(LayoutTopIcon)}</ToolButton>
      <ToolButton label="Split" active={prefs.layout === "split"} onClick={() => prefs.setLayout("split")} data-diff-layout="split">{icon(Layout2ColumnIcon)}</ToolButton>
      <ToolButton label={prefs.layout === "split" ? "Split view always wraps" : "Wrap lines"} active={prefs.layout === "split" || prefs.wrap} disabled={prefs.layout === "split"} onClick={() => prefs.setWrap(!prefs.wrap)} data-diff-wrap="">{icon(TextWrapIcon)}</ToolButton>
      <ToolButton label="Refresh" onClick={() => void changes.refresh()} data-diff-refresh-all="">{icon(RefreshIcon)}</ToolButton>
    </div>
  );
}

export function DiffView({ changes, prefs }: { changes: Changes; prefs: ReturnType<typeof useDiffPreferences> }) {
  const reduced = useReducedMotion();
  const { list, load, patchFor, scrollTarget } = changes;
  const scroller = useRef<HTMLDivElement>(null);
  useScrollFade(scroller);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const files = list.state === "ready" && list.isRepo ? list.files : [];

  useEffect(() => {
    if (!scrollTarget) return;
    const node = [...(scroller.current?.querySelectorAll<HTMLElement>("[data-diff-file]") ?? [])].find((el) => el.dataset.diffFile === scrollTarget.path);
    node?.scrollIntoView({ block: "start" });
  }, [scrollTarget]);

  // Stable, so a file only re-renders when its own props change.
  const toggle = useCallback((path: string) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (!next.delete(path)) next.add(path);
    return next;
  }), []);
  const showLarge = useCallback((file: DiffFileEntry) => load(file, true), [load]);

  return (
    // Slides in from the panel's side like the panel itself, and back out the same way; the chat stays hidden until it's gone.
    <motion.div className="relative min-h-0 flex-1"
      initial={{ opacity: 0, x: 32 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 32 }}
      transition={reduced ? { duration: 0 } : { x: SPRING_LAYOUT, opacity: { duration: 0.2, ease: EASE_OUT }}}>
      {/* Starts below the Back bar; only the bottom edge fades, while there's more below. */}
      <div ref={scroller} data-diff-view className="diff-scroll scroll-fade mt-[52px] h-[calc(100%-52px)] overflow-y-auto px-3 pb-4">
        {files.length === 0 && <p className="py-16 text-center text-[13px] text-ink-3">{list.state === "ready" ? "No changes to show." : "Loading changes…"}</p>}
        <div className="flex flex-col gap-3">
          {files.map((file) => (
            <DiffFile key={file.path} file={file} patch={patchFor(file)} layout={prefs.layout} wrap={prefs.wrap}
              collapsed={collapsed.has(file.path)} onToggle={toggle}
              onVisible={load} onShowLarge={showLarge} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Whether the diff occupies the main column: while it shows and while it slides out, so the chat only comes back
 * once the diff has left instead of sharing the column with it.
 */
export function useDiffPresence(showing: boolean) {
  const [leaving, setLeaving] = useState(false);
  const [wasShowing, setWasShowing] = useState(showing);
  if (wasShowing !== showing) {
    setWasShowing(showing);
    setLeaving(!showing);
  }
  return { occupied: showing || leaving, onExitComplete: () => setLeaving(false) };
}
