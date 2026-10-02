import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { WorktreeSetupPlan } from "../electron";

const BUTTON_PRIMARY = "inline-flex h-8 items-center gap-1.5 rounded-control bg-ink px-3 text-[12.5px] font-medium text-surface transition-opacity hover:opacity-85";
const BUTTON_SECONDARY = "inline-flex h-8 items-center gap-1.5 rounded-control border border-line bg-surface px-3 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-hover hover:text-ink";

/**
 * Asks once per repository and command before a new worktree runs a setup command the user didn't type.
 * Escape and a click outside skip it, for this worktree only.
 */
export function WorktreeSetupDialog({ plan, projectName, onDecide }: { plan: WorktreeSetupPlan; projectName: string; onDecide: (decision: "run" | "skip") => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const decideRef = useRef(onDecide);
  decideRef.current = onDecide;

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Focus starts on Skip: a stray Enter must not run code from the repository.
    skipRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  // Consumed here, so Escape doesn't also reach the chat. Focus that leaves the dialog (the composer
  // behind it takes focus as the send settles) comes back to Skip.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      decideRef.current("skip");
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) skipRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, []);

  const fromRepo = plan.source === "repo";
  return createPortal(
    <div
      data-setup-dialog-overlay
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[oklch(0.2_0.01_260/0.32)] p-4 [-webkit-app-region:no-drag]"
      style={{ animation: "fade-in 140ms ease-out both" }}
      onPointerDown={(event) => { if (event.target === event.currentTarget) onDecide("skip"); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-dialog-title"
        aria-describedby="setup-dialog-source"
        data-setup-dialog
        className="flex w-[480px] max-w-full flex-col overflow-hidden rounded-[14px] bg-surface text-ink shadow-overlay outline-none"
        style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both" }}
      >
        <div className="grid gap-3 px-4 pb-4 pt-3.5">
          <h2 id="setup-dialog-title" className="text-[15px] font-semibold">Run the setup command?</h2>
          <p id="setup-dialog-source" className="text-[13px] leading-[1.5] text-ink-2">
            {fromRepo
              ? <>{projectName}'s <code className="rounded-[4px] bg-field px-1 py-px font-mono text-[0.92em] text-ink">.milagre/worktree.json</code> runs this in the new worktree before the agent starts. It runs code from the repository on your Mac.</>
              : <>Your setting for {projectName} runs this in the new worktree before the agent starts.</>}
          </p>
          <pre data-setup-dialog-command className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-control border border-line bg-inset px-3 py-2 font-mono text-[12.5px] leading-5 text-ink">{plan.command}</pre>
          <p className="text-[12px] text-ink-3">Milagre remembers Run for this command in this repository and asks again if it changes. Skip leaves this worktree as it is.</p>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-line bg-inset px-4 py-3">
          <button ref={skipRef} type="button" className={BUTTON_SECONDARY} onClick={() => onDecide("skip")}>Skip</button>
          <button type="button" className={BUTTON_PRIMARY} onClick={() => onDecide("run")}>Run</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
