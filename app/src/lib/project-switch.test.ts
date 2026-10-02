import assert from "node:assert/strict";
import test from "node:test";
import { applyAgentEvent, chatInProject, chatKey, startRun } from "./agent-runs.ts";
import { changeProject, stopTurns } from "./project-switch.ts";
import type { CoordinatorState } from "../model";

const instant = async () => {};

test("leaving a project stops its turns and waits until they have ended", async () => {
  const running = new Set(["/a#1", "/a#4"]);
  const calls: string[] = [];
  const sleeps: number[] = [];
  const ended = await stopTurns({
    chatIds: [...running],
    interrupt: async (chatId) => { calls.push(`interrupt ${chatId}`); },
    remaining: () => [...running],
    // Each wait lets one turn end, as its cancelled event arrives.
    sleep: async (ms) => {
      sleeps.push(ms);
      const [first] = running;
      running.delete(first);
    },
  });

  assert.equal(ended, true);
  assert.deepEqual(calls, ["interrupt /a#1", "interrupt /a#4"]);
  assert.deepEqual(sleeps, [100, 100]);
});

test("with no turn running nothing is interrupted", async () => {
  const calls: string[] = [];
  assert.equal(await stopTurns({ chatIds: [], interrupt: async (id) => { calls.push(id); }, remaining: () => [], sleep: instant }), true);
  assert.deepEqual(calls, []);
});

test("a turn that won't end doesn't hold the switch past the timeout", async () => {
  let waited = 0;
  const ended = await stopTurns({
    chatIds: ["/a#1"],
    // An interrupt that fails is the same as one whose turn never ends.
    interrupt: async () => { throw new Error("gone"); },
    remaining: () => ["/a#1"],
    timeoutMs: 1000,
    pollMs: 250,
    sleep: async (ms) => { waited += ms; },
  });

  assert.equal(ended, false);
  assert.equal(waited, 1000);
});

test("a switch stops the open project's turns only once the new project has loaded, then opens it", async () => {
  const calls: string[] = [];
  const opened = await changeProject({
    currentPath: "/a",
    load: async () => { calls.push("load"); return { path: "/b" }; },
    stop: async (projectPath) => { calls.push(`stop ${projectPath}`); },
    adopt: (project) => { calls.push(`adopt ${project.path}`); },
  });

  assert.deepEqual(opened, { path: "/b" });
  assert.deepEqual(calls, ["load", "stop /a", "adopt /b"]);
});

test("a cancelled dialog, the same project or a refused switch leaves the turns running", async () => {
  for (const [label, load] of [
    ["cancelled", async () => null],
    ["same project", async () => ({ path: "/a" })],
  ] as const) {
    const calls: string[] = [];
    const opened = await changeProject({ currentPath: "/a", load, stop: async (path) => { calls.push(`stop ${path}`); }, adopt: (project) => { calls.push(`adopt ${project.path}`); } });
    assert.equal(opened, null, label);
    assert.deepEqual(calls, [], label);
  }

  const calls: string[] = [];
  await assert.rejects(changeProject({
    currentPath: "/a",
    load: async () => { throw new Error("That folder isn't a project"); },
    stop: async (path) => { calls.push(`stop ${path}`); },
    adopt: (project: { path: string }) => { calls.push(`adopt ${project.path}`); },
  }), /That folder isn't a project/);
  assert.deepEqual(calls, []);
});

function state(chatIds: number[]): CoordinatorState {
  return {
    next_id: 10,
    worktrees: { 1: { id: 1, name: "main", path: "/repo", branch: "main" } },
    sessions: Object.fromEntries(chatIds.map((id) => [id, { id, worktree_id: 1, agent_name: "main", status: "Created" }])),
    messages: chatIds.map((id) => ({ id: id + 100, session_id: id, body: "hi", context: null, role: "user" as const })),
    connections: {},
    events: [],
  } as unknown as CoordinatorState;
}

test("two projects that both have a chat 1 never share its key or its events", () => {
  const a = chatKey("/code/a", 1);
  const b = chatKey("/code/b", 1);
  assert.notEqual(a, b);
  assert.equal(chatInProject("/code/a", b), false);
  // A project whose path starts with another's is still another project.
  assert.equal(chatInProject("/code/a", chatKey("/code/ab", 1)), false);

  // A turn ending in project a's chat 1 changes nothing in project b, whose chat 1 also exists.
  const runs = startRun({}, a, "claude-haiku-4-5");
  const inB = applyAgentEvent(state([1]), runs, "/code/b", a, { type: "turn-completed" });
  assert.equal(inB.changed, false);
  assert.equal(inB.runs, runs);
  const inA = applyAgentEvent(state([1]), runs, "/code/a", a, { type: "turn-completed" });
  assert.equal(inA.changed, true);
  assert.deepEqual(Object.keys(inA.runs), []);
});
