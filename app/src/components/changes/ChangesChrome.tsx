import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft02Icon, SidebarRight01Icon } from "@hugeicons/core-free-icons";
import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Tooltip from "../primitives/Tooltip";
import { EASE_OUT } from "../../lib/ease";

/**
 * Over the open diff: Back to the chat on the left, the diff's toolbar on the right. It comes and goes with the diff.
 * It sits inside the window's drag strip (z-50) and paints above it, so its buttons get the clicks. Chromium builds the
 * drag region from every element with an app-region in tree order (drag adds, no-drag subtracts), so only the button
 * groups opt out: the empty stretch between them keeps dragging the window.
 */
// The traffic lights and the sidebar toggle (12px + 76px + 32px) end here; with the sidebar collapsed, <main> starts
// left of it, so Back moves right to stay clear.
const WINDOW_CONTROLS_END = 128;

/** Left inset that keeps the bar clear of the window controls, from where <main> (the bar's offset parent) starts. */
function useControlsClearance(open: boolean) {
  const bar = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    const host = bar.current?.offsetParent;
    if (!open || !(host instanceof HTMLElement)) return;
    const update = () => setInset(Math.max(0, WINDOW_CONTROLS_END - host.getBoundingClientRect().left - 12));
    update();
    // Collapsing the sidebar resizes <main>, which is what moves its left edge.
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, [open]);
  return { bar, inset };
}

/** `send` is the diff comments waiting to go to the chat; the button is there while any can. */
export function DiffBar({ open, onBack, send, trailing }: { open: boolean; onBack: () => void; send?: { count: number; onSend: () => void }; trailing?: React.ReactNode }) {
  const reduced = useReducedMotion();
  const { bar, inset } = useControlsClearance(open);
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div ref={bar} key="diff-bar" data-diff-bar style={{ paddingLeft: inset }} className="absolute inset-x-3 top-[14px] z-[55] flex h-8 items-center justify-between"
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
          transition={reduced ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT }}>
          <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
            <button type="button" data-diff-back onClick={onBack}
              className="flex h-8 items-center gap-1.5 rounded-control bg-surface pr-3 pl-2 text-[12.5px] font-medium text-ink-2 shadow-card transition-colors hover:text-ink">
              <HugeiconsIcon icon={ArrowLeft02Icon} size={15} strokeWidth={1.8} color="currentColor" />
              Back
            </button>
            <AnimatePresence initial={false}>
              {send && send.count > 0 && (
                <motion.button key="send" type="button" data-diff-send onClick={send.onSend}
                  initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                  transition={reduced ? { duration: 0 } : { duration: 0.16, ease: EASE_OUT }}
                  className="h-8 rounded-control bg-ink px-3 text-[12.5px] font-medium text-surface shadow-card transition-opacity hover:opacity-85">
                  {send.count === 1 ? "Send 1 comment" : `Send ${send.count} comments`}
                </motion.button>
              )}
            </AnimatePresence>
          </div>
          {trailing}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Top-right window button; sits inside the drag strip, so it opts out of dragging. */
export function ChangesToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    // Same line as the traffic lights and the sidebar toggle (top 14px, 32px tall).
    <div className="fixed top-[14px] right-3 z-[60] [-webkit-app-region:no-drag]">
      <Tooltip label={open ? "Hide changes" : "Show changes"} shortcut="⌘⇧D" side="bottom" align="end">
        <button type="button" aria-label="Toggle changes panel" aria-pressed={open} data-changes-toggle onClick={onToggle}
          className={`flex size-8 items-center justify-center rounded-control transition-colors hover:bg-hover hover:text-ink ${open ? "bg-hover text-ink" : "text-ink-3"}`}>
          <HugeiconsIcon icon={SidebarRight01Icon} size={18} strokeWidth={1.8} color="currentColor" />
        </button>
      </Tooltip>
    </div>
  );
}
