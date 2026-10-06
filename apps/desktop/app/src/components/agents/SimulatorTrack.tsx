import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowExpand01Icon, ArrowShrink01Icon, Cancel01Icon, SmartphoneIcon } from "@hugeicons/core-free-icons";
import type { SimulatorApi, SimulatorDevice, SimulatorList } from "@milagre/shared/simulator";
import { createSimulatorBridge, createSimulatorReceiverHtml } from "@milagre/shared/simulator-receiver";
import { ScrollArea } from "../primitives/ScrollArea";
import Tooltip from "../primitives/Tooltip";
import { useAnchoredPopover } from "./useAnchoredPopover";
import { viewerTheme } from "./viewerTheme";

/** Running simulators belong to this Mac, independently of the current Chat or Worktree. */
export function SimulatorTrack() {
  const api = window.milagre?.simulators;
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [list, setList] = useState<SimulatorList>({ devices: [], supported: true });
  const [opened, setOpened] = useState(false), [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<SimulatorDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const close = useCallback(() => { setOpened(false); setExpanded(false); setSelected(null); }, []);
  const bounds = useAnchoredPopover({ opened, setOpened: value => { if (!value) close(); }, trigger, panel, width: 390, height: 650 });
  useEffect(() => {
    if (!api) return;
    let disposed = false, busy = false;
    const refresh = async () => {
      if (document.hidden || busy) return;
      busy = true;
      try { const result = await api.list(); if (!disposed) setList(result); }
      catch (error) { if (!disposed) setList(current => ({ ...current, error: error instanceof Error ? error.message : "Could not list simulators." })); }
      finally { busy = false; if (!disposed) setLoading(false); }
    };
    const visibility = () => { if (document.hidden) close(); else void refresh(); };
    void refresh(); const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", visibility);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [api, close]);
  if (!api || !list.supported) return null;
  const open = () => { if (opened) { close(); return; } setSelected(list.devices.length === 1 ? list.devices[0] : null); setOpened(true); };
  return <div className="flex" data-slot="simulator-track">
    <Tooltip label="Running simulators on this Mac" align="end"><button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={opened} aria-controls={opened ? panelId : undefined} aria-label={`Simulators, ${list.devices.length} running on this Mac`} onClick={open} className="flex h-6 items-center gap-1.5 rounded-full border border-line bg-surface px-2 text-[11px] text-ink-2 hover:bg-hover focus-visible:outline-2">
      <HugeiconsIcon icon={SmartphoneIcon} size={12} aria-hidden />Simulators <span className="tabular-nums">{list.devices.length}</span>
    </button></Tooltip>
    {opened && createPortal(<>
      {expanded && <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-overlay" aria-hidden />}
      <div ref={panel} id={panelId} role="dialog" aria-label="Simulator" aria-modal="false" tabIndex={-1} data-slot="simulator-popover" data-expanded={expanded || undefined} style={expanded ? { left: 20, right: 20, top: 20, bottom: 20 } : { ...bounds, height: selected ? 650 : undefined }} className="fixed z-50 flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface text-ink shadow-raised focus:outline-none">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          {selected && list.devices.length > 1 ? <Tooltip label="Back to devices"><button type="button" aria-label="Back to devices" onClick={() => setSelected(null)} className="rounded p-1 text-ink-2 hover:bg-hover"><HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden /></button></Tooltip> : <HugeiconsIcon icon={SmartphoneIcon} size={16} aria-hidden />}
          <div className="min-w-0 flex-1"><div className="truncate text-[13px]">{selected?.name ?? "Simulator"}</div><div className="text-[11px] text-ink-3">On this Mac</div></div>
          {selected && <Tooltip label={expanded ? "Collapse simulator" : "Expand simulator"}><button type="button" aria-label={expanded ? "Collapse simulator" : "Expand simulator"} onClick={() => setExpanded(value => !value)} className="rounded p-1 text-ink-2 hover:bg-hover"><HugeiconsIcon icon={expanded ? ArrowShrink01Icon : ArrowExpand01Icon} size={16} aria-hidden /></button></Tooltip>}
          <Tooltip label="Close simulator"><button type="button" aria-label="Close simulator" onClick={close} className="rounded p-1 text-ink-2 hover:bg-hover"><HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden /></button></Tooltip>
        </header>
        {selected ? <SimulatorFrame key={selected.id} api={api} deviceId={selected.id} onClose={close} /> : <ScrollArea className="p-1">
          {loading && <p role="status" className="p-3 text-[13px] text-ink-2">Finding running simulators...</p>}
          {list.error && <p role="alert" className="p-3 text-[13px] text-red">{list.error}</p>}
          {!loading && !list.error && !list.devices.length && <p className="p-3 text-[13px] text-ink-2">No devices are running. Start an iOS simulator or Android emulator on this Mac.</p>}
          {list.devices.map(device => <button key={device.id} type="button" data-simulator-device={device.id} onClick={() => setSelected(device)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-hover"><HugeiconsIcon icon={SmartphoneIcon} size={16} aria-hidden /><span className="min-w-0 flex-1 truncate text-[13px]">{device.name}</span><span className="text-[11px] text-ink-3">{device.platform === 'android' ? 'Android' : 'iOS'} {device.version}</span></button>)}
        </ScrollArea>}
      </div>
    </>, document.body)}
  </div>;
}

function SimulatorFrame({ api, deviceId, onClose }: { api: SimulatorApi; deviceId: string; onClose(): void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => createSimulatorReceiverHtml({ deviceId, theme: viewerTheme() }), [deviceId]);
  const syncTheme = useCallback(() => frame.current?.contentWindow?.postMessage({ channel: "milagre-simulator-theme", theme: viewerTheme() }, "*"), []);
  useEffect(() => {
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, [syncTheme]);
  useEffect(() => {
    const bridge = createSimulatorBridge((method, args) => (api[method] as (request: unknown) => Promise<unknown>)(args), reply => frame.current?.contentWindow?.postMessage(reply, "*"));
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.channel === "milagre-simulator" && event.data.event === "close") { onClose(); return; }
      void bridge.receive(event.data);
    };
    window.addEventListener("message", receive);
    return () => { window.removeEventListener("message", receive); bridge.dispose(); };
  }, [api, deviceId, onClose]);
  return <iframe ref={frame} onLoad={syncTheme} title="Live simulator" data-slot="simulator-frame" srcDoc={html} sandbox="allow-scripts allow-same-origin" allow="autoplay" className="min-h-0 w-full flex-1 border-0 bg-black" />;
}
