import { useEffect, useRef, useState } from "react";
import type { Subagent } from "../../model";
import { Markdown } from "../markdown/Markdown";

const active = (agent: Subagent) => ["initializing", "running", "waiting"].includes(agent.status);
const labels: Record<Subagent["status"], string> = { initializing: "Starting", running: "Running", waiting: "Waiting", completed: "Completed", failed: "Failed", cancelled: "Stopped", unknown: "Status unavailable" };
function elapsed(agent: Subagent, now: number) {
  const seconds = Math.max(0, Math.floor(((agent.endedAt ?? now) - agent.startedAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Provider-owned children stay available after the parent finishes. This view never prompts a child. */
export function SubagentTrack({ agents }: { agents: Subagent[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const running = agents.filter(active).length;
  const failed = agents.filter(agent => agent.status === "failed").length;
  const completed = agents.filter(agent => agent.status === "completed").length;
  const child = agents.find(agent => agent.id === selected);
  useEffect(() => {
    if (!opened || !running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [opened, running]);
  if (!agents.length) return null;
  const close = () => { dialog.current?.close(); setOpened(false); trigger.current?.focus(); };
  return <div className="mx-auto mb-2 flex w-full max-w-3xl justify-end px-3" data-slot="subagent-track">
    <button ref={trigger} type="button" aria-haspopup="dialog" onClick={() => { setSelected(null); setNow(Date.now()); setOpened(true); dialog.current?.showModal(); }} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-ink-2 hover:bg-hover focus-visible:outline-2">
      Subagents <span className="ml-1 tabular-nums">{agents.length}</span>
      {running > 0 && <span className="ml-2 text-ink">{running} active</span>}
      {completed > 0 && <span className="ml-2">{completed} completed</span>}
      {failed > 0 && <span className="ml-2 text-red">{failed} failed</span>}
    </button>
    <dialog ref={dialog} aria-label="Subagents" onClose={() => setOpened(false)} onClick={event => { if (event.target === event.currentTarget) close(); }} className="m-auto w-[min(680px,calc(100vw-32px))] max-h-[80vh] rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/40">
      <div className="flex max-h-[80vh] flex-col" onClick={event => event.stopPropagation()}>
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          {child && <button type="button" onClick={() => setSelected(null)} className="text-[12px] text-ink-2 hover:text-ink">Back</button>}
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-medium">{child ? child.title : "Subagents"}</h2>
          <button type="button" onClick={close} className="rounded-control px-2 py-1 text-[12px] text-ink-2 hover:bg-hover">Close</button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-3">
          {child ? <div className="space-y-4 p-1" data-slot="subagent-transcript">
            <div className="flex gap-3 text-[12px] text-ink-3"><span>{labels[child.status]}</span><span>{elapsed(child, now)}</span><span>Read-only transcript</span></div>
            {child.prompt && <div className="rounded-lg bg-hover p-3"><p className="mb-1 text-[11px] text-ink-3">Task</p><p className="whitespace-pre-wrap break-words text-[13px]">{child.prompt}</p></div>}
            {child.latestActivity && <p className="break-words text-[12px] text-ink-3">{child.latestActivity}</p>}
            {child.transcript.map(entry => <div key={entry.id} className="min-w-0 break-words text-[13px]">{entry.kind === "tool" ? <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-line p-3 font-mono text-[12px]">{entry.text}</pre> : <Markdown text={entry.text} />}</div>)}
            {!child.transcript.length && <p className="py-6 text-[13px] text-ink-3">No child output received yet.</p>}
          </div> : <ul className="space-y-1">
            {agents.map(agent => <li key={agent.id}><button type="button" onClick={() => setSelected(agent.id)} className="flex w-full items-start gap-3 rounded-lg p-3 text-left hover:bg-hover focus-visible:outline-2">
              <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${agent.status === "failed" ? "bg-red" : active(agent) ? "bg-ink" : "bg-ink-3"}`} />
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{agent.title}</span><span className="mt-1 block truncate text-[12px] text-ink-3">{agent.latestActivity || agent.prompt || "No activity received yet"}</span></span>
              <span className="shrink-0 text-right text-[11px] text-ink-3"><span className="block">{labels[agent.status]}</span><span className="tabular-nums">{elapsed(agent, now)}</span></span>
            </button></li>)}
          </ul>}
        </div>
      </div>
    </dialog>
  </div>;
}
