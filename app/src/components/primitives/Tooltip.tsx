import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const SHOW_DELAY = 400;

export default function Tooltip({
  label,
  shortcut,
  align = "start",
  side = "top",
  className = "",
  children,
}: {
  label: string;
  shortcut?: string;
  align?: "start" | "end";
  /** Which side of the trigger the tooltip opens on; "bottom" for triggers at the window's top edge. */
  side?: "top" | "bottom";
  /** Extra classes for the trigger wrapper, e.g. to position it. */
  className?: string;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

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
          className="pointer-events-none fixed z-[60] flex items-center gap-2 whitespace-nowrap rounded-[8px] bg-ink px-2 py-1 text-[12px] font-medium text-surface shadow-overlay"
          style={{
            ...(side === "top" ? { top: rect.top - 6 } : { top: rect.bottom + 6 }),
            ...(align === "start" ? { left: rect.left } : { right: window.innerWidth - rect.right }),
            transform: side === "top" ? "translateY(-100%)" : undefined,
            animation: "fade-in 120ms ease-out both",
          }}
        >
          {label}
          {shortcut && <span className="opacity-60">{shortcut}</span>}
        </span>,
        document.body,
      )}
    </span>
  );
}
