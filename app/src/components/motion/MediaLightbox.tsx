import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EASE_OUT, SPRING_LAYOUT } from "../../lib/ease";
import { containedRect, type Frame, panBy, type Rect, step, type View, zoomAt } from "../../lib/lightbox";

export type LightboxItem = { id: string; name: string; src: string; kind: "image" | "video" };
type Media = HTMLImageElement | HTMLVideoElement;
type Zoom = View & { smooth?: boolean };
// Each slide's elements by item id, so an exiting slide never stands in for the current one.
type Elements = { figures: Map<string, HTMLDivElement>; media: Map<string, Media> };

const FIT: Zoom = { scale: 1, x: 0, y: 0 };
const SWIPE = 60;
const natural = (media: Media): [number, number] => media instanceof HTMLImageElement ? [media.naturalWidth, media.naturalHeight] : [media.videoWidth, media.videoHeight];

// Where a thumbnail's media is drawn, if it is still on screen to morph into.
function thumbRect(thumb: HTMLElement | null | undefined): Rect | null {
  const media = thumb?.querySelector<Media>("img, video");
  if (!media) return null;
  const box = media.getBoundingClientRect();
  if (box.bottom < 0 || box.top > innerHeight) return null;
  return containedRect(box, ...natural(media));
}
// The transform that puts `from` exactly over `to`, with a centre origin.
function flip(from: DOMRect, to: Rect) {
  return { x: to.left + to.width / 2 - (from.left + from.width / 2), y: to.top + to.height / 2 - (from.top + from.height / 2), scale: to.width / from.width };
}

const Icon = ({ d }: { d: string }) => <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const control = "flex size-9 items-center justify-center rounded-full bg-white/10 text-white/90 transition-colors hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-accent-ink";

