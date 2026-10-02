import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";

/* Popover picker shared by the model, permission, and branch selectors and by Select: title,
 * optional header slot (e.g. provider tabs), optional search, and a scrolling list. */
export function PickerPanel({
  title,
  query,
  onQueryChange,
  placeholder,
  emptyLabel,
  isEmpty,
  header,
  className = "",
  style,
  onKeyDown,
  children,
}: {
  title: string;
  query?: string;
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  isEmpty?: boolean;
  header?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  children: ReactNode;
}) {
  return (
    <div className={`z-20 flex flex-col rounded-[10px] border border-line bg-surface p-1.5 shadow-raised ${className}`} style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", ...style }}>
      <div className="shrink-0 px-2 pb-2 pt-1"><strong className="text-sm text-ink">{title}</strong></div>
      {header}
      {onQueryChange && (
        <label className="my-2 flex shrink-0 items-center gap-2 rounded-control border border-line px-2.5 py-2 text-ink-3">
          <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={1.8} color="currentColor" />
          <input className="w-full border-0 bg-transparent text-xs text-ink outline-none placeholder:text-ink-3" value={query} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} autoFocus />
        </label>
      )}
      <div className="grid max-h-64 min-h-0 grid-cols-1 content-start gap-0.5 overflow-y-auto">
        {children}
        {isEmpty && <div className="px-2 py-5 text-center text-xs text-ink-3">{emptyLabel}</div>}
      </div>
    </div>
  );
}

export function PickerRow({ icon, label, description, selected, onClick, option = false }: { icon?: ReactNode; label: string; description?: string; selected: boolean; onClick: () => void; option?: boolean }) {
  return (
    <button type="button" data-picker-row role={option ? "option" : undefined} aria-selected={option ? selected : undefined} onClick={onClick} className={`relative z-10 flex w-full items-center gap-2 rounded-control border px-2 py-1.5 text-left transition-colors ${selected ? "border-line-strong bg-hover" : "border-transparent hover:border-line hover:bg-inset"}`}>
      {icon}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <strong className="shrink-0 text-xs font-medium text-ink">{label}</strong>
        {description && <span className="truncate text-[10px] text-ink-3">{description}</span>}
      </span>
      {selected && <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={1.8} color="currentColor" />}
    </button>
  );
}
