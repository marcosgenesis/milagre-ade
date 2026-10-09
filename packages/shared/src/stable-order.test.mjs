import assert from "node:assert/strict";
import test from "node:test";
import { keepOrder } from "./stable-order.mjs";

test("keepOrder keeps rows in place when the host's recent list reorders", () => {
  const shown = [{ path: "/a" }, { path: "/b" }, { path: "/c" }];
  const reloaded = [{ path: "/c", name: "C" }, { path: "/a" }, { path: "/b" }];
  assert.deepEqual(
    keepOrder(shown, reloaded, (item) => item.path),
    [{ path: "/a" }, { path: "/b" }, { path: "/c", name: "C" }],
  );
});

test("keepOrder puts new rows on top and drops removed ones", () => {
  const shown = [{ path: "/a" }, { path: "/b" }];
  assert.deepEqual(
    keepOrder(shown, [{ path: "/b" }, { path: "/d" }], (item) => item.path),
    [{ path: "/d" }, { path: "/b" }],
  );
});
