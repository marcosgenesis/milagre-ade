import assert from "node:assert/strict";
import test from "node:test";
import { phoneQrSrc, phoneStatusLine } from "./phone.ts";

test("the status line says what is happening and where the phone can reach this Mac", () => {
  assert.equal(phoneStatusLine(null), "Checking…");
  assert.equal(phoneStatusLine({ enabled: false, state: "off", remote: "none" }), "Off");
  assert.equal(phoneStatusLine({ enabled: true, state: "starting", remote: "cloudflare" }), "Starting…");
  assert.equal(phoneStatusLine({ enabled: true, state: "error", remote: "none", error: "Address already in use" }), "Address already in use");
  assert.equal(phoneStatusLine({ enabled: true, state: "on", remote: "cloudflare", localUrl: "http://127.0.0.1:8797", publicUrl: "https://mac.example.com" }), "Reachable at mac.example.com");
  assert.equal(phoneStatusLine({ enabled: true, state: "on", remote: "none", localUrl: "http://127.0.0.1:8797" }), "This Mac only — 127.0.0.1");
});

test("the QR image source is an inert data URL", () => {
  const src = phoneQrSrc('<svg viewBox="0 0 1 1"><path d="M0 0h1"/></svg>');
  assert.match(src, /^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  assert.equal(decodeURIComponent(src.split(",")[1]), '<svg viewBox="0 0 1 1"><path d="M0 0h1"/></svg>');
});
