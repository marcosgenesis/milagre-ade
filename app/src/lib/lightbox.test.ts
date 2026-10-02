import assert from "node:assert/strict";
import test from "node:test";
import { clampView, containedRect, MAX_ZOOM, panBy, step, zoomAt } from "./lightbox.ts";

// A 400x300 image shown in an 800x600 stage.
const frame = { width: 400, height: 300, frameWidth: 800, frameHeight: 600 };
const fit = { scale: 1, x: 0, y: 0 };

test("a fitted image cannot pan", () => {
  assert.deepEqual(clampView({ scale: 1, x: 50, y: -50 }, frame), fit);
  assert.deepEqual(panBy(fit, 30, 30, frame), fit);
});

test("a zoomed image pans only until its edge meets the stage edge", () => {
  // At 4x the image is 1600x1200, so it overhangs the stage by 400 and 300 on each side.
  assert.deepEqual(clampView({ scale: 4, x: 1000, y: -1000 }, frame), { scale: 4, x: 400, y: -300 });
  assert.deepEqual(panBy({ scale: 4, x: 0, y: 0 }, 50, -20, frame), { scale: 4, x: 50, y: -20 });
});

test("zooming keeps the point under the cursor still", () => {
  // Cursor 100px right of centre, zoom 1x to 4x: that pixel moves to 400 unless we shift by -300.
  assert.deepEqual(zoomAt(fit, 4, { x: 100, y: 0 }, frame), { scale: 4, x: -300, y: 0 });
});

test("zoom stays between fit and the maximum, and returning to fit recentres", () => {
  assert.equal(zoomAt(fit, 20, { x: 0, y: 0 }, frame).scale, MAX_ZOOM);
  assert.deepEqual(zoomAt({ scale: 2, x: -100, y: 40 }, 0.2, { x: 0, y: 0 }, frame), fit);
});

test("navigation wraps neither way", () => {
  assert.equal(step(0, -1, 3), 0);
  assert.equal(step(1, 1, 3), 2);
  assert.equal(step(2, 1, 3), 2);
});

test("containedRect finds where object-contain draws the media", () => {
  // A 2:1 image in an 80x80 box is drawn 80x40, centred vertically.
  assert.deepEqual(containedRect({ left: 10, top: 20, width: 80, height: 80 }, 200, 100), { left: 10, top: 40, width: 80, height: 40 });
  assert.equal(containedRect({ left: 0, top: 0, width: 80, height: 80 }, 0, 0), null);
});
