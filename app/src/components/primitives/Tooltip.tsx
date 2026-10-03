import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { shortcutModifier, useShortcutHints } from "../../lib/shortcut-hints";

const SHOW_DELAY = 400;

export default function Tooltip({
  label,
  shortcut,
  align = "start",
  side = "top",
  wrap = false,
  className = "",
  children,
}: {
  label: string;
  shortcut?: string;
  align?: "start" | "end";
  /** Which side of the trigger the tooltip opens on; "bottom" for triggers at the window's top edge. */
  side?: "top" | "bottom";
  /** Lets a long label break onto more lines instead of running past the window. */
  wrap?: boolean;
  /** Extra classes for the trigger wrapper, e.g. to position it. */
  className?: string;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const showHints = useShortcutHints();
  const [hintRect, setHintRect] = useState<DOMRect | null>(null);
  const hint = shortcut?.replace("⌘", shortcutModifier);
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const modal = document.querySelector('dialog[open], [aria-modal="true"]');
    const bounds = trigger?.getBoundingClientRect();
    setHintRect(showHints && shortcut && bounds?.width && bounds.height && (!modal || modal.contains(trigger)) ? bounds : null);
  }, [showHints, shortcut]);

  const clear = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const show = (delay: number) => {
    clear();
    timerRef.current = window.setTimeout(() => setRect(triggerRef.current?.getBoundingClientRect() ?? null), delay);
  };
  const hide = () => {
    clear();
    setRect(null);
  };

  useEffect(() => clear, []);

  return (
    <span
      ref={triggerRef}
      className={`inline-flex ${className}`}
      onPointerEnter={() => show(SHOW_DELAY)}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(event) => { if (event.target.matches(":focus-visible")) show(0); }}
      onBlur={hide}
    >
      {children}
      {rect && createPortal(
        <span
          role="tooltip"
          className={`pointer-events-none fixed z-[60] flex items-center gap-2 ${wrap ? "max-w-[280px] whitespace-normal leading-snug" : "whitespace-nowrap"} rounded-[8px] bg-ink px-2 py-1 text-[12px] font-medium text-surface shadow-overlay`}
          style={{
            ...(side === "top" ? { top: rect.top - 6 } : { top: rect.bottom + 6 }),
            ...(align === "start" ? { left: rect.left } : { right: window.innerWidth - rect.right }),
            transform: side === "top" ? "translateY(-100%)" : undefined,
            animation: "fade-in 120ms ease-out both",
          }}
        >
          {label}
          {hint && <span data-shortcut-hint className="opacity-60">{hint}</span>}
        </span>,
        document.body,
      )}
      {hintRect && !rect && createPortal(
        <kbd aria-hidden="true" data-shortcut-hint className="pointer-events-none fixed z-[70] rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink shadow-raised"
          style={{ top: hintRect.top + hintRect.height / 2, left: hintRect.width > 80 ? hintRect.right - 22 : hintRect.left + hintRect.width / 2, transform: "translate(-50%, -50%)" }}>
          {hint}
        </kbd>, document.body,
      )}
    </span>
  );
}
