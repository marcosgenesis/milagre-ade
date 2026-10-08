const { assertPrivate } = require("@milagre/core/private-files");
const fs = require("node:fs/promises");
const path = require("node:path");
const { writePrivate } = require("./relay-identity.cjs");

const MAX_DEVICES = 32;
const KINDS = new Set(["phone", "computer"]);
// lastSeen changes at every hello; the file follows at most this often. A new name is written at once.
const SEEN_WRITE_MS = 60_000;
const time = (value) => (Number.isFinite(value) ? value : null);

function readDevice(value) {
  if (!value || typeof value.key !== "string" || !KINDS.has(value.kind)) return null;
  return {
    key: value.key,
    kind: value.kind,
    name: typeof value.name === "string" && value.name ? value.name : null,
    pairedAt: time(value.pairedAt),
    lastSeen: time(value.lastSeen),
  };
}

/**
 * The phones and computers paired to this Mac, oldest first, in `<dataDir>/devices.json` ({ devices, removed }, 0600).
 * `removed` keeps when each forgotten device was removed, so phone.cjs can keep it from pairing again in the window it
 * was removed in. Reset clears both. When devices.json is missing, the bare key list from before devices had names
 * (relay-phones.json) moves in as nameless phones and is deleted. Writes land in call order, so a clear is never
 * overwritten by an add that started before it. Any method may run before load(): the first one reads the file.
 */
function createDevices(dataDir, { now = Date.now } = {}) {
  const file = path.join(dataDir, "devices.json");
  const legacyFile = path.join(dataDir, "relay-phones.json");
  let devices = [];
  let removed = new Map(); // key -> when it was removed
  let loaded = null;
  let writtenAt = -Infinity;
  let writes = Promise.resolve();
  const write = () => {
    const value = {
      devices: devices.map((device) => ({ ...device })),
      removed: [...removed].map(([key, removedAt]) => ({ key, removedAt })),
    };
    const next = writes.then(() => writePrivate(file, value));
    writes = next.catch(() => {});
    return next;
  };

  async function migrate() {
    let phones;
    try {
      assertPrivate(legacyFile);
      phones = JSON.parse(await fs.readFile(legacyFile, "utf8")).phones;
    } catch {
      return;
    }
    if (!Array.isArray(phones)) return;
    devices = phones
      .filter((key) => typeof key === "string")
      .slice(-MAX_DEVICES)
      .map((key) => ({ key, kind: "phone", name: null, pairedAt: null, lastSeen: null }));
    try {
      await write();
      // Gone once copied: a downgraded daemon must not bring back a phone removed here.
      await fs.rm(legacyFile, { force: true });
    } catch {
      /* kept in memory; the next change writes it */
    }
  }

  async function read() {
    await writes;
    devices = [];
    removed = new Map();
    let value;
    try {
      assertPrivate(file);
      value = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      // Missing: maybe an older list to take over. Unreadable or not private: nothing is known, as before.
      if (error.code === "ENOENT") await migrate();
      return;
    }
    devices = (Array.isArray(value?.devices) ? value.devices : []).map(readDevice).filter(Boolean).slice(-MAX_DEVICES);
    for (const entry of Array.isArray(value?.removed) ? value.removed : [])
      if (typeof entry?.key === "string" && Number.isFinite(entry.removedAt)) removed.set(entry.key, entry.removedAt);
  }
  const ready = () => (loaded ??= read());
  const find = (key) => devices.find((device) => device.key === key);

  return {
    load() {
      loaded = read();
      return loaded;
    },
    isKnown: (key) => devices.some((device) => device.key === key),
    count: () => devices.length,
    list: () => devices.map((device) => ({ ...device })),
    removedAt: (key) => removed.get(key) ?? null,
    async add(key, { kind = "phone", name = null } = {}) {
      if (!KINDS.has(kind)) throw new Error(`Unknown device kind: ${kind}`);
      await ready();
      const at = now();
      const previous = find(key);
      const device = { key, kind, name: name ?? previous?.name ?? null, pairedAt: previous?.pairedAt ?? at, lastSeen: at };
      devices = [...devices.filter((item) => item.key !== key), device].slice(-MAX_DEVICES);
      removed.delete(key);
      writtenAt = at;
      await write();
    },
    /** A known device said hello: when, and its name when it sent a new one. Unknown keys are ignored. */
    async seen(key, { name = null } = {}) {
      await ready();
      const device = find(key);
      if (!device) return;
      const at = now();
      const renamed = name !== null && name !== device.name;
      device.lastSeen = at;
      if (renamed) device.name = name;
      if (!renamed && at - writtenAt < SEEN_WRITE_MS) return;
      writtenAt = at;
      await write();
    },
    /** Forgets a device; false when it wasn't paired. */
    async remove(key) {
      await ready();
      if (!find(key)) return false;
      devices = devices.filter((device) => device.key !== key);
      removed.delete(key);
      removed.set(key, now());
      while (removed.size > MAX_DEVICES) removed.delete(removed.keys().next().value);
      await write();
      return true;
    },
    async clear() {
      await ready();
      devices = [];
      removed = new Map();
      await write();
    },
  };
}

module.exports = { createDevices, MAX_DEVICES };
