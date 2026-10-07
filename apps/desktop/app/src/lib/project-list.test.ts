import assert from "node:assert/strict";
import test from "node:test";
import { projectRows, type RecentProject } from "./project-list.ts";

const recent: RecentProject[] = [
  { path: "/code/milagre-ade", name: "milagre-ade", openedAt: "2026-10-02T10:00:00.000Z" },
  { path: "/code/happiergym", name: "happiergym", openedAt: "2026-10-01T10:00:00.000Z" },
  { path: "/code/rd-mobile", name: "rd-mobile", openedAt: "2026-09-30T10:00:00.000Z" },
];

test("the rows follow the recent list, with the open project checked", () => {
  assert.deepEqual(projectRows({ recent, currentPath: "/code/milagre-ade" }), [
    { path: "/code/milagre-ade", name: "milagre-ade", initial: "M", current: true },
    { path: "/code/happiergym", name: "happiergym", initial: "H", current: false },
    { path: "/code/rd-mobile", name: "rd-mobile", initial: "R", current: false },
  ]);
  assert.deepEqual(
    projectRows({ recent, currentPath: "/code/happiergym" }).map((row) => [row.name, row.current]),
    [
      ["milagre-ade", false],
      ["happiergym", true],
      ["rd-mobile", false],
    ],
  );
});

test("the open project is always a row, first when the list doesn't have it", () => {
  assert.deepEqual(
    projectRows({ recent, currentPath: "/tmp/plain folder", currentName: "plain folder" }).map((row) => [row.name, row.current]),
    [
      ["plain folder", true],
      ["milagre-ade", false],
      ["happiergym", false],
      ["rd-mobile", false],
    ],
  );
  // Before the list loads, the menu shows the open project alone.
  assert.deepEqual(projectRows({ recent: [], currentPath: "/code/milagre-ade", currentName: "milagre-ade" }), [
    { path: "/code/milagre-ade", name: "milagre-ade", initial: "M", current: true },
  ]);
  // Its name comes from the folder when none is given.
  assert.equal(projectRows({ recent: [], currentPath: "/code/repo" })[0].name, "repo");
});

test("a project listed twice shows once, and an empty name falls back to M", () => {
  const rows = projectRows({ recent: [...recent, recent[1], { path: "/code/blank", name: "  ", openedAt: "" }], currentPath: "/code/milagre-ade" });
  assert.deepEqual(
    rows.map((row) => row.path),
    ["/code/milagre-ade", "/code/happiergym", "/code/rd-mobile", "/code/blank"],
  );
  assert.equal(rows[3].initial, "M");
});
