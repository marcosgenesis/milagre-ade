import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ContextUsage } from "../model";
import { useDismiss } from "../lib/use-dismiss";
import { contextAdvice, contextSummary, contextTone } from "./usage/format";
import { UsageBar } from "./usage/UsageBar";

const CARD_WIDTH = 264;
const CARD_GAP = 8;
const VIEWPORT_MARGIN = 12;
const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 150;

type Position = { left: number; bottom: number };

// The ring's colour by how full the window is: ink, then the accent from 75%, then red from 90% (see contextTone).
const STROKE = { normal: "var(--ink-2)", warning: "var(--accent-ink)", critical: "var(--red)" } as const;

/**
 * A ring that fills as the agent's context window does; the agent compacts it when it gets close to full.
 * Hover, focus or click opens a card above it with the numbers, styled like the plan usage card. On a Claude chat the
 * card offers Compact now (`onCompact`), which sends `/compact`; `compactBlocked` says why it can't right now.
 */
export function ContextRing({ onCompact, compactBlocked = null, ...usage }: ContextUsage & { onCompact?: () => void; compactBlocked?: string | null }) {
  const { ratio, percent, tokens, left } = contextSummary(usage);
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const label = `Context: ${percent}% used (${tokens})`;
  const [position, setPosition] = useState<Position | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);

  function clearTimer() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }

  function place() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(VIEWPORT_MARGIN, Math.min(rect.right - CARD_WIDTH, window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN)),
      bottom: window.innerHeight - rect.top + CARD_GAP,
    });
  }

  function show() {
    clearTimer();
    place();
  }

  function schedule(next: () => void, delay: number) {
    clearTimer();
    timer.current = window.setTimeout(next, delay);
  }

  function hide() {
    clearTimer();
    setPosition(null);
  }

  useEffect(() => clearTimer, []);

  useDismiss(position !== null, hide, (target) => Boolean(target.closest("[data-context-card]")) || Boolean(trigger.current?.contains(target)), place);

  useEffect(() => {
    if (!position) return;
    // Capture runs before App's window-level Escape handler, which cancels the running agent.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      hide();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [position]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={position !== null}
        aria-controls={position ? "context-card" : undefined}
        onPointerEnter={() => schedule(show, OPEN_DELAY_MS)}
        onPointerLeave={() => schedule(hide, CLOSE_DELAY_MS)}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) show();
        }}
        onBlur={(event) => {
          // Focus moving into the card (its Compact now button) keeps it open.
          if (!(event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-context-card]"))) hide();
        }}
        onClick={() => (position ? hide() : show())}
        className={`flex size-7 shrink-0 items-center justify-center rounded-control transition-[background-color] duration-150 hover:bg-hover-2 ${position ? "bg-hover-2" : ""}`}
      >
        <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="-rotate-90">
          <circle cx="8" cy="8" r={radius} fill="none" stroke="var(--line-strong)" strokeWidth="2" />
          <circle
            cx="8"
            cy="8"
            r={radius}
            fill="none"
            stroke={STROKE[contextTone(percent)]}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
            className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
          />
        </svg>
      </button>
      {position &&
        createPortal(
          <div
            id="context-card"
            role="dialog"
            aria-label="Context window"
            data-context-card
            onPointerEnter={clearTimer}
            onPointerLeave={() => schedule(hide, CLOSE_DELAY_MS)}
            className="fixed z-50 rounded-[14px] bg-surface text-ink shadow-overlay"
            style={{
              width: CARD_WIDTH,
              left: position.left,
              bottom: position.bottom,
              animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
              transformOrigin: "bottom right",
            }}
          >
            <div className="flex flex-col gap-1.5 px-4 pb-3 pt-3.5">
              <p className="text-[14px] font-semibold leading-5">Context</p>
              <UsageBar usedPercent={percent} display="used" className="h-1.5 w-full" />
              <div className="flex items-center justify-between text-[12px] tabular-nums text-ink-2">
                <span>{percent}% used</span>
                <span>{tokens}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2.5 border-t border-line px-4 py-3 text-[12px] leading-[1.45] text-ink-2">
              <p>
                {left}. {contextAdvice(percent, Boolean(onCompact))}
              </p>
              {onCompact && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-compact-now
                    disabled={Boolean(compactBlocked)}
                    onClick={() => {
                      hide();
                      onCompact();
                    }}
                    className="inline-flex h-7 shrink-0 items-center rounded-control bg-ink px-2.5 text-[12px] font-medium text-surface transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-40"
                  >
                    Compact now
                  </button>
                  {compactBlocked && <span className="text-ink-3">{compactBlocked}</span>}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
