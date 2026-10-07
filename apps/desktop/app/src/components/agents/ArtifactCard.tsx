import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowExpand01Icon,
  ArrowShrink01Icon,
  Cancel01Icon,
  Comment01Icon,
  FitToScreenIcon,
  MinusSignIcon,
  Add01Icon,
  PaintBoardIcon,
} from "@hugeicons/core-free-icons";
import { chosenDesign, designFeedbackMessage } from "@milagre/shared/artifact";
import type { ArtifactRef, ChatStep } from "../../model";
import Tooltip from "../primitives/Tooltip";
import { ArtifactCanvas, ArtifactFrame, useArtifact, type CanvasHandle, type CanvasView, type DesignPin, type PinControls } from "./ArtifactCanvas";

// Docked width plus the 12px gap to the chat. The chat panes reserve it through --artifact-dock.
const DOCK_WIDTH = 560;
// Narrower than this beside the dock, the chat is no use: the canvas takes the whole workspace instead.
const MIN_CHAT_WIDTH = 420;

/**
 * The workspace between the sidebar and the git changes panel, which an expanded design fills; `right` is how much of
 * the window's right edge the changes panel takes, so the design docks beside it rather than over it.
 */
function useWorkspaceArea() {
  const [area, setArea] = useState<{ left: number; right: number; width: number; top: number; bottom: number } | null>(null);
  useEffect(() => {
    const main = document.querySelector<HTMLElement>("[data-workspace-main]") ?? document.querySelector<HTMLElement>("[data-chat-pane]");
    if (!main) return;
    // The workspace's own width, without the space a dock reserves in it. The changes panel opening narrows <main>.
    const measure = () => {
      const rect = main.getBoundingClientRect();
      const right = document.querySelector("[data-changes-slot]")?.getBoundingClientRect().width ?? 0;
      // Lined up with the sidebar's card, top and bottom.
      const sidebar = document.querySelector("aside[aria-label='Workspace navigation']")?.getBoundingClientRect();
      setArea({
        left: rect.left,
        right,
        width: window.innerWidth - rect.left - right,
        top: sidebar?.top ?? 40,
        bottom: sidebar ? window.innerHeight - sidebar.bottom : 12,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return area;
}

/** Whether the element is laid out: false while an ancestor hides it (the diff, settings or canvas in place of the chat). */
function useShown() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(() => setShown(element.getClientRects().length > 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, shown] as const;
}

type ArtifactsValue = {
  /** The Chat's key, or null where designs can't be read (a new Chat, a shared Link Chat). */
  chatId: string | null;
  /** The newest version of each design the Chat's replies showed, by id, in the order they were first shown. */
  latest: Map<string, ArtifactRef>;
  open: (ref: ArtifactRef) => void;
  /** Opens the canvas framing these designs together. */
  openAll: (refs: ArtifactRef[]) => void;
};
const Artifacts = createContext<ArtifactsValue>({ chatId: null, latest: new Map(), open: () => {}, openAll: () => {} });

/** The newest version of each design among a Chat's steps, in the order they were first shown. */
export function latestArtifacts(steps: ChatStep[]): Map<string, ArtifactRef> {
  const latest = new Map<string, ArtifactRef>();
  for (const step of steps)
    if (step.kind === "artifact" && step.artifact && (latest.get(step.artifact.id)?.version ?? 0) < step.artifact.version)
      latest.set(step.artifact.id, step.artifact);
  return latest;
}

/**
 * A design at the screen size it was made for, scaled to fit its box whole and centered: a laptop screen fills the
 * card's width, a phone screen its height. A host from before screen sizes sends none; it gets the default.
 */
function ScaledPreview({ html, title, width = 1280, height = 800 }: { html: string; title: string; width?: number; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = size.width && size.height ? Math.min(size.width / width, size.height / height) : 0;
  return (
    <div ref={box} className="absolute inset-0 bg-canvas">
      {scale > 0 && (
        <div
          className="absolute top-0 left-0 origin-top-left overflow-hidden"
          style={{ width, height, transform: `translate(${(size.width - width * scale) / 2}px, ${(size.height - height * scale) / 2}px) scale(${scale})` }}
        >
          <ArtifactFrame html={html} title={title} preview />
        </div>
      )}
    </div>
  );
}

/** A design the agent showed: its first screen, and a button that opens it on the canvas beside the chat. */
export const ArtifactCard = memo(function ArtifactCard({ step }: { step: ChatStep & { artifact: ArtifactRef } }) {
  const { chatId, latest, open } = useContext(Artifacts);
  const { id, version, title } = step.artifact;
  const { artifact, error } = useArtifact(chatId, id, version);
  const newest = latest.get(id)?.version ?? version;
  return (
    <div data-slot="artifact-card" data-artifact={id} className="my-2 max-w-xl overflow-hidden rounded-[10px] border border-line bg-surface">
      <div className="relative h-56 overflow-hidden border-b border-line bg-white">
        {artifact ? (
          <ScaledPreview html={artifact.html} title={`Preview of ${title}`} width={artifact.width} height={artifact.height} />
        ) : (
          <div className="grid size-full place-items-center px-6 text-center text-[12px] text-ink-3">
            {error ?? (chatId ? "Loading design…" : "Open this Chat in its Project to see the design.")}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <HugeiconsIcon icon={PaintBoardIcon} size={16} className="shrink-0 text-ink-2" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-ink">{title}</div>
          <div className="text-[11px] text-ink-3">
            Version {version}
            {newest > version ? ` · version ${newest} is newer` : ""}
          </div>
        </div>
        <button
          type="button"
          disabled={!chatId}
          onClick={() => open(step.artifact)}
          className="rounded-[8px] border border-line px-2.5 py-1 text-[12px] text-ink hover:bg-hover disabled:opacity-50"
        >
          Open
        </button>
      </div>
    </div>
  );
});

/** The designs one reply showed: a card for one, a strip of thumbnails for several. */
export function ArtifactCards({ steps }: { steps: (ChatStep & { artifact: ArtifactRef })[] }) {
  const { chatId, openAll } = useContext(Artifacts);
  if (steps.length === 0) return null;
  if (steps.length === 1) return <ArtifactCard step={steps[0]!} />;
  return (
    <div data-slot="artifact-group" className="my-2 max-w-xl overflow-hidden rounded-[10px] border border-line bg-surface">
      <div className="flex gap-2 overflow-x-auto border-b border-line p-2">
        {steps.map((step) => (
          <GroupThumb key={step.id} design={step.artifact} />
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <HugeiconsIcon icon={PaintBoardIcon} size={16} className="shrink-0 text-ink-2" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-ink">{steps.length} designs</div>
          <div className="truncate text-[11px] text-ink-3">{steps.map((step) => step.artifact.title).join(" · ")}</div>
        </div>
        <button
          type="button"
          disabled={!chatId}
          onClick={() => openAll(steps.map((step) => step.artifact))}
          className="rounded-[8px] border border-line px-2.5 py-1 text-[12px] text-ink hover:bg-hover disabled:opacity-50"
        >
          Open
        </button>
      </div>
    </div>
  );
}

function GroupThumb({ design }: { design: ArtifactRef }) {
  const { chatId, open } = useContext(Artifacts);
  const { artifact, error } = useArtifact(chatId, design.id, design.version);
  return (
    <button
      type="button"
      data-slot="artifact-thumb"
      data-artifact={design.id}
      aria-label={`Open ${design.title}, version ${design.version}`}
      disabled={!chatId}
      onClick={() => open(design)}
      className="flex w-40 shrink-0 flex-col gap-1 rounded-[8px] p-1 text-left hover:bg-hover"
    >
      <span className="relative block h-28 w-full overflow-hidden rounded-[6px] border border-line">
        {artifact ? (
          <ScaledPreview html={artifact.html} title={`Preview of ${design.title}`} width={artifact.width} height={artifact.height} />
        ) : (
          <span className="grid size-full place-items-center px-2 text-center text-[11px] text-ink-3">{error ?? "Loading…"}</span>
        )}
      </span>
      <span className="truncate px-0.5 text-[12px] text-ink">{design.title}</span>
    </button>
  );
}

type Opened = { chatId: string | null; focus: { id: string | null; nonce: number }; versions: Record<string, number | null> };

/**
 * The designs of one Chat: cards in its replies and the canvas docked beside it. `bodies` are the Chat's user messages,
 * where the last design the user chose is read back; `onSend` sends a comment or a choice to the agent.
 */
export function ArtifactsProvider({
  chatId,
  steps,
  bodies,
  onSend,
  children,
}: {
  chatId: string | null;
  steps: ChatStep[];
  bodies: string[];
  onSend?: (text: string) => Promise<boolean>;
  children: React.ReactNode;
}) {
  const latest = useMemo(() => latestArtifacts(steps), [steps]);
  const chosen = useMemo(() => chosenDesign(bodies), [bodies]);
  // What is open belongs to the Chat it opened in: switching Chats closes it.
  const [openedIn, setOpenedIn] = useState<Opened | null>(null);
  const opened = openedIn?.chatId === chatId ? openedIn : null;
  // A card opens the version it shows; when that is the newest, its frame follows the agent's next revisions.
  const value = useMemo<ArtifactsValue>(
    () => ({
      chatId,
      latest,
      open: (ref) =>
        setOpenedIn((current) => ({
          chatId,
          focus: { id: ref.id, nonce: (current?.focus.nonce ?? 0) + 1 },
          versions: { ...(current?.chatId === chatId ? current.versions : {}), [ref.id]: latest.get(ref.id)?.version === ref.version ? null : ref.version },
        })),
      openAll: (refs) =>
        setOpenedIn((current) => ({
          chatId,
          focus: { id: null, nonce: (current?.focus.nonce ?? 0) + 1 },
          versions: {
            ...(current?.chatId === chatId ? current.versions : {}),
            ...Object.fromEntries(refs.map((ref) => [ref.id, latest.get(ref.id)?.version === ref.version ? null : ref.version])),
          },
        })),
    }),
    [chatId, latest],
  );
  // The canvas belongs to the chat: while something else takes the chat's place, it steps aside and comes back with it.
  const [anchor, chatShown] = useShown();
  return (
    <Artifacts.Provider value={value}>
      <span ref={anchor} aria-hidden className="pointer-events-none absolute top-0 left-0 h-px w-px" />
      {children}
      {opened && chatId && chatShown && (
        <ArtifactDock
          chatId={chatId}
          designs={[...latest.values()]}
          focus={opened.focus}
          versions={opened.versions}
          onVersion={(id, version) => setOpenedIn({ ...opened, versions: { ...opened.versions, [id]: version } })}
          chosen={chosen}
          onSend={onSend}
          onClose={() => setOpenedIn(null)}
        />
      )}
    </Artifacts.Provider>
  );
}

function ArtifactDock({
  chatId,
  designs,
  focus,
  versions,
  onVersion,
  chosen,
  onSend,
  onClose,
}: {
  chatId: string;
  designs: ArtifactRef[];
  focus: { id: string | null; nonce: number };
  versions: Record<string, number | null>;
  onVersion: (id: string, version: number | null) => void;
  chosen: { id: string; version: number } | null;
  onSend?: (text: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const area = useWorkspaceArea();
  const cramped = !!area && area.width - DOCK_WIDTH - 12 < MIN_CHAT_WIDTH;
  const full = expanded || cramped;
  const canvas = useRef<CanvasHandle>(null);
  const [view, setView] = useState<CanvasView | null>(null);
  const [commenting, setCommenting] = useState(false);
  // Feedback waits here until Send: comments pinned on designs, and the design the user chose.
  const [pins, setPins] = useState<DesignPin[]>([]);
  const [openPin, setOpenPin] = useState<string | null>(null);
  const [choice, setChoice] = useState<ArtifactRef | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // Beside the chat, the chat makes room; filling the workspace, the canvas covers it.
  useEffect(() => {
    if (full) return;
    const root = document.documentElement.style;
    root.setProperty("--artifact-dock", `${DOCK_WIDTH + 12}px`);
    return () => {
      root.removeProperty("--artifact-dock");
    };
  }, [full]);
  // Escape leaves comment mode first, then closes the canvas.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (commenting) setCommenting(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commenting, onClose]);
  const written = pins.filter((pin) => pin.text.trim());
  const feedback = written.length + (choice ? 1 : 0);
  const send = async () => {
    if (!onSend || sending || !feedback) return;
    setSending(true);
    setError("");
    try {
      if (await onSend(designFeedbackMessage({ choice, comments: written.map(({ design, x, y, text }) => ({ design, x, y, text })) }))) {
        setPins([]);
        setOpenPin(null);
        setChoice(null);
        setCommenting(false);
      } else setError("The feedback didn't send. Try again.");
    } finally {
      setSending(false);
    }
  };
  const comments: PinControls = {
    pins,
    open: openPin,
    onPin: (design, x, y) => {
      const key = `${Date.now()}-${pins.length}`;
      // A new pin closes the open bubble, dropping it if it was left empty.
      setPins((current) => [...current.filter((pin) => pin.key !== openPin || pin.text.trim()), { key, design, x, y, text: "" }]);
      setOpenPin(key);
    },
    onOpen: setOpenPin,
    onText: (key, text) => setPins((current) => current.map((pin) => (pin.key === key ? { ...pin, text } : pin))),
    onRemove: (key) => {
      setPins((current) => current.filter((pin) => pin.key !== key));
      setOpenPin((current) => (current === key ? null : current));
    },
  };
  const icon = "rounded p-1 text-ink-2 hover:bg-hover disabled:opacity-40";
  return createPortal(
    <div
      role="dialog"
      aria-label="Designs"
      aria-modal="false"
      data-slot="artifact-dock"
      data-full={full || undefined}
      // Beside a docked simulator and the git changes panel, not over them.
      style={
        full && area
          ? { top: area.top, left: area.left, right: `calc(${area.right + 12}px + var(--simulator-dock, 0px))`, bottom: area.bottom }
          : {
              top: area?.top ?? 40,
              right: `calc(${(area?.right ?? 0) + 12}px + var(--simulator-dock, 0px))`,
              bottom: area?.bottom ?? 12,
              width: DOCK_WIDTH,
            }
      }
      className="fixed z-40 flex flex-col overflow-hidden rounded-window bg-surface text-ink shadow-card"
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-2">
        <HugeiconsIcon icon={PaintBoardIcon} size={16} aria-hidden />
        <div className="ml-1 min-w-0 flex-1">
          <div className="truncate text-[13px]">Designs</div>
          <div className="text-[11px] text-ink-3">{designs.length === 1 ? "1 design" : `${designs.length} designs`} in this Chat</div>
        </div>
        {feedback > 0 && (
          <button
            type="button"
            data-slot="artifact-send"
            disabled={sending}
            title={error || undefined}
            onClick={() => void send()}
            className={`mr-1 flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[12px] font-medium disabled:opacity-50 ${error ? "bg-red text-white" : "bg-ink text-surface"}`}
          >
            {error ? "Retry send" : "Send"}
            <span className="rounded-full bg-surface/20 px-1.5 text-[11px] tabular-nums">{feedback}</span>
          </button>
        )}
        <Tooltip label={commenting ? "Stop commenting" : "Comment on a design"}>
          <button
            type="button"
            aria-label={commenting ? "Stop commenting" : "Comment on a design"}
            aria-pressed={commenting}
            disabled={!onSend}
            onClick={() => setCommenting((value) => !value)}
            className={`${icon} ${commenting ? "bg-accent/10 text-accent" : ""}`}
          >
            <HugeiconsIcon icon={Comment01Icon} size={16} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip label="Zoom out">
          <button type="button" aria-label="Zoom out" onClick={() => canvas.current?.zoomBy(1 / 1.25)} className={icon}>
            <HugeiconsIcon icon={MinusSignIcon} size={16} aria-hidden />
          </button>
        </Tooltip>
        <span data-slot="artifact-zoom" className="w-10 text-center text-[11px] text-ink-3 tabular-nums">
          {view ? `${Math.round(view.scale * 100)}%` : ""}
        </span>
        <Tooltip label="Zoom in">
          <button type="button" aria-label="Zoom in" onClick={() => canvas.current?.zoomBy(1.25)} className={icon}>
            <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip label="Fit every design">
          <button type="button" aria-label="Fit every design" onClick={() => canvas.current?.fitAll()} className={icon}>
            <HugeiconsIcon icon={FitToScreenIcon} size={16} aria-hidden />
          </button>
        </Tooltip>
        {!cramped && (
          <Tooltip label={expanded ? "Show the chat beside the designs" : "Fill the window with the designs"}>
            <button
              type="button"
              aria-label={expanded ? "Show the chat beside the designs" : "Fill the window with the designs"}
              aria-pressed={expanded}
              onClick={() => setExpanded((value) => !value)}
              className={icon}
            >
              <HugeiconsIcon icon={expanded ? ArrowShrink01Icon : ArrowExpand01Icon} size={16} aria-hidden />
            </button>
          </Tooltip>
        )}
        <Tooltip label="Close designs">
          <button type="button" aria-label="Close designs" onClick={onClose} className={icon}>
            <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden />
          </button>
        </Tooltip>
      </header>
      <ArtifactCanvas
        ref={canvas}
        chatId={chatId}
        designs={designs}
        versions={versions}
        onVersion={onVersion}
        focus={focus}
        commenting={commenting}
        comments={comments}
        choice={{
          sent: chosen,
          pending: choice,
          onChoose: onSend ? (design) => setChoice((current) => (current?.id === design.id && current.version === design.version ? null : design)) : null,
        }}
        onView={setView}
      />
    </div>,
    document.body,
  );
}
