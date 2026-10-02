// Zoom and pan math for the media lightbox. Offsets are in screen pixels from the stage centre.
export const MAX_ZOOM = 4;

export type View = { scale: number; x: number; y: number };
// The media's fitted size and the stage it sits in.
export type Frame = { width: number; height: number; frameWidth: number; frameHeight: number };
export type Rect = { left: number; top: number; width: number; height: number };

const limit = (value: number, max: number) => Math.min(max, Math.max(-max, value));

export function clampView(view: View, frame: Frame): View {
  const scale = Math.min(MAX_ZOOM, Math.max(1, view.scale));
  // Only the part that overhangs the stage can be panned into view.
  const maxX = Math.max(0, (frame.width * scale - frame.frameWidth) / 2);
  const maxY = Math.max(0, (frame.height * scale - frame.frameHeight) / 2);
  return { scale, x: limit(view.x, maxX) + 0, y: limit(view.y, maxY) + 0 };
}

export function zoomAt(view: View, scale: number, point: { x: number; y: number }, frame: Frame): View {
  const next = Math.min(MAX_ZOOM, Math.max(1, scale));
  const ratio = next / view.scale;
  return clampView({ scale: next, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio }, frame);
}

export function panBy(view: View, dx: number, dy: number, frame: Frame): View {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, frame);
}

export function step(index: number, direction: number, count: number): number {
  return Math.min(count - 1, Math.max(0, index + direction));
}

// Where an object-contain image or video is actually drawn inside its box.
export function containedRect(box: Rect, naturalWidth: number, naturalHeight: number): Rect | null {
  if (!naturalWidth || !naturalHeight || !box.width || !box.height) return null;
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * scale, height = naturalHeight * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}
