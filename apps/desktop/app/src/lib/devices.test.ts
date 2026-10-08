import assert from "node:assert/strict";
import test from "node:test";
import type { PairedDevice } from "../electron";
import { deviceName, deviceSeenLine, devicesByKind, removeDeviceQuestion } from "./devices.ts";

const device = (over: Partial<PairedDevice> = {}): PairedDevice => ({ key: "k", kind: "phone", name: null, pairedAt: 0, lastSeen: null, route: null, ...over });
const MINUTE = 60_000;

test("a device without a name is called what it is", () => {
  assert.equal(deviceName(device()), "Phone");
  assert.equal(deviceName(device({ kind: "computer" })), "Computer");
  assert.equal(deviceName(device({ name: "Victor's iPhone" })), "Victor's iPhone");
});

test("the line under a device says how it is connected now, or when it was last seen", () => {
  const now = 100 * MINUTE;
  assert.equal(deviceSeenLine(device({ route: "lan", lastSeen: 0 }), now), "Connected now, same network");
  assert.equal(deviceSeenLine(device({ route: "relay" }), now), "Connected now, relay");
  assert.equal(deviceSeenLine(device({ lastSeen: now - 5 * MINUTE }), now), "Last seen 5 min ago");
  assert.equal(deviceSeenLine(device({ lastSeen: now - 10_000 }), now), "Last seen just now");
  assert.equal(deviceSeenLine(device(), now), "Not seen yet");
});

test("removing asks by name and says it can pair again", () => {
  assert.equal(removeDeviceQuestion(device({ name: "studio", kind: "computer" })), "Remove studio? It can pair again from Pair a device.");
  assert.equal(removeDeviceQuestion(device()), "Remove Phone? It can pair again from Pair a device.");
});

test("devices split into computers and phones, connected first, then the most recently seen", () => {
  const old = device({ key: "old", lastSeen: 1 });
  const recent = device({ key: "recent", lastSeen: 5 });
  const live = device({ key: "live", lastSeen: 0, route: "relay" });
  const never = device({ key: "never" });
  const mac = device({ key: "mac", kind: "computer" });
  const { computers, phones } = devicesByKind([old, never, recent, mac, live]);
  assert.deepEqual(
    computers.map((item) => item.key),
    ["mac"],
  );
  assert.deepEqual(
    phones.map((item) => item.key),
    ["live", "recent", "old", "never"],
  );
});
