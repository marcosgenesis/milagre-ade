import { memo, useId, useState } from "react";
import type { ComponentProps } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, ArrowDown01Icon, CommandLineIcon, File01Icon, Loading03Icon, PencilEdit02Icon, Search01Icon, Tick02Icon, Wrench01Icon } from "@hugeicons/core-free-icons";
import type { ChatStep, StepKind } from "../../model";
import { titleSpans } from "../../lib/reply-parts";
import { CodeBlock } from "../markdown/CodeBlock";

type IconData = ComponentProps<typeof HugeiconsIcon>["icon"];

const KIND_ICONS: Record<StepKind, IconData> = { shell: CommandLineIcon, edit: PencilEdit02Icon, read: File01Icon, search: Search01Icon, other: Wrench01Icon };
// Commands show as a terminal session ("$ command", then output), edits as diffs.
const DETAIL_FENCES: Partial<Record<StepKind, string>> = { shell: "console", edit: "diff" };

function Icon({ icon, size = 14 }: { icon: IconData; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} color="currentColor" />;
}

/** One tool call in a reply: what it did and how it went. A row with output or a diff opens to show it. */
export const StepRow = memo(function StepRow({ step, waiting = false }: { step: ChatStep; waiting?: boolean }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const expandable = Boolean(step.detail);
  const state = waiting ? "Waiting for approval" : step.status === "running" ? "Running" : step.status === "failed" ? "Failed" : "Done";
  const rowClass = "flex w-full min-w-0 items-center gap-2 rounded-[8px] px-1.5 py-1 text-left text-[12.5px] leading-[1.4] text-ink-2";
  const content = (
    <>
      <span className={`shrink-0 ${step.status === "failed" ? "text-red" : "text-ink-3"}`}><Icon icon={KIND_ICONS[step.kind] ?? Wrench01Icon} /></span>
      <span className="min-w-0 flex-1 truncate">
        {titleSpans(step.title).map((span, index) => (span.code
          ? <code key={index} className="rounded-[4px] bg-field px-1 py-px font-mono text-[0.92em] text-ink">{span.text}</code>
          : <span key={index}>{span.text}</span>))}
      </span>
      <span className="sr-only">{state}</span>
      {waiting ? (
        <span aria-hidden className="shrink-0 text-[11.5px] text-ink-3">Waiting for approval</span>
      ) : step.status === "running" ? (
        <span aria-hidden className="shrink-0 text-ink-3 motion-safe:animate-spin"><Icon icon={Loading03Icon} size={13} /></span>
      ) : step.status === "failed" ? (
        <span aria-hidden className="flex shrink-0 items-center gap-1 text-[11.5px] text-red"><Icon icon={Alert02Icon} size={13} />Failed</span>
      ) : (
        <span aria-hidden className="shrink-0 text-ink-3"><Icon icon={Tick02Icon} size={13} /></span>
      )}
      {expandable && <span aria-hidden className={`shrink-0 text-ink-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}><Icon icon={ArrowDown01Icon} size={12} /></span>}
    </>
  );
  return (
    <div data-slot="step" data-status={step.status} className="min-w-0">
      {expandable ? (
        <button type="button" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((value) => !value)} className={`${rowClass} transition-colors hover:bg-hover hover:text-ink`}>{content}</button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
      {open && step.detail && (
        <div id={detailId} className="max-h-96 overflow-y-auto pl-6">
          <CodeBlock code={step.detail.replace(/\n$/, "")} fence={DETAIL_FENCES[step.kind]} />
        </div>
      )}
    </div>
  );
});
