import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { EthernetPortIcon, LinkSquare02Icon } from "@hugeicons/core-free-icons";
import type { AgentPort } from "../../model";
import { portUrl } from "../../lib/ports";
import Tooltip from "../primitives/Tooltip";
import { useAnchoredPopover } from "./useAnchoredPopover";

/** The ports the chat's commands listen on: a "Ports n" pill that opens a nonmodal list anchored above the composer. */
export function PortTrack({ ports }: { ports?: AgentPort[] }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [opened, setOpened] = useState(false);
  const bounds = useAnchoredPopover({ opened, setOpened, trigger, panel, width: 320 });
  const empty = !ports?.length;
  // The last server stopping closes the list; a later one starts closed.
  useEffect(() => { if (empty) setOpened(false); }, [empty]);
  if (!ports?.length) return null;
  return <div className="flex" data-slot="port-track">
    <Tooltip label="Ports this chat's commands listen on" align="end">
      <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={opened} aria-controls={opened ? panelId : undefined} aria-label={`Ports, ${ports.length} listening`} onClick={() => setOpened(!opened)} className="flex h-6 items-center gap-1.5 rounded-full border border-line bg-surface px-2 text-[11px] text-ink-2 hover:bg-hover focus-visible:outline-2">
        <HugeiconsIcon icon={EthernetPortIcon} size={12} aria-hidden />
        Ports <span className="tabular-nums">{ports.length}</span>
      </button>
    </Tooltip>
    {opened && createPortal(<div ref={panel} id={panelId} role="dialog" aria-label="Ports" aria-modal="false" tabIndex={-1} data-slot="port-popover" style={bounds} className="fixed z-50 flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface p-1 text-ink shadow-raised focus:outline-none">
      <ul className="min-h-0 overflow-y-auto overscroll-contain">
        {ports.map(port => <li key={port.port} data-port-row>
          <a href={portUrl(port)} target="_blank" rel="noopener noreferrer" title={`Open ${portUrl(port)}`} className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink no-underline hover:bg-hover focus-visible:outline-2">
            <span className="w-14 shrink-0 font-mono tabular-nums">:{port.port}</span>
            <span className="min-w-0 flex-1 truncate text-ink-3">{port.command}<span className="sr-only">, process {port.pid}</span></span>
            <span className="flex shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><HugeiconsIcon icon={LinkSquare02Icon} size={14} aria-hidden /></span>
          </a>
        </li>)}
      </ul>
    </div>, document.body)}
  </div>;
}