export function MediaLightbox({ items, start, thumbFor, onIndexChange, close }: {
  items: LightboxItem[];
  start: number;
  // The thumbnail button an item opens from, closes back into, and returns focus to.
  thumbFor: (id: string) => HTMLElement | null | undefined;
  onIndexChange?: (index: number) => void;
  close: () => void;
}) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(start);
  const [direction, setDirection] = useState(0);
  const [zoom, setZoom] = useState<Zoom>(FIT);
  const [closing, setClosing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const elements = useRef<Elements>({ figures: new Map(), media: new Map() }).current;
  const opened = useRef(false);
  const swipe = useRef({ total: 0, last: 0, lockedUntil: 0 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const item = items[index];
  // Listeners attach once, so they read the latest render through this.
  const latest = useRef({ index, zoom, closing, items, reduce, thumbFor, onIndexChange, close });
  latest.current = { index, zoom, closing, items, reduce, thumbFor, onIndexChange, close };
  const current = () => latest.current.items[latest.current.index];

  const frame = (): Frame | null => {
    const media = elements.media.get(current().id);
    if (!media || !stage.current) return null;
    return { width: media.offsetWidth, height: media.offsetHeight, frameWidth: stage.current.clientWidth, frameHeight: stage.current.clientHeight };
  };
  // A point relative to the stage centre, where the media is centred.
  const fromCentre = (clientX: number, clientY: number) => {
    const box = stage.current!.getBoundingClientRect();
    return { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 };
  };

  const go = (by: number) => {
    const { index, items, closing, onIndexChange } = latest.current;
    const next = step(index, by, items.length);
    if (next === index || closing) return;
    setDirection(by);
    setIndex(next);
    setZoom(FIT);
    onIndexChange?.(next);
  };

  const requestClose = () => {
    const { closing, reduce, thumbFor, close } = latest.current;
    if (closing) return;
    setClosing(true);
    setZoom(FIT);
    const figure = elements.figures.get(current().id);
    if (!figure) return close();
    // Morph back into the thumbnail when it is on screen; otherwise just fade out.
    const target = thumbRect(thumbFor(current().id));
    const run = !reduce && target
      ? animate(figure, flip(figure.getBoundingClientRect(), target), { duration: 0.26, ease: EASE_OUT })
      : animate(figure, { opacity: 0, scale: reduce ? 1 : 0.96 }, { duration: 0.18 });
    run.then(close);
  };

  // The first media to load morphs out of its thumbnail.
  const ready = (figure: HTMLDivElement) => {
    if (opened.current) return;
    opened.current = true;
    const { reduce, thumbFor, items } = latest.current;
    const source = thumbRect(thumbFor(items[start].id));
    if (reduce || !source) { animate(figure, { opacity: [0, 1], scale: [reduce ? 1 : 0.96, 1] }, { duration: 0.2 }); return; }
    const from = flip(figure.getBoundingClientRect(), source);
    animate(figure, { opacity: [1, 1], x: [from.x, 0], y: [from.y, 0], scale: [from.scale, 1] }, SPRING_LAYOUT);
  };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    // Captured so these keys never reach the chat behind (Escape there stops the agent).
    const keys = (event: KeyboardEvent) => {
      const nudge = ({ ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] } as Record<string, [number, number]>)[event.key];
      if (event.key !== "Escape" && !nudge) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return requestClose();
      const zoom = latest.current.zoom, bounds = frame();
      if (zoom.scale > 1 && bounds) setZoom({ ...panBy(zoom, nudge[0], nudge[1], bounds), smooth: true });
      else if (event.key === "ArrowLeft" || event.key === "ArrowRight") go(event.key === "ArrowLeft" ? -1 : 1);
    };
    // Pinch or ⌘-scroll zooms, scrolling pans a zoomed image, a sideways swipe changes item.
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const zoom = latest.current.zoom, bounds = frame();
      if ((event.ctrlKey || event.metaKey) && bounds && current().kind === "image") {
        setZoom(zoomAt(zoom, zoom.scale * Math.exp(-event.deltaY * 0.01), fromCentre(event.clientX, event.clientY), bounds));
        return;
      }
      if (zoom.scale > 1 && bounds) { setZoom(panBy(zoom, -event.deltaX, -event.deltaY, bounds)); return; }
      const now = performance.now(), s = swipe.current;
      // Momentum keeps sending events after a swipe; wait for it to stop before the next one.
      if (now < s.lockedUntil) { s.lockedUntil = now + 200; return; }
      if (now - s.last > 200) s.total = 0;
      s.last = now;
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      s.total += event.deltaX;
      if (Math.abs(s.total) < SWIPE) return;
      go(Math.sign(s.total));
      s.total = 0;
      s.lockedUntil = now + 200;
    };
    const area = stage.current;
    window.addEventListener("keydown", keys, true);
    area?.addEventListener("wheel", wheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", keys, true);
      area?.removeEventListener("wheel", wheel);
      dialog.current?.close();
      (latest.current.thumbFor(current().id) ?? previous)?.focus();
    };
  }, []);

  const pointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
  };
  const pointerMove = (event: ReactPointerEvent) => {
    const start = drag.current, bounds = frame();
    if (!start || !bounds || zoom.scale <= 1) return;
    setZoom(panBy(zoom, event.clientX - start.x, event.clientY - start.y, bounds));
    drag.current = { x: event.clientX, y: event.clientY, moved: true };
  };
  // A sideways drag on a fitted item changes item, like a swipe.
  const pointerUp = (event: ReactPointerEvent) => {
    const start = drag.current;
    drag.current = null;
    if (!start || start.moved || zoom.scale > 1) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  };
  const doubleClick = (event: ReactMouseEvent) => {
    const bounds = frame();
    if (!bounds) return;
    setZoom(zoom.scale > 1 ? { ...FIT, smooth: true } : { ...zoomAt(zoom, 2.5, fromCentre(event.clientX, event.clientY), bounds), smooth: true });
  };

  const chrome = { initial: { opacity: 0 }, animate: { opacity: closing ? 0 : 1 }, transition: { duration: closing ? 0.18 : 0.24, ease: EASE_OUT } };
  return createPortal(<dialog ref={dialog} aria-label={`Preview ${item.name}`} onCancel={event => { event.preventDefault(); requestClose(); }} className="m-0 h-dvh max-h-none w-dvw max-w-none overflow-hidden bg-transparent p-0 text-white backdrop:bg-transparent">
    <motion.div {...chrome} className="absolute inset-0 bg-black/85" onClick={requestClose} />
    <motion.header {...chrome} className="absolute inset-x-0 top-0 flex h-14 items-center justify-between px-4">
      <span aria-live="polite" className="text-xs tabular-nums text-white/70">{items.length > 1 ? `${index + 1} / ${items.length}` : ""}</span>
      <button autoFocus type="button" aria-label="Close preview" onClick={requestClose} className={control}><Icon d="M6 6l12 12M18 6L6 18" /></button>
    </motion.header>
    <div ref={stage} className="absolute inset-x-0 top-14 bottom-18 overflow-hidden" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; }}>
      <AnimatePresence initial={false} custom={direction}>
        <motion.div key={item.id} custom={direction} variants={{ enter: (by: number) => ({ opacity: 0, x: reduce ? 0 : by * 48 }), center: { opacity: 1, x: 0 }, exit: (by: number) => ({ opacity: 0, x: reduce ? 0 : by * -48 }) }} initial="enter" animate="center" exit="exit" transition={{ duration: 0.22, ease: EASE_OUT }} className="absolute inset-0 flex items-center justify-center p-4" onClick={event => { if (event.target === event.currentTarget) requestClose(); }}>
          <Slide item={item} intro={!opened.current} zoom={zoom} elements={elements} onReady={ready} onDoubleClick={doubleClick} />
        </motion.div>
      </AnimatePresence>
    </div>
    <motion.footer {...chrome} className="absolute inset-x-0 bottom-0 flex h-18 items-center justify-center gap-4 px-4">
      {items.length > 1 && <button type="button" aria-label="Previous" disabled={index === 0} onClick={() => go(-1)} className={control}><Icon d="M15 6l-6 6 6 6" /></button>}
      <span className="min-w-0 max-w-[60vw] truncate text-sm text-white/80" title={item.name}>{item.name}</span>
      {items.length > 1 && <button type="button" aria-label="Next" disabled={index === items.length - 1} onClick={() => go(1)} className={control}><Icon d="M9 6l6 6-6 6" /></button>}
    </motion.footer>
  </dialog>, document.body);
}

