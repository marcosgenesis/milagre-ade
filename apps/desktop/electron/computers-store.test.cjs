const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createComputersStore, lanRoutesFrom } = require("./computers-store.cjs");

const HOST = "h".repeat(22);
const KEY = "k".repeat(43);

async function store(t, clock = { now: 1000 }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "computers-store-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "computers.json");
  const open = () => createComputersStore({ file, now: () => clock.now });
  return { file, open, clock };
}

test("a computer is saved with this Mac's name for it, renamed, seen and removed", async (t) => {
  const { file, open, clock } = await store(t);
  const computers = open();
  assert.deepEqual(await computers.load(), []);
  const added = await computers.add({ id: "c1", hostId: HOST, name: "  studio‮  ", relay: "wss://relay.milagre.cloud" });
  assert.deepEqual(added, { id: "c1", hostId: HOST, name: "studio", relay: "wss://relay.milagre.cloud", lanRoutes: [], addedAt: 1000, lastSeen: 1000 });
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.equal((await computers.rename("c1", "lab")).name, "lab");
  await assert.rejects(computers.rename("c1", "   "), /Give it a name/);
  await assert.rejects(computers.rename("nope", "x"), /removed/);
  clock.now = 2000;
  await computers.seen("c1");
  clock.now = 3000;
  await computers.seen("c1");
  assert.equal(computers.get("c1").lastSeen, 3000, "in memory at once");
  assert.equal(JSON.parse(await fs.readFile(file, "utf8"))[0].lastSeen, 2000, "on disk at most once a minute");
  const again = open();
  assert.deepEqual(
    (await again.load()).map((computer) => [computer.id, computer.name]),
    [["c1", "lab"]],
  );
  assert.equal(await again.remove("c1"), true);
  assert.equal(await again.remove("c1"), false);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), []);
});

test("LAN routes keep private and loopback addresses only, and a damaged file reads as no computers", async (t) => {
  const { file, open } = await store(t);
  const computers = open();
  await computers.load();
  await computers.add({ id: "c1", hostId: HOST, name: "studio", relay: "wss://relay.milagre.cloud" });
  await computers.setLanRoutes("c1", ["ws://192.168.1.20:8798", "ws://8.8.8.8:8798", "wss://10.0.0.1:8798", "ws://127.0.0.1:5000", 7]);
  assert.deepEqual(computers.get("c1").lanRoutes, ["ws://192.168.1.20:8798", "ws://127.0.0.1:5000"]);
  await fs.writeFile(file, "[{ not json");
  assert.deepEqual(await open().load(), []);
  await fs.writeFile(
    file,
    JSON.stringify([
      { id: "x", hostId: "short", relay: "wss://r" },
      { id: "c2", hostId: HOST, relay: "wss://r", name: "" },
    ]),
  );
  assert.deepEqual(
    (await open().load()).map((computer) => [computer.id, computer.name]),
    [["c2", "Computer"]],
  );
});

test("a peer:routes answer gives LAN routes only when it names the Mac pinned at pairing", () => {
  const answer = { hostId: HOST, key: KEY, lan: ["ws://192.168.1.20:8798", "ws://1.2.3.4:8798"] };
  assert.deepEqual(lanRoutesFrom(answer, { hostId: HOST, hostKey: KEY }), ["ws://192.168.1.20:8798"]);
  assert.equal(lanRoutesFrom({ ...answer, key: "x".repeat(43) }, { hostId: HOST, hostKey: KEY }), null);
  assert.equal(lanRoutesFrom({ ...answer, hostId: "g".repeat(22) }, { hostId: HOST, hostKey: KEY }), null);
  assert.equal(lanRoutesFrom(null, { hostId: HOST, hostKey: KEY }), null);
  assert.deepEqual(lanRoutesFrom({ hostId: HOST, key: KEY }, { hostId: HOST, hostKey: KEY }), []);
});
