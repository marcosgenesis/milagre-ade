import { memo, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { Archive02Icon, Cancel01Icon, ViewIcon } from "@hugeicons/core-free-icons";
import type { ModelProvider, Subagent } from "../../model";
import { subagentActive, subagentFinished } from "../../lib/subagents";
import { Markdown } from "../markdown/Markdown";
import { ProviderLogo } from "../ProviderLogo";
import { SpinnerRing } from "../primitives/SpinnerRing";
import { ScrollArea } from "../primitives/ScrollArea";
import Tooltip from "../primitives/Tooltip";
import { useAnchoredPopover } from "./useAnchoredPopover";

const labels: Record<Subagent["status"], string> = {
  initializing: "Starting",
  running: "Running",
  waiting: "Waiting",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Stopped",
  unknown: "Status unavailable",
};
function elapsed(agent: Subagent, now: number) {
  const seconds = Math.max(0, Math.floor(((agent.endedAt ?? now) - agent.startedAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export const SubagentTranscript = memo(function SubagentTranscript({ agent }: { agent: Subagent }) {
  // oxlint-disable-next-line react/purity -- Date.now() only seeds the initial clock state; an effect keeps it current
  const [now, setNow] = useState(Date.now());
  const running = subagentActive(agent);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return (
    <div className="space-y-4 p-3" data-slot="subagent-transcript">
      <div className="flex flex-wrap gap-3 text-[12px] text-ink-3">
        <span>{labels[agent.status]}</span>
        <span>{elapsed(agent, now)}</span>
        <span>Read-only transcript</span>
      </div>
      {agent.prompt && (
        <div className="rounded-lg bg-hover p-3">
          <p className="mb-1 text-[11px] text-ink-3">Task</p>
          <p className="whitespace-pre-wrap break-words text-[13px]">{agent.prompt}</p>
        </div>
      )}
      {agent.latestActivity && <p className="break-words text-[12px] text-ink-3">{agent.latestActivity}</p>}
      {agent.transcript.map((entry) => (
        <div key={entry.id} className="min-w-0 break-words text-[13px]">
          {entry.kind === "tool" ? (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-line p-3 font-mono text-[12px]">{entry.text}</pre>
          ) : (
            <Markdown text={entry.text} />
          )}
        </div>
      ))}
      {!agent.transcript.length && <p className="py-6 text-[13px] text-ink-3">No child output received yet.</p>}
    </div>
  );
});

/** A nonmodal list anchored above the composer. Archiving affects views, not provider execution. */
export function SubagentTrack({
  agents,
  provider = "codex",
  onOpenCanvas,
  onArchiveFinished,
  onArchive,
}: {
  agents: Subagent[];
  provider?: ModelProvider;
  onOpenCanvas: () => void;
  onArchiveFinished?: () => void;
  onArchive?: (id: string, archived: boolean) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [opened, setOpened] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const visible = agents.filter((agent) => !agent.archived);
  const archivedCount = agents.length - visible.length;
  const rows = agents.filter((agent) => Boolean(agent.archived) === archived);
  const child = rows.find((agent) => agent.id === selected);
  const close = () => {
    setOpened(false);
    trigger.current?.focus();
  };

  const bounds = useAnchoredPopover({ opened, setOpened, trigger, panel, width: child ? 480 : 420, height: child ? 520 : 360 });

  if (!agents.length || (!visible.length && !opened)) return null;
  const actionClass = "flex size-6 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink focus-visible:outline-2 disabled:opacity-40";
  return (
    <div className="flex" data-slot="subagent-track">
      {visible.length > 0 && (
        <button
          ref={trigger}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={opened}
          aria-controls={opened ? panelId : undefined}
          onClick={() => {
            setSelected(null);
            setArchived(false);
            setOpened(!opened);
          }}
          className="flex items-center gap-2 rounded-full border border-line bg-surface h-6 px-2 text-[11px] text-ink-2 hover:bg-hover focus-visible:outline-2"
        >
          {visible.some(subagentActive) && <SpinnerRing size={12} />}
          Subagents <span className="tabular-nums">{visible.length}</span>
        </button>
      )}
      {opened &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            role="dialog"
            aria-label="Subagents"
            aria-modal="false"
            data-slot="subagent-popover"
            style={bounds}
            className="fixed z-50 flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface p-1 shadow-raised text-ink"
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
              const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-subagent-open]")];
              if (!buttons.length) return;
              event.preventDefault();
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                index < 0
                  ? event.key === "ArrowDown"
                    ? 0
                    : buttons.length - 1
                  : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
              buttons[next].focus();
              buttons[next].scrollIntoView({ block: "nearest" });
            }}
          >
            {child ? (
              <>
                <header className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-2">
                  <button type="button" onClick={() => setSelected(null)} className="rounded px-1 text-[12px] text-ink-3 hover:text-ink">
                    Back
                  </button>
                  <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium">{child.title}</h2>
                  <button type="button" aria-label="Close subagents" onClick={close} className={actionClass}>
                    <HugeiconsIcon icon={Cancel01Icon} size={14} />
                  </button>
                </header>
                <ScrollArea>
                  <SubagentTranscript agent={child} />
                </ScrollArea>
              </>
            ) : (
              <>
                {!archived && (
                  <div className="mb-1 flex shrink-0 items-center gap-1 border-b border-line pb-1">
                    <button
                      type="button"
                      data-subagent-archive-finished
                      disabled={!onArchiveFinished || !visible.some(subagentFinished)}
                      onClick={onArchiveFinished}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] text-ink-2 hover:bg-hover focus-visible:outline-2 disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <HugeiconsIcon icon={Archive02Icon} size={14} />
                      Archive finished subagents
                    </button>
                    <Tooltip label="Watch subagents">
                      <button
                        type="button"
                        aria-label="Open subagent canvas"
                        onClick={() => {
                          setOpened(false);
                          onOpenCanvas();
                        }}
                        className={`${actionClass} mr-1 shrink-0`}
                      >
                        <HugeiconsIcon icon={ViewIcon} size={17} />
                      </button>
                    </Tooltip>
                  </div>
                )}
                <ScrollArea as="ul">
                  {rows.map((agent) => (
                    <li key={agent.id} data-subagent-row className="group flex items-center gap-1 rounded-md px-1 hover:bg-hover focus-within:bg-hover">
                      <button
                        type="button"
                        data-subagent-open
                        onClick={() => setSelected(agent.id)}
                        title={`${agent.title} (${labels[agent.status]})`}
                        className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-1 text-left text-[13px] focus-visible:outline-2"
                      >
                        <span className="flex size-4 shrink-0 items-center justify-center text-ink-3">
                          {subagentActive(agent) ? <SpinnerRing size={12} /> : <ProviderLogo provider={provider} size={14} />}
                        </span>
                        <span className="truncate">{agent.title}</span>
                      </button>
                      <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                        <Tooltip label={archived ? "Restore subagent" : "Archive subagent"}>
                          <button
                            type="button"
                            aria-label={`${archived ? "Restore" : "Archive"} ${agent.title}`}
                            disabled={!onArchive}
                            onClick={() => onArchive?.(agent.id, !archived)}
                            className={actionClass}
                          >
                            <HugeiconsIcon icon={Archive02Icon} size={14} />
                          </button>
                        </Tooltip>
                      </span>
                    </li>
                  ))}
                </ScrollArea>
                {!rows.length && <p className="px-3 py-5 text-[12px] text-ink-3">{archived ? "No archived subagents." : "No subagents to show."}</p>}
                {(archivedCount > 0 || archived) && (
                  <button
                    type="button"
                    data-subagent-archived-toggle
                    onClick={() => setArchived(!archived)}
                    className="mt-1 border-t border-line px-2 py-2 text-left text-[11px] text-ink-3 hover:text-ink"
                  >
                    {archived ? "Back to subagents" : `Archived (${archivedCount})`}
                  </button>
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
