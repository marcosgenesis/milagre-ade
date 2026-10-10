import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedFolded, createFoldedProjectsStore } from "./folded-projects-store.ts";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test("nothing is folded until a group is folded by hand", async () => {
  const store = createFoldedProjectsStore(storage());
  assert.equal(store.loaded("relay://mac"), false);
  assert.deepEqual([...store.folded("relay://mac")], []);
  await store.load("relay://mac");
  assert.equal(store.loaded("relay://mac"), true);
  assert.deepEqual([...store.folded("relay://mac")], [], "A computer with nothing saved has every group open");
});

test("folds survive a remount and a relaunch, per computer", async () => {
  const disk = storage();
  const first = createFoldedProjectsStore(disk);
  await first.load("relay://mac");
  await first.toggle("relay://mac", "/code/a");
  await first.toggle("relay://mac", "/code/b");
  await first.toggle("relay://mac", "/code/b");
  await first.toggle("https://studio", "/code/c");
  assert.deepEqual([...first.folded("relay://mac")], ["/code/a"], "Folding again opens the group");
  // A relaunch is a new store over the same storage.
  const launch = createFoldedProjectsStore(disk);
  await launch.load("relay://mac");
  await launch.load("https://studio");
  await launch.load("https://other");
  assert.deepEqual([...launch.folded("relay://mac")], ["/code/a"]);
  assert.deepEqual([...launch.folded("https://studio")], ["/code/c"]);
  assert.deepEqual([...launch.folded("https://other")], []);
});

test("a fold made while the saved set is still being read wins", async () => {
  const disk = storage();
  await createFoldedProjectsStore(disk).toggle("relay://mac", "/code/a");
  const launch = createFoldedProjectsStore(disk);
  const reading = launch.load("relay://mac");
  launch.toggle("relay://mac", "/code/b");
  await reading;
  assert.deepEqual([...launch.folded("relay://mac")], ["/code/b"]);
});

test("listeners hear a load and a fold", async () => {
  const store = createFoldedProjectsStore(storage());
  let heard = 0;
  const stop = store.subscribe(() => heard++);
  await store.load("relay://mac");
  store.toggle("relay://mac", "/code/a");
  stop();
  store.toggle("relay://mac", "/code/a");
  assert.equal(heard, 2);
});

test("a broken saved value opens every group", async () => {
  const disk = storage();
  const store = createFoldedProjectsStore(disk);
  await store.toggle("relay://mac", "/code/a");
  for (const key of disk.values.keys()) disk.values.set(key, "{not json");
  const launch = createFoldedProjectsStore(disk);
  await launch.load("relay://mac");
  assert.deepEqual([...launch.folded("relay://mac")], []);
});

test("the saved set keeps the most recent folds under the size limit", () => {
  const many = Array.from({ length: 200 }, (_, index) => `/Users/someone/Code/project-number-${index}`);
  const kept = boundedFolded("relay://mac", many);
  assert.ok(kept.length > 0 && kept.length < many.length);
  assert.equal(kept.at(-1), many.at(-1), "The latest fold is kept");
  assert.ok(new TextEncoder().encode(JSON.stringify({ h: "relay://mac", f: kept })).length <= 1900);
});
