import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { ListTodoIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { AgentTask } from "../../model";
import { SpinnerRing } from "../primitives/SpinnerRing";
import { ScrollArea } from "../primitives/ScrollArea";
import Tooltip from "../primitives/Tooltip";
import { useAnchoredPopover } from "./useAnchoredPopover";

const statusLabels: Record<AgentTask["status"], string> = { pending: "Pending", in_progress: "In progress", completed: "Completed" };

function TaskMarker({ status }: { status: AgentTask["status"] }) {
  if (status === "in_progress") return <SpinnerRing size={12} />;
  if (status === "completed") return <HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden />;
  return <span aria-hidden className="size-3 rounded-full border-[1.5px] border-line-strong" />;
}

/** The agent's live to-do list: a compact "done/total" pill that opens a nonmodal list anchored above the composer. */
export function TaskTrack({ tasks }: { tasks?: AgentTask[] }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [opened, setOpened] = useState(false);
  const bounds = useAnchoredPopover({ opened, setOpened, trigger, panel, width: 380 });
  const empty = !tasks?.length;
  // The list goes with its turn; a later one starts closed.
  useEffect(() => {
    if (empty) setOpened(false);
  }, [empty]);
  if (!tasks?.length) return null;
  const done = tasks.filter((task) => task.status === "completed").length;
  return (
    <div className="flex" data-slot="task-track">
      <Tooltip label="To-do list" align="end">
        <button
          ref={trigger}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={opened}
          aria-controls={opened ? panelId : undefined}
          aria-label={`To-do list, ${done} of ${tasks.length} done`}
          onClick={() => setOpened(!opened)}
          className="flex h-6 items-center gap-1.5 rounded-full border border-line bg-surface px-2 text-[11px] text-ink-2 hover:bg-hover focus-visible:outline-2"
        >
          <HugeiconsIcon icon={ListTodoIcon} size={12} aria-hidden />
          <span className="tabular-nums">
            {done}/{tasks.length}
          </span>
        </button>
      </Tooltip>
      {opened &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            role="dialog"
            aria-label="To-do list"
            aria-modal="false"
            tabIndex={-1}
            data-slot="task-popover"
            style={bounds}
            className="fixed z-50 flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface p-1 text-ink shadow-raised focus:outline-none"
          >
            <ScrollArea as="ul">
              {tasks.map((task) => (
                <li key={task.id} data-task-row data-status={task.status} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[13px]">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-ink-3">
                    <TaskMarker status={task.status} />
                  </span>
                  <span className={`min-w-0 break-words ${task.status === "completed" ? "text-ink-3 line-through" : ""}`}>
                    <span className="sr-only">{statusLabels[task.status]}: </span>
                    {task.status === "in_progress" && task.activeForm ? task.activeForm : task.content}
                  </span>
                </li>
              ))}
            </ScrollArea>
          </div>,
          document.body,
        )}
    </div>
  );
}
