import { useEffect, useState, type FocusEvent } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import type { ProviderUsage } from "../../model";
import { useSettings } from "../../lib/settings";
import { PROVIDER_NAMES, formatPercent, formatResetsIn, formatUpdatedAgo, shownPercent, shownSuffix } from "./format";
import { ProviderMark } from "./ProviderMark";
import { UsageBar } from "./UsageBar";

export const USAGE_CARD_WIDTH = 288;

type UsageCardProps = {
  id: string;
  usage: ProviderUsage;
  loading: boolean;
  position: { left: number; bottom: number };
  onRefresh: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onBlur: (event: FocusEvent<HTMLDivElement>) => void;
};

export function UsageCard({ id, usage, loading, position, onRefresh, onPointerEnter, onPointerLeave, onBlur }: UsageCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const name = PROVIDER_NAMES[usage.provider];
  const account = usage.account?.email || usage.account?.label;
  const { usageDisplay } = useSettings();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setNow(Date.now());
  }, [usage.updatedAt]);

  return createPortal(
    <div
      id={id}
      role="dialog"
      aria-label={`${name} usage`}
      data-usage-card
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onBlur={onBlur}
      className="fixed z-50 rounded-[14px] bg-surface text-ink shadow-overlay"
      style={{
        width: USAGE_CARD_WIDTH,
        left: position.left,
        bottom: position.bottom,
        animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
        transformOrigin: "bottom left",
      }}
    >
      <div className="flex items-start gap-2 px-4 pb-3 pt-3.5">
        <span className="mt-0.5 flex text-ink">
          <ProviderMark provider={usage.provider} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-[14px] font-semibold leading-5" data-usage-account>
            {account || "Account unavailable"}
          </p>
          <p className="text-[12px] text-ink-3">{formatUpdatedAgo(usage.updatedAt, now)}</p>
        </div>
        <button
          type="button"
          aria-label={`Refresh ${name} usage`}
          onClick={() => {
            if (!loading) onRefresh();
          }}
          // aria-disabled, not disabled: a disabled button drops focus to <body>, which would close the card.
          aria-disabled={loading}
          className="flex size-7 items-center justify-center rounded-control text-ink-3 transition-[background-color,color] duration-150 hover:bg-hover-2 hover:text-ink aria-disabled:cursor-default"
        >
          <span className="flex" style={loading ? { animation: "spin 800ms linear infinite" } : undefined}>
            <HugeiconsIcon icon={RefreshIcon} size={15} strokeWidth={1.8} color="currentColor" />
          </span>
        </button>
      </div>

      {usage.message && <p className="mx-4 mb-3 rounded-control bg-field px-2.5 py-1.5 text-[12px] leading-[1.45] text-ink">{usage.message}</p>}

      {usage.windows.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-line px-4 pb-4 pt-3">
          {usage.windows.map((item) => (
            <div key={item.id} className="flex flex-col gap-1.5">
              <p className="text-[13px] font-medium">{item.label}</p>
              <UsageBar usedPercent={item.usedPercent} display={usageDisplay} className="h-1.5 w-full" />
              <div className="flex items-center justify-between text-[12px] tabular-nums text-ink-2">
                <span>
                  {formatPercent(shownPercent(item.usedPercent, usageDisplay))} {shownSuffix(usageDisplay)}
                </span>
                <span>{formatResetsIn(item.resetsAt, now)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Only when the account has some: a "0 left" row would read as something used up. */}
      {usage.bankedResets ? (
        <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[12px] tabular-nums">
          <span className="text-ink-2">Banked resets</span>
          <span className="text-ink">{usage.bankedResets} left</span>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
