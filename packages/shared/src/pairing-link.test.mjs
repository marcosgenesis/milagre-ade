import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePairing, validRelay } from "./pairing-link.mjs";

const token = "a".repeat(64);
const hostId = "h".repeat(22);
const key = "k".repeat(43);
const link = (relay, name = "studio") =>
  `milagre://pair?relay=${encodeURIComponent(relay)}&host=${hostId}&key=${key}&token=${token}&name=${encodeURIComponent(name)}`;

test("a relay link reads as the phone always read it", () => {
  assert.deepEqual(parsePairing(link("wss://relay.milagre.cloud")), {
    address: `relay://${hostId}`,
    token,
    name: "studio",
    relay: { url: "wss://relay.milagre.cloud", hostId, key },
  });
  assert.equal(parsePairing(link("wss://relay.milagre.cloud", "")).name, "Mac");
  assert.throws(() => parsePairing("https://example.com/pair?token=x"), /not a Milagre pairing link/);
});

test("a relay on this machine is read only when asked, and only on 127.0.0.1", () => {
  assert.throws(() => parsePairing(link("ws://127.0.0.1:8080")), /damaged/);
  assert.equal(parsePairing(link("ws://127.0.0.1:8080"), { allowLocalRelay: true }).relay.url, "ws://127.0.0.1:8080");
  assert.throws(() => parsePairing(link("ws://192.168.1.20:8080"), { allowLocalRelay: true }), /damaged/);
  assert.throws(() => validRelay({ url: "ws://127.0.0.1:8080", hostId, key }), /damaged/);
});
