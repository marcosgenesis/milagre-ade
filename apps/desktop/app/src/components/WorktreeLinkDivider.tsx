import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitBranchIcon, Link04Icon } from "@hugeicons/core-free-icons";
import { linkedSummaryText, worktreeLinkLabel, worktreeLinkText } from "@milagre/shared/worktree-link";
import type { WorktreeLinkedContext } from "../model";
import { useProjectImages } from "../lib/project-images";
import { HandoffBriefDialog } from "./Handover";
import { WorkspaceIcon } from "./WorkspaceIcon";

/**
 * A Link on the canvas that reached this Chat: a hairline with "Linked to  web  main" centred on it, as the handoff
 * divider is drawn. It opens the linked summary the Chat's next turn gets.
 */
export function WorktreeLinkDivider({ context }: { context: WorktreeLinkedContext }) {
  const [open, setOpen] = useState(false);
  const imageOf = useProjectImages([context.project.path]);
  const label = worktreeLinkLabel(context);
  const canOpen = Boolean(context.summary);
  return (
    <div data-worktree-link-divider className="flex w-full items-center gap-3 py-1 text-[12px] text-ink-3" role="group" aria-label={worktreeLinkText(context)}>
      <span className="h-px flex-1 bg-line" />
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => setOpen(true)}
        aria-label={canOpen ? "Open the linked summary" : undefined}
        className="flex min-w-0 items-center gap-1.5 rounded-control px-2 py-0.5 enabled:hover:bg-hover enabled:hover:text-ink disabled:cursor-default"
      >
        <HugeiconsIcon icon={Link04Icon} size={13} strokeWidth={1.8} color="currentColor" className="shrink-0" />
        <span className="shrink-0">Linked to{label.lead ? ` ${label.lead}` : ""}</span>
        {label.project ? (
          <>
            <span
              aria-hidden
              className="flex size-3.5 shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-ink text-[8.5px] font-semibold text-surface"
            >
              <WorkspaceIcon src={imageOf(context.project.path)} fallback={label.project.slice(0, 1).toUpperCase()} />
            </span>
            <span className="truncate font-medium text-ink-2">{label.project}</span>
          </>
        ) : (
          <HugeiconsIcon icon={GitBranchIcon} size={12} strokeWidth={1.8} color="currentColor" className="shrink-0" />
        )}
        {label.detail && <span className={`truncate font-mono text-[11.5px] ${label.project ? "" : "font-medium text-ink-2"}`}>{label.detail}</span>}
        {context.sameProject && <span className="shrink-0 text-[11px]">in this Project</span>}
      </button>
      <span className="h-px flex-1 bg-line" />
      {open && context.summary && <HandoffBriefDialog title="Linked summary" brief={linkedSummaryText(context.summary)} onClose={() => setOpen(false)} />}
    </div>
  );
}
