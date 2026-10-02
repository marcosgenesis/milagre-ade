import type { ReactNode } from "react";

/** A dismissable notice above the composer: a line of text, or a list. */
export function ComposerNotice({ children, onDismiss, ...data }: { children: ReactNode; onDismiss?: () => void } & { [key: `data-${string}`]: string | boolean | undefined }) {
  return (
    <div
      role="status"
      data-notice
      {...data}
      className="mb-2 flex w-full items-center justify-between gap-3 rounded-[12px] border border-line bg-surface px-4 py-2.5 text-[13px] leading-snug text-ink shadow-overlay"
      style={{ animation: "fade-up 250ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <div className="min-w-0 flex-1 break-words">{children}</div>
      <button
        type="button"
        data-notice-dismiss
        onClick={onDismiss}
        className="shrink-0 text-xs font-medium text-ink-3 transition-colors hover:text-ink"
      >
        Dismiss
      </button>
    </div>
  );
}
