const fs = require("node:fs/promises");
const { helloName } = require("@milagre/shared/relay-crypto");
const { writePrivate } = require("@milagre/daemon/relay-identity");

// lastSeen moves with every connection; the file follows at most this often.
const SEEN_WRITE_MS = 60_000;
const MAX_LAN_ROUTES = 4;
const HOST_ID = /^[A-Za-z0-9_-]{22}$/;
// A computer's id here; no "|", which PR 4's stored chat keys use (`${computerId}|${key}`).
const ID = /^[A-Za-z0-9-]{1,64}$/;
// A LAN route: a private address, as the phone takes (apps/mobile/src/lan-route.ts), or this Mac's loopback, which
// reaches only this Mac and still has to pass the probe's host id and the hello's pinned key (the end-to-end tests).
const LAN_ROUTE = /^ws:\/\/(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168|127\.0)\.\d{1,3}\.\d{1,3}:\d{1,5}$/;

const lanRoutesOf = (value) => (Array.isArray(value) ? value.filter((url) => typeof url === "string" && LAN_ROUTE.test(url)).slice(0, MAX_LAN_ROUTES) : []);
const time = (value) => (Number.isFinite(value) ? value : null);
const copy = (computer) => ({ ...computer, lanRoutes: [...computer.lanRoutes] });

function readComputer(value) {
  if (!value || typeof value.id !== "string" || !ID.test(value.id) || !HOST_ID.test(String(value.hostId)) || typeof value.relay !== "string") return null;
  return {
    id: value.id,
    hostId: String(value.hostId),
    name: helloName(value.name) ?? "Computer",
    relay: value.relay,
    lanRoutes: lanRoutesOf(value.lanRoutes),
    addedAt: time(value.addedAt),
    lastSeen: time(value.lastSeen),
  };
}

/** The LAN routes in a computer's peer:routes answer, only when it names the Mac pinned at pairing; null otherwise. */
function lanRoutesFrom(answer, { hostId, hostKey }) {
  if (!answer || answer.hostId !== hostId || answer.key !== hostKey) return null;
  return lanRoutesOf(answer.lan);
}

/**
 * The computers this Mac drives, oldest first, in `<userData>/computers.json` (0600): `[{ id, hostId, name, relay,
 * lanRoutes, addedAt, lastSeen }]`. `name` is this Mac's label ("Show it as"), sent nowhere. The Mac's pinned key and its
 * pairing token are secrets and live in computer-keys.cjs. Writes land in call order.
 */
function createComputersStore({ file, now = Date.now }) {
  let computers = [];
  let writes = Promise.resolve();
  const seenWritten = new Map();
  const write = () => {
    const value = computers.map(copy);
    const next = writes.then(() => writePrivate(file, value));
    writes = next.catch(() => {});
    return next;
  };
  const find = (id) => computers.find((computer) => computer.id === id);
  const list = () => computers.map(copy);
  return {
    async load() {
      try {
        const value = JSON.parse(await fs.readFile(file, "utf8"));
        computers = (Array.isArray(value) ? value : []).map(readComputer).filter((computer) => computer !== null);
      } catch {
        computers = [];
      }
      return list();
    },
    list,
    get(id) {
      const computer = find(id);
      return computer ? copy(computer) : null;
    },
    async add({ id, hostId, name, relay }) {
      const computer = readComputer({ id, hostId, name, relay, lanRoutes: [], addedAt: now(), lastSeen: now() });
      if (!computer) throw new Error("That computer's link is damaged.");
      computers = [...computers.filter((item) => item.id !== id), computer];
      await write();
      return copy(computer);
    },
    async rename(id, name) {
      const computer = find(id);
      if (!computer) throw new Error("That computer was removed.");
      const next = helloName(name);
      if (!next) throw new Error("Give it a name.");
      computer.name = next;
      await write();
      return copy(computer);
    },
    async setLanRoutes(id, routes) {
      const computer = find(id);
      if (!computer) return;
      const next = lanRoutesOf(routes);
      if (JSON.stringify(next) === JSON.stringify(computer.lanRoutes)) return;
      computer.lanRoutes = next;
      await write();
    },
    async seen(id) {
      const computer = find(id);
      if (!computer) return;
      const at = now();
      computer.lastSeen = at;
      if (at - (seenWritten.get(id) ?? -Infinity) < SEEN_WRITE_MS) return;
      seenWritten.set(id, at);
      await write();
    },
    async remove(id) {
      if (!find(id)) return false;
      computers = computers.filter((computer) => computer.id !== id);
      seenWritten.delete(id);
      await write();
      return true;
    },
  };
}

module.exports = { createComputersStore, lanRoutesFrom };
