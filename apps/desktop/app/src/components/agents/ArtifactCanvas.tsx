import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { ARTIFACT_CSP, artifactDocument, type Artifact } from "@milagre/shared/artifact";
import type { ArtifactRef } from "../../model";
import Tooltip from "../primitives/Tooltip";

/** A comment the user pinned on a design and hasn't sent yet. */
export type DesignPin = { key: string; design: ArtifactRef; x: number; y: number; text: string; resolved?: string };
/** The comments pinned on the canvas, the one whose bubble is open, and what changes them. */
export type PinControls = {
  pins: DesignPin[];
  /** Comments already sent: shown where they were left, to read, not to change. */
  sent: DesignPin[];
  open: string | null;
  onPin: (design: ArtifactRef, x: number, y: number) => void;
  onOpen: (key: string | null) => void;
  onText: (key: string, text: string) => void;
  onRemove: (key: string) => void;
};
/** The design the user chose and sent, the one chosen but not sent yet, and what toggles it. */
export type ChoiceControls = {
  sent: { id: string; version: number } | null;
  pending: ArtifactRef | null;
  onChoose: ((design: ArtifactRef) => void) | null;
};
export type CanvasView = { x: number; y: number; scale: number };
export type CanvasHandle = { zoomBy: (factor: number) => void; fitAll: () => void };

const GAP = 80;
// The title row above each frame, in screen pixels.
const HEADER = 32;
const MIN_SCALE = 0.05;
const MAX_SCALE = 2;
const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

export function useArtifact(chatId: string | null, id: string, version: number | null) {
  const [state, setState] = useState<{ artifact: Artifact | null; error: string | null }>({ artifact: null, error: null });
  useEffect(() => {
    if (!chatId) return;
    let live = true;
    window.milagre.artifacts
      .get({ chatId, id, ...(version === null ? {} : { version }) })
      .then((artifact) => live && setState({ artifact, error: null }))
      .catch((error: unknown) => live && setState({ artifact: null, error: error instanceof Error ? error.message : String(error) }));
    return () => {
      live = false;
    };
  }, [chatId, id, version]);
  return state;
}

/**
 * A design runs in a sandbox with no same origin and a policy that blocks its own requests: it can't reach Milagre,
 * the Chat or the network. A preview also takes no input, so the card scrolls with the chat.
 */
export function ArtifactFrame({ html, title, preview = false }: { html: string; title: string; preview?: boolean }) {
  const document = useMemo(() => artifactDocument(html), [html]);
  return (
    <iframe
      title={title}
      srcDoc={document}
      sandbox="allow-scripts"
      // The policy a second time, as the embedder's (Chromium holds the document to it), beside the <meta> inside.
      {...{ csp: ARTIFACT_CSP }}
      referrerPolicy="no-referrer"
      tabIndex={preview ? -1 : undefined}
      className={`block size-full border-0 bg-white ${preview ? "pointer-events-none" : ""}`}
    />
  );
}

/**
 * Every design of a Chat side by side, at the screen size each was made for. Drag the background or a frame's title
 * to pan, scroll to pan, and pinch or ⌘-scroll to zoom; scrolling over a design scrolls the design. In comment mode a
 * click on a design pins a comment there, written in a bubble beside the pin.
 */
export const ArtifactCanvas = forwardRef<
  CanvasHandle,
  {
    chatId: string;
    designs: ArtifactRef[];
    versions: Record<string, number | null>;
    onVersion: (id: string, version: number | null) => void;
    /** The design to bring into view, and a count that changes each time it is asked again. */
    focus: { id: string | null; nonce: number } | null;
    commenting: boolean;
    comments: PinControls;
    choice: ChoiceControls;
    onView: (view: CanvasView) => void;
  }
