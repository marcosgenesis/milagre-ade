import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { artifactDocument, type Artifact } from "@milagre/shared/artifact";
import type { ArtifactRef } from "../../model";
import Tooltip from "../primitives/Tooltip";

/** A comment the user pinned on a design and hasn't sent yet. */
export type DesignPin = { key: string; design: ArtifactRef; x: number; y: number; text: string };
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
      referrerPolicy="no-referrer"
      tabIndex={preview ? -1 : undefined}
      className={`block size-full border-0 bg-white ${preview ? "pointer-events-none" : ""}`}
    />
  );
}

/**
 * Every design of a Chat side by side, at the screen size each was made for. Drag the background or a frame's title
 * to pan, scroll to pan, and pinch or ⌘-scroll to zoom; scrolling over a design scrolls the design. In comment mode a
 * click on a design pins a comment there.
 */
export const ArtifactCanvas = forwardRef<
  CanvasHandle,
  {
    chatId: string;
    designs: ArtifactRef[];
    versions: Record<string, number | null>;
    onVersion: (id: string, version: number | null) => void;
    /** The design to bring into view, and a count that changes each time it is asked again. */
    focus: { id: string; nonce: number } | null;
    commenting: boolean;
    pins: DesignPin[];
    onPin: (design: ArtifactRef, x: number, y: number) => void;
    chosen: { id: string; version: number } | null;
    onChoose: ((design: ArtifactRef) => void) | null;
    onView: (view: CanvasView) => void;
  }
>(function ArtifactCanvas({ chatId, designs, versions, onVersion, focus, commenting, pins, onPin, chosen, onChoose, onView }, handle) {
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
    fit(focus?.id);
  }, [focus?.id, focus?.nonce, fit]);
  const settled = useCallback(() => {
    if (!moved.current) fit(focus?.id);
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

  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, [data-design-body]")) return;
    drag.current = { pointer: event.pointerId, x: event.clientX - viewRef.current.x, y: event.clientY - viewRef.current.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    moved.current = true;
    setView((current) => ({ ...current, x: event.clientX - start.x, y: event.clientY - start.y }));
  };
  const endDrag = () => {
    drag.current = null;
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
            pins={pins}
            onPin={onPin}
            chosen={chosen}
            onChoose={onChoose}
            onSized={settled}
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
  pins,
  onPin,
  chosen,
  onChoose,
  onSized,
  scale,
}: {
  chatId: string;
  design: ArtifactRef;
  number: number;
  version: number | null;
  onVersion: (version: number | null) => void;
  commenting: boolean;
  pins: DesignPin[];
  onPin: (design: ArtifactRef, x: number, y: number) => void;
  chosen: { id: string; version: number } | null;
  onChoose: ((design: ArtifactRef) => void) | null;
  onSized: () => void;
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
  const isChosen = chosen?.id === design.id && chosen.version === shown.version;
  const framePins = pins.filter((pin) => pin.design.id === design.id && pin.design.version === shown.version);
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
          {isChosen ? (
            <span data-slot="artifact-chosen" className="flex items-center gap-1.5 rounded-[6px] bg-accent/10 px-2 py-0.5 text-accent">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} aria-hidden />
              Chosen
            </span>
          ) : (
            onChoose && (
              <button
                type="button"
                aria-label={`Choose ${shown.title}, version ${shown.version}`}
                onClick={() => onChoose(shown)}
                className="rounded-[6px] border border-line bg-surface px-2 py-0.5 text-ink hover:bg-hover"
              >
                Choose
              </button>
            )
          )}
        </div>
      </div>
      <div
        data-design-body
        className={`relative overflow-hidden rounded-[12px] border-2 bg-white shadow-raised ${isChosen ? "border-accent" : "border-line"}`}
        style={{ width, height }}
      >
        {artifact ? (
          <ArtifactFrame html={artifact.html} title={shown.title} />
        ) : (
          <div className="grid size-full place-items-center text-ink-3" style={{ fontSize: 24 }}>
            {error ?? "Loading design…"}
          </div>
        )}
        {(commenting || framePins.length > 0) && (
          // Over the design, so a click pins a comment instead of reaching the design.
          <div
            data-slot="artifact-comment-layer"
            aria-label={commenting ? `Pin a comment on ${shown.title}` : undefined}
            className={`absolute inset-0 ${commenting ? "cursor-crosshair" : "pointer-events-none"}`}
            onClick={(event) => {
              if (!commenting || !artifact) return;
              const rect = event.currentTarget.getBoundingClientRect();
              onPin(shown, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
            }}
          >
            {framePins.map((pin) => (
              <span
                key={pin.key}
                data-slot="artifact-pin"
                className="absolute grid size-6 place-items-center rounded-full rounded-bl-none bg-accent text-[11px] font-medium text-white shadow-raised"
                // Pinned by its bottom-left corner, and the same size on screen however far the canvas zooms.
                style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%`, transform: `translateY(-100%) scale(${1 / scale})`, transformOrigin: "bottom left" }}
              >
                {pins.indexOf(pin) + 1}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
