import assert from "node:assert/strict";
import test from "node:test";
import { pairedPhonesLine, pairingWindow, phoneQrSrc, phoneStatusLine } from "./phone.ts";

test("the status line says what is happening and where the phone can reach this Mac", () => {
  assert.equal(phoneStatusLine(null), "Checking…");
  assert.equal(phoneStatusLine({ enabled: false, state: "off", remote: "none" }), "Off");
  assert.equal(phoneStatusLine({ enabled: true, state: "starting", remote: "cloudflare" }), "Starting…");
  assert.equal(phoneStatusLine({ enabled: true, state: "error", remote: "none", error: "Address already in use" }), "Address already in use");
  assert.equal(phoneStatusLine({ enabled: true, state: "on", remote: "cloudflare", localUrl: "http://127.0.0.1:8797", publicUrl: "https://mac.example.com" }), "Reachable at mac.example.com");
  assert.equal(phoneStatusLine({ enabled: true, state: "on", remote: "none", localUrl: "http://127.0.0.1:8797" }), "This Mac only — 127.0.0.1");
  assert.equal(phoneStatusLine({ enabled: true, state: "on", remote: "relay", relay: "online", localUrl: "http://127.0.0.1:8797" }), "On, reachable from any network");
  assert.equal(phoneStatusLine({ enabled: true, state: "on", remote: "relay", relay: "connecting", localUrl: "http://127.0.0.1:8797" }), "On, connecting to the relay…");
  assert.equal(phoneStatusLine({ enabled: true, state: "on", remote: "relay", relay: "offline", localUrl: "http://127.0.0.1:8797" }), "On, can't reach the relay. Retrying…");
});

test("the pairing window counts whole minutes up and closes at the deadline", () => {
  const status = (pairingUntil?: number) => ({ enabled: true, state: "on" as const, remote: "relay" as const, relay: "online" as const, pairingUntil });
  assert.equal(pairingWindow(null, 0), null);
  assert.equal(pairingWindow({ enabled: true, state: "on", remote: "cloudflare" }, 0), null);
  assert.equal(pairingWindow(status(), 0), null);
  assert.deepEqual(pairingWindow(status(600_000), 0), { open: true, minutes: 10 });
  assert.deepEqual(pairingWindow(status(600_000), 1), { open: true, minutes: 10 });
  assert.deepEqual(pairingWindow(status(600_000), 60_000), { open: true, minutes: 9 });
  assert.deepEqual(pairingWindow(status(600_000), 599_999), { open: true, minutes: 1 });
  assert.deepEqual(pairingWindow(status(600_000), 600_000), { open: false, minutes: 0 });
});

test("the paired-phone count is shown only for a relay phone", () => {
  const relay = (pairedPhones?: number) => ({ enabled: true, state: "on" as const, remote: "relay" as const, relay: "online" as const, pairedPhones });
  assert.equal(pairedPhonesLine(null), null);
  assert.equal(pairedPhonesLine({ enabled: true, state: "on", remote: "cloudflare" }), null);
  assert.equal(pairedPhonesLine(relay()), null);
  assert.equal(pairedPhonesLine(relay(0)), "No phones yet");
  assert.equal(pairedPhonesLine(relay(1)), "1 phone");
  assert.equal(pairedPhonesLine(relay(3)), "3 phones");
});

test("the QR image source is an inert data URL", () => {
  const src = phoneQrSrc('<svg viewBox="0 0 1 1"><path d="M0 0h1"/></svg>');
  assert.match(src, /^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  assert.equal(decodeURIComponent(src.split(",")[1]), '<svg viewBox="0 0 1 1"><path d="M0 0h1"/></svg>');
});
