import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { PickerPanel, PickerRow } from "./Picker";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  // Consecutive options with the same group sit under one heading.
  group?: string;
};

const GAP = 6;
const INSET = 12;
const MIN_ROOM = 160;

/* The app's select: a trigger button that opens the shared picker panel.
 * A native select element opens macOS's own menu, so every choice goes through this. */
export function Select<T extends string>({
  label,
  title = label,
  value,
  options,
  onChange,
  width = 240,
}: {
  label: string;
  title?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number }>({ left: 0, maxHeight: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  function place() {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const left = Math.max(INSET, Math.min(trigger.right - width, window.innerWidth - width - INSET));
    const roomBelow = window.innerHeight - trigger.bottom - GAP - INSET;
    const roomAbove = trigger.top - GAP - INSET;
    setPosition(roomBelow >= MIN_ROOM || roomBelow >= roomAbove
      ? { left, top: trigger.bottom + GAP, maxHeight: roomBelow }
      : { left, bottom: window.innerHeight - trigger.top + GAP, maxHeight: roomAbove });
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function choose(next: T) {
    if (next !== value) onChange(next);
    close();
  }

  useLayoutEffect(() => {
    if (!open) return;
    const rows = panelRef.current?.querySelectorAll<HTMLElement>("[data-picker-row]");
    const index = Math.max(0, options.findIndex((option) => option.value === value));
    rows?.[index]?.focus({ preventScroll: false });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const dismiss = () => close(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [open]);

  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
    }
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    place();
    setOpen(true);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { if (open) { close(false); return; } place(); setOpen(true); }}
        onKeyDown={onTriggerKeyDown}
        className={`flex h-8 items-center gap-2 rounded-control border border-line pr-2.5 pl-3 text-[13px] font-medium text-ink transition-colors hover:bg-hover ${open ? "bg-hover" : "bg-surface"}`}
      >
        {selected?.icon}
        <span className="truncate">{selected?.label ?? ""}</span>
        <span className="text-ink-3"><HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={1.8} color="currentColor" /></span>
      </button>
      {open && createPortal(
        <div ref={panelRef} role="listbox" aria-label={label} onKeyDown={onPanelKeyDown} className="fixed z-50" style={{ left: position.left, top: position.top, bottom: position.bottom, width }}>
          <PickerPanel title={title} style={{ maxHeight: position.maxHeight, transformOrigin: `${position.top === undefined ? "bottom" : "top"} right` }}>
            {options.map((option, index) => (
              <Fragment key={option.value}>
                {option.group && option.group !== options[index - 1]?.group && (
                  <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">{option.group}</div>
                )}
                <PickerRow icon={option.icon} label={option.label} description={option.description} selected={option.value === value} onClick={() => choose(option.value)} option />
              </Fragment>
            ))}
          </PickerPanel>
        </div>,
        document.body,
      )}
    </>
  );
}
