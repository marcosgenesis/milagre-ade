import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ModelProvider, PermissionMode } from "../model";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Cancel01Icon, File01Icon } from "@hugeicons/core-free-icons";
import { handoverNotes, providerLabel } from "../lib/handover";
import { ProviderLogo } from "./ProviderLogo";
import { ComposerNotice } from "./ComposerNotice";
import { Markdown } from "./markdown/Markdown";

/** Replaces the provider tabs once a chat has messages: opens a new chat on the other provider with this one's context. */
export function HandoverRow({ provider, blocked, onClick }: { provider: ModelProvider; blocked: string | null; onClick: () => void }) {
  return (
    <button
      type="button"
      data-handover-row
      disabled={blocked !== null}
      title={blocked ?? undefined}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-control bg-inset px-2.5 py-2 text-left hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
    >
      <ProviderLogo provider={provider} size={16} />
      <span className="flex min-w-0 flex-col">
        <span className="text-xs font-semibold text-ink">Handover to {providerLabel(provider)}</span>
        <span className="truncate text-[11px] text-ink-3">New chat with this chat's context</span>
      </span>
    </button>
  );
}

export function HandoverLinkBar({ to, onOpen }: { to: { id: number; title: string; provider: ModelProvider }; onOpen: (id: number) => void }) {
  return (
    <button type="button" data-handover-to onClick={() => onOpen(to.id)} className="flex w-full items-center gap-2 rounded-control border border-line px-3 py-2 text-left text-[12px] text-ink-2 hover:bg-hover">
      <ProviderLogo provider={to.provider} size={14} />
      <span>Handed over to {providerLabel(to.provider)}</span>
      <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.8} color="currentColor" />
      <span className="min-w-0 truncate font-medium text-ink">{to.title}</span>
    </button>
  );
}

export function HandoverFromLabel({ from, onOpen }: { from: { id: number; title: string }; onOpen: (id: number) => void }) {
  return (
    <button type="button" data-handover-from onClick={() => onOpen(from.id)} className="self-end text-[11px] text-ink-3 hover:text-ink">
      Handed over from <span className="font-medium">{from.title}</span>
    </button>
  );
}

/** Above the composer of a handed-over chat before its first message: what stays behind and how the permission mode behaves here. */
export function HandoverNote({ from, to, permissionMode, onDismiss }: { from: ModelProvider; to: ModelProvider; permissionMode: PermissionMode; onDismiss: () => void }) {
  return (
    <ComposerNotice data-handover-note onDismiss={onDismiss}>
      <ul className="flex flex-col gap-1">
        {handoverNotes({ from, to, permissionMode }).map((line) => <li key={line}>{line}</li>)}
      </ul>
    </ComposerNotice>
  );
}

export const HANDOVER_BRIEF_NAME = "Handover brief.md";

/**
 * The handover brief as an attachment: in the composer of a handed-over chat before its first message (it can't be
 * removed, and opens for editing when `onSave` is given), and on the first message it was sent with (read-only).
 */
export function HandoverBriefChip({ brief, onSave }: { brief: string; onSave?: (text: string) => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-handover-brief
        aria-label={`Open ${HANDOVER_BRIEF_NAME}`}
        onClick={() => setOpen(true)}
        className="flex max-w-60 items-center gap-1.5 rounded-lg border border-line bg-inset px-2 py-1.5 text-xs text-ink transition-colors hover:border-line-strong hover:bg-hover"
      >
        <HugeiconsIcon icon={File01Icon} size={14} strokeWidth={1.6} color="currentColor" />
        <span className="truncate">{HANDOVER_BRIEF_NAME}</span>
      </button>
      {open && <HandoverBriefDialog brief={brief} onSave={onSave} onClose={() => setOpen(false)} />}
    </>
  );
}

