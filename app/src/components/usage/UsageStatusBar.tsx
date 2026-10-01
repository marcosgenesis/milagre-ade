import { useEffect, useRef, useState } from "react";
import type { ModelProvider } from "../../model";
import { formatPercent, usageLabel, visibleProviders } from "./format";
import { ProviderMark } from "./ProviderMark";
import { UsageBar } from "./UsageBar";
import { USAGE_CARD_WIDTH, UsageCard } from "./UsageCard";
import type { UsageState } from "./useUsage";

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 150;
const CARD_GAP = 8;
const VIEWPORT_MARGIN = 12;
const STALE_AFTER_MS = 60_000;

type OpenCard = { provider: ModelProvider; left: number; bottom: number };

export function UsageStatusBar({ usage }: { usage: UsageState }) {
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const segments = useRef(new Map<ModelProvider, HTMLButtonElement>());
  const restoringFocus = useRef(false);
  const providers = usage.snapshot ? visibleProviders(usage.snapshot) : [];
  const openUsage = openCard ? providers.find((item) => item.provider === openCard.provider) : undefined;

  function clearTimers() {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }

  function show(provider: ModelProvider) {
    clearTimers();
    const rect = segments.current.get(provider)?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.right - USAGE_CARD_WIDTH, window.innerWidth - USAGE_CARD_WIDTH - VIEWPORT_MARGIN));
    setOpenCard({ provider, left, bottom: window.innerHeight - rect.top + CARD_GAP });
    usage.refreshIfStale(STALE_AFTER_MS);
  }

  function scheduleShow(provider: ModelProvider) {
    clearTimers();
    openTimer.current = window.setTimeout(() => show(provider), OPEN_DELAY_MS);
  }

  function scheduleHide() {
    clearTimers();
    closeTimer.current = window.setTimeout(() => setOpenCard(null), CLOSE_DELAY_MS);
  }

  function keepOpen() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  useEffect(() => clearTimers, []);

  useEffect(() => {
    if (!openCard) return;
    const close = () => setOpenCard(null);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [openCard]);

  useEffect(() => {
    if (!openCard || !openUsage) return;
    const segment = segments.current.get(openCard.provider);
    // Capture on window runs before App's window-level Escape handler, which cancels
    // the running agent, so Escape closes the card wherever focus is and goes no further.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const focusInCard = Boolean((document.activeElement as Element | null)?.closest("[data-usage-card]"));
      clearTimers();
      setOpenCard(null);
      if (focusInCard && segment) {
        restoringFocus.current = true;
        segment.focus();
        restoringFocus.current = false;
      }
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [openCard, openUsage]);

  if (providers.length === 0) return null;

  return (
    <div className="flex h-7 shrink-0 items-center justify-end gap-1 px-2 text-[12px] tabular-nums text-ink-2">
      {providers.map((item) => {
        const expanded = openCard?.provider === item.provider && Boolean(openUsage);
        return (
          <button
            key={item.provider}
            ref={(node) => {
              if (node) segments.current.set(item.provider, node);
              else segments.current.delete(item.provider);
            }}
            type="button"
            aria-label={usageLabel(item)}
            aria-expanded={expanded}
            aria-controls={expanded ? `usage-card-${item.provider}` : undefined}
            onPointerEnter={() => scheduleShow(item.provider)}
            onPointerLeave={scheduleHide}
            onFocus={(event) => {
              if (!restoringFocus.current && event.currentTarget.matches(":focus-visible")) show(item.provider);
            }}
            onBlur={(event) => {
              if (!(event.relatedTarget as Element | null)?.closest("[data-usage-card]")) scheduleHide();
            }}
            onClick={() => show(item.provider)}
            className={`flex h-6 items-center gap-1.5 rounded-control px-1.5 transition-[background-color,color,opacity] duration-150 hover:bg-hover-2 hover:text-ink ${expanded ? "bg-hover-2 text-ink" : ""} ${item.status === "error" ? "opacity-60" : ""}`}
          >
            <ProviderMark provider={item.provider} />
            {item.windows.length === 0 ? (
              <span className="text-ink-3">—</span>
            ) : (
              item.windows.slice(0, 2).map((entry) => (
                <span key={entry.id} className="flex items-center gap-1">
                  <UsageBar usedPercent={entry.usedPercent} className="h-1 w-9" />
                  <span>{formatPercent(entry.usedPercent)}</span>
                  <span className="text-ink-3">{entry.shortLabel}</span>
                </span>
              ))
            )}
          </button>
        );
      })}

      {openCard && openUsage && (
        <UsageCard
          id={`usage-card-${openUsage.provider}`}
          usage={openUsage}
          loading={usage.loading}
          position={{ left: openCard.left, bottom: openCard.bottom }}
          onRefresh={() => void usage.refresh()}
          onPointerEnter={keepOpen}
          onPointerLeave={scheduleHide}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            const segment = segments.current.get(openUsage.provider);
            if (next && (event.currentTarget.contains(next) || segment?.contains(next))) return;
            scheduleHide();
          }}
        />
      )}
    </div>
  );
}
