import assert from "node:assert/strict";
import test from "node:test";
import { projectRows, runningChat, switchQuestion, switchStep, type RecentProject } from "./project-list.ts";

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
  assert.deepEqual(projectRows({ recent, currentPath: "/code/happiergym" }).map((row) => [row.name, row.current]), [
    ["milagre-ade", false],
    ["happiergym", true],
    ["rd-mobile", false],
  ]);
});

test("the open project is always a row, first when the list doesn't have it", () => {
  assert.deepEqual(projectRows({ recent, currentPath: "/tmp/plain folder", currentName: "plain folder" }).map((row) => [row.name, row.current]), [
    ["plain folder", true],
    ["milagre-ade", false],
    ["happiergym", false],
    ["rd-mobile", false],
  ]);
  // Before the list loads, the menu shows the open project alone.
  assert.deepEqual(projectRows({ recent: [], currentPath: "/code/milagre-ade", currentName: "milagre-ade" }), [
    { path: "/code/milagre-ade", name: "milagre-ade", initial: "M", current: true },
  ]);
  // Its name comes from the folder when none is given.
  assert.equal(projectRows({ recent: [], currentPath: "/code/repo" })[0].name, "repo");
});

test("a project listed twice shows once, and an empty name falls back to M", () => {
  const rows = projectRows({ recent: [...recent, recent[1], { path: "/code/blank", name: "  ", openedAt: "" }], currentPath: "/code/milagre-ade" });
  assert.deepEqual(rows.map((row) => row.path), ["/code/milagre-ade", "/code/happiergym", "/code/rd-mobile", "/code/blank"]);
  assert.equal(rows[3].initial, "M");
});

test("a switch asks first only while a turn is running", () => {
  const happiergym = { kind: "project", path: "/code/happiergym" } as const;
  const rdMobile = { kind: "project", path: "/code/rd-mobile" } as const;
  const open = { kind: "open" } as const;
  const loaded = { kind: "loaded", path: "/code/picked", name: "picked" } as const;

  // Nothing running: every click goes at once.
  assert.deepEqual(switchStep(null, happiergym, false), { go: happiergym });
  assert.deepEqual(switchStep(null, open, false), { go: open });

  // A turn running: the first click asks, a second click on the same choice goes.
  assert.deepEqual(switchStep(null, happiergym, true), { ask: happiergym });
  assert.deepEqual(switchStep(happiergym, { kind: "project", path: "/code/happiergym" }, true), { go: happiergym });
  assert.deepEqual(switchStep(null, open, true), { ask: open });
  assert.deepEqual(switchStep(open, open, true), { go: open });
  // A project picked in the dialog while a turn started is asked about the same way.
  assert.deepEqual(switchStep(loaded, { kind: "loaded", path: "/code/picked", name: "picked" }, true), { go: loaded });

  // Picking something else after the question asks about that instead.
  assert.deepEqual(switchStep(happiergym, rdMobile, true), { ask: rdMobile });
  assert.deepEqual(switchStep(happiergym, open, true), { ask: open });
  assert.deepEqual(switchStep(open, happiergym, true), { ask: happiergym });
  assert.deepEqual(switchStep(loaded, open, true), { ask: open });

  // The turn ended after the question: the next click goes where it points.
  assert.deepEqual(switchStep(happiergym, rdMobile, false), { go: rdMobile });
});

test("the question names the chat whose turn is running, or that waits for you", () => {
  assert.equal(runningChat([]), null);
  assert.equal(runningChat([{ label: "Idle", mark: "idle" }, { label: "Read", mark: "unread" }, { label: "Plain" }]), null);
  assert.deepEqual(runningChat([{ label: "Read", mark: "unread" }, { label: "Fix login", mark: "running" }, { label: "Ask", mark: "waiting" }]), { title: "Fix login", waiting: false });
  // A turn waiting on an approval or a question is still running; the most recent chat is named.
  assert.deepEqual(runningChat([{ label: "Ask", mark: "waiting" }, { label: "Fix login", mark: "running" }]), { title: "Ask", waiting: true });

  assert.equal(switchQuestion({ title: "Fix login", waiting: false }), "A turn is running in Fix login. Switch anyway?");
  // A chat named after a sentence keeps its own end mark instead of gaining a second one.
  assert.equal(switchQuestion({ title: "Reply with just the word gamma.", waiting: false }), "A turn is running in Reply with just the word gamma. Switch anyway?");
  assert.equal(switchQuestion({ title: "Why does login fail? ", waiting: false }), "A turn is running in Why does login fail? Switch anyway?");

  // Waiting on an approval or a question.
  assert.equal(switchQuestion({ title: "Fix login", waiting: true }), "Fix login is waiting for you. Switch anyway?");
  assert.equal(switchQuestion({ title: "Reply with just the word gamma.", waiting: true }), "Reply with just the word gamma is waiting for you. Switch anyway?");
});