const FOCUSABLE = 'button:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
const BUTTON_PRIMARY = "inline-flex h-8 items-center gap-1.5 rounded-control bg-ink px-3 text-[12.5px] font-medium text-surface transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-40";
const BUTTON_SECONDARY = "inline-flex h-8 items-center gap-1.5 rounded-control border border-line bg-surface px-3 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-hover hover:text-ink disabled:cursor-default disabled:opacity-40";

/** The brief in a modal, as the GitActionsDialog is built: Edit and Preview tabs with Save and Cancel, or Preview alone with Close. */
export function HandoverBriefDialog({ brief, onSave, onClose }: { brief: string; onSave?: (text: string) => Promise<void> | void; onClose: () => void }) {
  const editable = onSave !== undefined;
  const [tab, setTab] = useState<"edit" | "preview">(editable ? "edit" : "preview");
  const [text, setText] = useState(brief);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Focus moves into the dialog, and back to where it was when the dialog closes.
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  // Escape closes the dialog wherever focus is, and is consumed here so it doesn't also stop the chat's turn.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Tab and Shift+Tab stay inside the dialog.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return event.preventDefault();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || active === panelRef.current)) {
      event.preventDefault();
      first.focus();
    }
  }

  async function save() {
    if (!onSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(text);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  }

  const tabButton = (id: "edit" | "preview", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      data-brief-tab={id}
      onClick={() => setTab(id)}
      className={`rounded-chip px-2.5 py-1 text-xs font-semibold transition-colors ${tab === id ? "bg-surface text-ink shadow-xs" : "text-ink-3 hover:text-ink"}`}
    >
      {label}
    </button>
  );

  return createPortal(
    <div
      data-brief-dialog-overlay
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[oklch(0.2_0.01_260/0.32)] p-4 [-webkit-app-region:no-drag]"
      style={{ animation: "fade-in 140ms ease-out both" }}
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="brief-dialog-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        data-brief-dialog
        className="flex h-[min(88vh,760px)] w-[680px] max-w-full flex-col overflow-hidden rounded-[14px] bg-surface text-ink shadow-overlay outline-none"
        style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both" }}
      >
        <header className="flex items-center gap-3 px-4 pb-2 pt-3.5">
          <h2 id="brief-dialog-title" className="min-w-0 flex-1 truncate text-[15px] font-semibold">{HANDOVER_BRIEF_NAME}</h2>
          {editable && (
            <div role="tablist" aria-label="Brief view" className="flex items-center gap-0.5 rounded-control bg-inset p-0.5">
              {tabButton("edit", "Edit")}
              {tabButton("preview", "Preview")}
            </div>
          )}
          <button type="button" aria-label="Close" onClick={onClose} className="flex size-7 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink">
            <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.8} color="currentColor" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-1">
          {tab === "edit" ? (
            <textarea
              data-brief-editor
              aria-label="Handover brief"
              value={text}
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
              className="min-h-0 w-full flex-1 resize-none rounded-control border border-line bg-field px-3 py-2.5 font-mono text-[12.5px] leading-5 text-ink outline-none transition-colors focus:border-line-strong"
            />
          ) : (
            <div data-brief-preview className="min-h-0 flex-1 overflow-y-auto overscroll-contain text-[13px] leading-[1.55]">
              <Markdown text={text} />
            </div>
          )}
        </div>
        <footer className="flex items-center gap-2 border-t border-line bg-inset px-4 py-3">
          <p role={error ? "alert" : undefined} className="min-w-0 flex-1 text-[12px] text-red">{error}</p>
          {editable ? (
            <>
              <button type="button" data-brief-cancel className={BUTTON_SECONDARY} onClick={onClose} disabled={saving}>Cancel</button>
              <button type="button" data-brief-save className={BUTTON_PRIMARY} onClick={() => void save()} disabled={saving || !text.trim()}>Save</button>
            </>
          ) : (
            <button type="button" data-brief-close className={BUTTON_PRIMARY} onClick={onClose}>Close</button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
