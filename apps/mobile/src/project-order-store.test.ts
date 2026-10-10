import { test } from "node:test";
import assert from "node:assert/strict";
import { applyProjectOrder, createProjectOrderStore } from "./project-order-store.ts";

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
const paths = (items: { path: string }[]) => items.map((item) => item.path);
const list = (...names: string[]) => names.map((name) => ({ path: `/code/${name}`, name }));

test("the saved order holds against the Mac's recent order, drops gone Projects and puts new ones on top", () => {
  assert.deepEqual(paths(applyProjectOrder(["/code/a", "/code/b", "/code/c"], list("c", "a", "b"))), ["/code/a", "/code/b", "/code/c"]);
  assert.deepEqual(paths(applyProjectOrder(["/code/a", "/code/b", "/code/c"], list("c", "a"))), ["/code/a", "/code/c"]);
  assert.deepEqual(paths(applyProjectOrder(["/code/a", "/code/b"], list("b", "d", "a"))), ["/code/d", "/code/a", "/code/b"]);
  assert.deepEqual(paths(applyProjectOrder([], list("x", "y"))), ["/code/x", "/code/y"]);
});

test("applying keeps each Project's own fields", () => {
  const projects = [{ path: "/code/a", name: "A", hidden: true }];
  assert.deepEqual(applyProjectOrder(["/code/a"], projects), projects);
});

test("each computer keeps its own order across launches", async () => {
  const disk = storage();
  const first = createProjectOrderStore(disk);
  await first.save("relay://mac", ["/code/b", "/code/a"]);
  await first.save("https://studio", ["/code/a", "/code/b"]);
  // A new launch is a new store over the same storage.
  const launch = createProjectOrderStore(disk);
  assert.deepEqual(paths(await launch.apply("relay://mac", list("a", "b"))), ["/code/b", "/code/a"]);
  assert.deepEqual(paths(await launch.apply("https://studio", list("b", "a"))), ["/code/a", "/code/b"]);
  assert.deepEqual(paths(await launch.apply("https://other", list("b", "a"))), ["/code/b", "/code/a"], "A computer without a saved order keeps the Mac's");
});

test("a damaged or failing storage leaves the Mac's order", async () => {
  const disk = storage();
  disk.values.set("milagre.project-order.v1", "{not json");
  assert.deepEqual(paths(await createProjectOrderStore(disk).apply("h", list("a", "b"))), ["/code/a", "/code/b"]);
  const broken = createProjectOrderStore({
    getItemAsync: async () => {
      throw new Error("locked");
    },
    setItemAsync: async () => {},
  });
  assert.deepEqual(paths(await broken.apply("h", list("a", "b"))), ["/code/a", "/code/b"]);
  await broken.save("h", ["/code/a"]);
});

test("the oldest computers are forgotten past twelve", async () => {
  const disk = storage();
  const store = createProjectOrderStore(disk);
  for (let i = 0; i < 14; i++) await store.save(`host-${i}`, ["/code/a"]);
  const saved = JSON.parse(disk.values.get("milagre.project-order.v1")!);
  assert.equal(Object.keys(saved).length, 12);
  assert.ok(!("host-0" in saved) && "host-13" in saved);
});