function Slide({ item, intro, zoom, elements, onReady, onDoubleClick }: {
  item: LightboxItem;
  intro: boolean;
  zoom: Zoom;
  elements: Elements;
  onReady: (figure: HTMLDivElement) => void;
  onDoubleClick: (event: ReactMouseEvent) => void;
}) {
  const figure = useRef<HTMLDivElement>(null);
  const loaded = () => { if (figure.current) onReady(figure.current); };
  const keep = (el: Media | null) => { if (el) elements.media.set(item.id, el); };
  // A cached image can finish loading before React attaches onLoad.
  useLayoutEffect(() => {
    const media = elements.media.get(item.id);
    if (media instanceof HTMLImageElement && media.complete && media.naturalWidth) loaded();
  }, []);
  const fit = "block max-h-[calc(100dvh-10rem)] max-w-[calc(100vw-2rem)] object-contain";
  return <div ref={el => { figure.current = el; if (el) elements.figures.set(item.id, el); }} style={{ opacity: intro ? 0 : 1 }} className="flex">
    {item.kind === "video"
      ? <video ref={keep} src={item.src} controls autoPlay onLoadedMetadata={loaded} onError={loaded} className={fit} />
      : <motion.img ref={keep} src={item.src} alt={item.name} draggable={false} onLoad={loaded} onError={loaded} onDoubleClick={onDoubleClick}
        data-zoom={zoom.scale.toFixed(2)}
        animate={{ scale: zoom.scale, x: zoom.x, y: zoom.y }} transition={zoom.smooth ? SPRING_LAYOUT : { duration: 0 }}
        className={`${fit} select-none ${zoom.scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`} />}
  </div>;
}
