import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { EthernetPortIcon, LinkSquare02Icon, StopCircleIcon } from "@hugeicons/core-free-icons";
import type { AgentPort } from "../../model";
import { portUrl } from "../../lib/ports";
import { SpinnerRing } from "../primitives/SpinnerRing";
import { ScrollArea } from "../primitives/ScrollArea";
import Tooltip from "../primitives/Tooltip";
import { useAnchoredPopover } from "./useAnchoredPopover";

/**
 * The ports the chat's commands listen on: a "Ports n" pill that opens a nonmodal list anchored above the composer.
 * A row opens the port in the browser; its stop button ends the command behind it.
 */
export function PortTrack({ ports, onStop }: { ports?: AgentPort[]; onStop?: (pid: number) => Promise<unknown> }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [opened, setOpened] = useState(false);
  // Pids being stopped; a row leaves the list once the main process sees its server gone.
  const [stopping, setStopping] = useState<Set<number>>(new Set());
  const stop = (pids: number[]) => {
    if (!onStop) return;
    setStopping(current => new Set([...current, ...pids]));
    for (const pid of pids) void onStop(pid).catch(() => {}).finally(() => setStopping(current => {
      const next = new Set(current);
      next.delete(pid);
      return next;
    }));
  };
  const bounds = useAnchoredPopover({ opened, setOpened, trigger, panel, width: 320 });
  const empty = !ports?.length;
  // The last server stopping closes the list; a later one starts closed.
  // oxlint-disable-next-line react/set-state-in-effect -- pre-existing, see PR body
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
      {ports.length > 1 && <div className="mb-1 shrink-0 border-b border-line pb-1">
        <button type="button" data-port-stop-all disabled={!onStop || ports.every(port => stopping.has(port.pid))} onClick={() => stop([...new Set(ports.map(port => port.pid))])} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] text-ink-2 hover:bg-hover focus-visible:outline-2 disabled:opacity-40 disabled:hover:bg-transparent">
          <HugeiconsIcon icon={StopCircleIcon} size={14} aria-hidden />Stop all
        </button>
      </div>}
      <ScrollArea as="ul">
        {ports.map(port => <li key={port.port} data-port-row data-stopping={stopping.has(port.pid) || undefined} className="group flex items-center gap-1 rounded-md pr-1 hover:bg-hover focus-within:bg-hover">
          <a href={portUrl(port)} target="_blank" rel="noopener noreferrer" title={`Open ${portUrl(port)}`} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-[13px] text-ink no-underline focus-visible:outline-2">
            <span className="w-14 shrink-0 font-mono tabular-nums">:{port.port}</span>
            <span className="min-w-0 flex-1 truncate text-ink-3">{port.command}<span className="sr-only">, process {port.pid}</span></span>
            <span className="flex shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"><HugeiconsIcon icon={LinkSquare02Icon} size={14} aria-hidden /></span>
          </a>
          <span className={`flex shrink-0 transition-opacity ${stopping.has(port.pid) ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"}`}>
            {stopping.has(port.pid)
              ? <span role="status" aria-label={`Stopping port ${port.port}`} className="flex size-6 items-center justify-center text-ink-3"><SpinnerRing size={12} /></span>
              : <Tooltip label="Stop"><button type="button" data-port-stop aria-label={`Stop port ${port.port}`} disabled={!onStop} onClick={() => stop([port.pid])} className="flex size-6 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-red focus-visible:outline-2 disabled:opacity-40"><HugeiconsIcon icon={StopCircleIcon} size={14} /></button></Tooltip>}
          </span>
        </li>)}
      </ScrollArea>
    </div>, document.body)}
  </div>;
}