>(function ArtifactCanvas({ chatId, designs, versions, onVersion, focus, commenting, comments, choice, onView }, handle) {
  const viewport = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<CanvasView>({ x: 40, y: 40, scale: 0.4 });
  // Until the user pans or zooms, the canvas keeps the asked-for design in view as frames load and change size.
  const moved = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => onView(view), [view, onView]);

  const fit = useCallback((id?: string) => {
    const port = viewport.current,
      content = board.current;
    if (!port || !content) return;
    const frames = [...content.querySelectorAll<HTMLElement>("[data-slot=artifact-frame]")].filter((frame) => !id || frame.dataset.artifact === id);
    if (!frames.length) return;
    const left = Math.min(...frames.map((f) => f.offsetLeft)),
      top = Math.min(...frames.map((f) => f.offsetTop)),
      right = Math.max(...frames.map((f) => f.offsetLeft + f.offsetWidth)),
      bottom = Math.max(...frames.map((f) => f.offsetTop + f.offsetHeight));
    const width = port.clientWidth,
      height = port.clientHeight;
    const scale = clamp(Math.min((width - 48) / (right - left), (height - 48) / (bottom - top), 1));
    setView({ scale, x: (width - (right - left) * scale) / 2 - left * scale, y: (height - (bottom - top) * scale) / 2 - top * scale });
  }, []);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    moved.current = true;
    setView((current) => {
      const scale = clamp(current.scale * factor);
      return { scale, x: px - (px - current.x) * (scale / current.scale), y: py - (py - current.y) * (scale / current.scale) };
    });
  }, []);
  useImperativeHandle(
    handle,
    () => ({
      zoomBy: (factor) => {
        const port = viewport.current;
        if (port) zoomAt(factor, port.clientWidth / 2, port.clientHeight / 2);
      },
      fitAll: () => {
        moved.current = true;
        fit();
      },
    }),
    [fit, zoomAt],
  );

  // A new focus (a card's Open) brings that design into view.
  useLayoutEffect(() => {
    moved.current = false;
    fit(focus?.id ?? undefined);
  }, [focus?.id, focus?.nonce, fit]);
  const settled = useCallback(() => {
    if (!moved.current) fit(focus?.id ?? undefined);
  }, [fit, focus?.id]);
  useEffect(() => {
    const port = viewport.current;
    if (!port) return;
    const observer = new ResizeObserver(settled);
    observer.observe(port);
    return () => observer.disconnect();
  }, [settled]);

  // Wheel events need a listener that can cancel them: React's is passive.
  useEffect(() => {
    const port = viewport.current;
    if (!port) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = port.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top);
      else {
        moved.current = true;
        setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
      }
    };
    port.addEventListener("wheel", onWheel, { passive: false });
    return () => port.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // The design taking the mouse, Figma-like: designs let wheel and drag pan the canvas until one is clicked, and a
  // click elsewhere or Escape hands the mouse back to the canvas.
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Leaves the design, not the canvas.
      event.preventDefault();
      setActive(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active]);
  // `design` is the design a press started on: released without dragging, it hands that design the mouse. (The pointer
  // capture that keeps a drag going sends the click to the canvas, so a click handler on the design never fires.)
  const drag = useRef<{ pointer: number; x: number; y: number; startX: number; startY: number; design: string | null } | null>(null);
  // Whether the last press moved the canvas: a drag that starts on a design pans, and doesn't then select it.
  const dragged = useRef(false);
  const onPointerDown = (event: React.PointerEvent) => {
    const target = event.target as HTMLElement;
    if (!target.closest(`[data-slot=artifact-frame][data-artifact="${active}"] [data-design-body]`)) setActive(null);
    if (event.button !== 0 || target.closest("button, textarea, [data-design-body]")) return;
    dragged.current = false;
    const design = target.closest("[data-slot=artifact-shield]") ? (target.closest<HTMLElement>("[data-slot=artifact-frame]")?.dataset.artifact ?? null) : null;
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX - viewRef.current.x,
      y: event.clientY - viewRef.current.y,
      startX: event.clientX,
      startY: event.clientY,
      design,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    if (!dragged.current && Math.hypot(event.clientX - start.startX, event.clientY - start.startY) < 4) return;
    dragged.current = true;
    moved.current = true;
    setView((current) => ({ ...current, x: event.clientX - start.x, y: event.clientY - start.y }));
  };
  const endDrag = (event: React.PointerEvent) => {
    const start = drag.current;
    drag.current = null;
    if (event.type === "pointerup" && start?.design && !dragged.current) setActive(start.design);
  };

  return (
    <div
      ref={viewport}
      data-slot="artifact-canvas"
      className={`relative min-h-0 flex-1 touch-none overflow-hidden bg-canvas ${drag.current ? "cursor-grabbing" : "cursor-grab"}`}
      style={{
        backgroundImage: "radial-gradient(var(--color-line) 1px, transparent 1px)",
        backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        ref={board}
        className="absolute top-0 left-0 flex origin-top-left items-start"
        style={{ gap: GAP, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        {designs.map((design, index) => (
          <DesignFrame
            key={design.id}
            chatId={chatId}
            design={design}
            number={index + 1}
            version={versions[design.id] ?? null}
            onVersion={(version) => onVersion(design.id, version)}
            commenting={commenting}
            comments={comments}
            choice={choice}
            onSized={settled}
            active={active === design.id}
            scale={view.scale}
          />
        ))}
      </div>
    </div>
  );
});

function DesignFrame({
  chatId,
  design,
  number,
  version,
  onVersion,
  commenting,
  comments,
  choice,
  onSized,
  scale,
  active,
}: {
  chatId: string;
  design: ArtifactRef;
  number: number;
  version: number | null;
  onVersion: (version: number | null) => void;
  commenting: boolean;
  comments: PinControls;
  choice: ChoiceControls;
  onSized: () => void;
  /** Whether this design takes the mouse; until it does, wheel and drag over it move the canvas. */
  active: boolean;
  /** The canvas zoom: a frame's title row stays this size on screen however far the canvas zooms. */
  scale: number;
}) {
  // Following the newest unless the user stepped back; a revision the agent shows replaces what is in the frame.
  const { artifact, error } = useArtifact(chatId, design.id, version ?? design.version);
  const width = artifact?.width ?? 1280,
    height = artifact?.height ?? 800;
  useLayoutEffect(onSized, [width, height, onSized]);
  const shown: ArtifactRef = { id: design.id, version: artifact?.version ?? version ?? design.version, title: artifact?.title ?? design.title };
  const last = Math.max(artifact?.latest ?? 1, design.version);
  // Chosen and sent, or chosen here and waiting for Send; a pending choice of another design outranks a sent one.
  const pendingHere = choice.pending?.id === design.id && choice.pending.version === shown.version;
  const sentHere = !choice.pending && choice.sent?.id === design.id && choice.sent.version === shown.version;
  const isChosen = pendingHere || sentHere;
  const framePins = comments.pins.filter((pin) => pin.design.id === design.id && pin.design.version === shown.version);
  const sentPins = comments.sent.filter((pin) => pin.design.id === design.id && pin.design.version === shown.version);
  const go = (next: number) => onVersion(next >= last ? null : next);
  // Too narrow on screen for the title and its controls on one row, the controls go under the title.
  const narrow = width * scale < 300;
  const button = "grid size-6 place-items-center rounded-[6px] text-ink-2 hover:bg-hover disabled:opacity-40";
  return (
    <div data-slot="artifact-frame" data-artifact={design.id} data-version={shown.version} className="flex shrink-0 flex-col" style={{ width }}>
      <div className="relative shrink-0" style={{ height: (narrow ? HEADER * 2 : HEADER) / scale }}>
        <div
          className={`absolute bottom-0 left-0 flex origin-bottom-left items-center gap-1 pb-1.5 text-[12px] text-ink ${narrow ? "flex-wrap content-end" : ""}`}
          style={{ width: width * scale, height: narrow ? HEADER * 2 : HEADER, transform: `scale(${1 / scale})` }}
        >
          <span className="text-ink-3">{number}</span>
          <span className={`min-w-0 flex-1 truncate ${narrow ? "basis-[calc(100%-1.5rem)]" : ""}`}>{shown.title}</span>
          <Tooltip label="Previous version">
            <button
              type="button"
              aria-label={`Previous version of ${shown.title}`}
              disabled={shown.version <= 1}
              onClick={() => go(shown.version - 1)}
              className={button}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden />
            </button>
          </Tooltip>
          <span className="text-ink-3 tabular-nums" data-slot="artifact-frame-version">
            v{shown.version} of {last}
          </span>
          <Tooltip label="Next version">
            <button
              type="button"
              aria-label={`Next version of ${shown.title}`}
              disabled={shown.version >= last}
              onClick={() => go(shown.version + 1)}
              className={button}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden />
            </button>
          </Tooltip>
          {sentHere ? (
            <span data-slot="artifact-chosen" className="flex items-center gap-1.5 rounded-[6px] bg-accent/10 px-2 py-0.5 text-accent">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} aria-hidden />
              Chosen
            </span>
          ) : (
            choice.onChoose && (
              <button
                type="button"
                aria-label={pendingHere ? `Unchoose ${shown.title}` : `Choose ${shown.title}, version ${shown.version}`}
                aria-pressed={pendingHere}
                data-slot={pendingHere ? "artifact-choice-pending" : undefined}
                onClick={() => choice.onChoose?.(shown)}
                className={`flex items-center gap-1.5 rounded-[6px] border px-2 py-0.5 ${pendingHere ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface text-ink hover:bg-hover"}`}
              >
                {pendingHere && <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} aria-hidden />}
                {pendingHere ? "Chosen" : "Choose"}
              </button>
            )
          )}
        </div>
      </div>
      <div className="relative" style={{ width, height }}>
        <div
          data-design-body
          data-active={active || undefined}
          className={`size-full overflow-hidden rounded-[12px] border-2 bg-white shadow-raised ${isChosen || active ? "border-accent" : "border-line"} ${active ? "" : "[&_iframe]:pointer-events-none"}`}
        >
          {artifact ? (
            <ArtifactFrame html={artifact.html} title={shown.title} />
          ) : (
            <div className="grid size-full place-items-center text-ink-3" style={{ fontSize: 24 }}>
              {error ?? "Loading design…"}
            </div>
          )}
        </div>
        {!active && !commenting && (
          // Over a design that doesn't have the mouse: wheel and drag reach the canvas, and a click (see endDrag) hands it the mouse.
          <div data-slot="artifact-shield" aria-label={`Interact with ${shown.title}`} className="absolute inset-0 cursor-grab" />
        )}
        {(commenting || framePins.length > 0 || sentPins.length > 0) && (
          // Over the design, so a click pins a comment instead of reaching the design. Outside its clipping, so a
          // comment's bubble near an edge stays whole.
          <div
            data-slot="artifact-comment-layer"
            data-design-body
            aria-label={commenting ? `Pin a comment on ${shown.title}` : undefined}
            className={`absolute inset-0 ${commenting ? "cursor-crosshair" : "pointer-events-none"}`}
            onClick={(event) => {
              if (!commenting || !artifact || event.target !== event.currentTarget) return;
              const rect = event.currentTarget.getBoundingClientRect();
              comments.onPin(shown, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
            }}
          >
            {sentPins.map((pin) => (
              <CommentPin
                key={pin.key}
                pin={pin}
                number={Number(pin.key.split(":").at(-1)) + 1}
                open={comments.open === pin.key}
                scale={scale}
                comments={comments}
                sent
              />
            ))}
            {framePins.map((pin) => (
              <CommentPin key={pin.key} pin={pin} number={comments.pins.indexOf(pin) + 1} open={comments.open === pin.key} scale={scale} comments={comments} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A pinned comment, Figma-like: the pin marks the spot, and its bubble beside it holds the comment. Enter or a click
 * elsewhere closes the bubble, keeping the comment for Send; one closed empty is removed. Both stay the same size on
 * screen however far the canvas zooms.
 */
function CommentPin({
  pin,
  number,
  open,
  scale,
  comments,
  sent = false,
}: {
  pin: DesignPin;
  number: number;
  open: boolean;
  scale: number;
  comments: PinControls;
  /** A comment already sent: its bubble reads it back, and it can't change. */
  sent?: boolean;
}) {
  const close = () => {
    if (!sent && !pin.text.trim()) comments.onRemove(pin.key);
    comments.onOpen(null);
  };
  // Escape closes a sent comment's bubble before it reaches the canvas (a draft's textarea handles its own).
  useEffect(() => {
    if (!open || !sent) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      comments.onOpen(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, sent, comments]);
  return (
    <div
      // Above the frames beside it, so an open bubble that reaches past its design stays whole.
      className={`pointer-events-auto absolute ${open ? "z-10" : ""}`}
      style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%`, transform: `translateY(-100%) scale(${1 / scale})`, transformOrigin: "bottom left" }}
    >
      <button
        type="button"
        data-slot={sent ? "artifact-sent-pin" : "artifact-pin"}
        aria-label={`Comment ${number}${pin.resolved !== undefined ? ", resolved" : ""}${pin.text.trim() ? `: ${pin.text.trim()}` : ""}`}
        aria-expanded={open}
        onClick={() => (open ? close() : comments.onOpen(pin.key))}
        className={`grid size-6 cursor-pointer place-items-center rounded-full rounded-bl-none text-[11px] font-medium shadow-raised ${pin.resolved !== undefined ? "bg-green text-white" : sent ? "bg-ink text-surface" : "bg-accent text-white"}`}
      >
        {number}
      </button>
      {open && (
        <div
          data-slot="artifact-comment-bubble"
          className="absolute top-0 left-8 flex w-64 cursor-default flex-col gap-2 rounded-[10px] border border-line bg-surface p-2 text-ink shadow-raised"
          onClick={(event) => event.stopPropagation()}
        >
          {sent ? (
            <>
              <p className="px-1 text-[13px] whitespace-pre-wrap">{pin.text}</p>
              {pin.resolved === undefined ? (
                <span className="px-1 text-[11px] text-ink-3">Sent to the agent</span>
              ) : (
                <span data-slot="artifact-comment-resolved" className="flex items-start gap-1 px-1 text-[12px] text-green">
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} className="mt-px shrink-0" aria-hidden />
                  <span>{pin.resolved}</span>
                </span>
              )}
            </>
          ) : (
            <>
              <textarea
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- the bubble opens to be written in, like Figma's
                autoFocus
                aria-label={`Comment ${number} on ${pin.design.title}`}
                rows={2}
                value={pin.text}
                placeholder="Add a comment"
                onChange={(event) => comments.onText(pin.key, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    close();
                  } else if (event.key === "Escape") {
                    // Closes the bubble, not the canvas.
                    event.preventDefault();
                    close();
                  }
                }}
                className="w-full resize-none rounded-[6px] bg-transparent px-1 text-[13px] focus:outline-none"
              />
              <div className="flex items-center justify-between text-[11px] text-ink-3">
                <button type="button" onClick={() => comments.onRemove(pin.key)} className="rounded px-1 py-0.5 hover:bg-hover hover:text-ink">
                  Delete
                </button>
                <span>Enter to keep · sent with Send</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
