import assert from "node:assert/strict";
import test from "node:test";
import { applyAgentEvent, chatInProject, chatKey, startRun } from "./agent-runs.ts";
import { changeProject, createProjectSwitcher, stopTurns } from "./project-switch.ts";
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

test("a turn that starts during the stop wait is stopped too, and the switch waits for it", async () => {
  const running = new Set(["/a#1"]);
  const calls: string[] = [];
  let waits = 0;
  const ended = await stopTurns({
    chatIds: [...running],
    interrupt: async (chatId) => { calls.push(`interrupt ${chatId}`); },
    remaining: () => [...running],
    sleep: async () => {
      waits += 1;
      // The first wait: chat 1 ends and a turn starts in chat 4 (one the agent began itself). Then chat 4 ends.
      if (waits === 1) {
        running.delete("/a#1");
        running.add("/a#4");
      } else running.delete("/a#4");
    },
  });

  assert.equal(ended, true);
  assert.deepEqual(calls, ["interrupt /a#1", "interrupt /a#4"]);
});

// What a switch touches, recorded in order. `running` is whether a turn runs in the open project.
function fakes(overrides: { running?: () => boolean; load?: () => Promise<{ path: string } | null>; stop?: (path: string) => Promise<void>; asked?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    options: {
      currentPath: "/a",
      load: overrides.load ?? (async () => { calls.push("load"); return { path: "/b" }; }),
      mayStop: () => overrides.asked === true || !(overrides.running?.() ?? false),
      ask: (project: { path: string }) => { calls.push(`ask ${project.path}`); },
      stop: overrides.stop ?? (async (path: string) => { calls.push(`stop ${path}`); }),
      adopt: (project: { path: string }) => { calls.push(`adopt ${project.path}`); },
    },
  };
}

test("a switch stops the open project's turns only once the new project has loaded, then opens it", async () => {
  // The user was asked (or nothing ran): the turns are stopped, then the project shows.
  for (const [label, overrides] of [["asked", { running: () => true, asked: true }], ["nothing running", {}]] as const) {
    const { calls, options } = fakes(overrides);
    assert.deepEqual(await changeProject(options), { path: "/b" }, label);
    assert.deepEqual(calls, ["load", "stop /a", "adopt /b"], label);
  }
});

test("a turn that starts while the dialog is open makes the switch ask instead of stopping it", async () => {
  let running = false;
  const { calls, options } = fakes({
    running: () => running,
    // The dialog is not modal: a message is sent from the window while it is open.
    load: async () => {
      calls.push("load");
      running = true;
      return { path: "/b" };
    },
  });

  assert.equal(await changeProject(options), null);
  assert.deepEqual(calls, ["load", "ask /b"]);
});

test("a cancelled dialog, the same project or a refused switch leaves the turns running", async () => {
  for (const [label, load] of [
    ["cancelled", async () => null],
    ["same project", async () => ({ path: "/a" })],
  ] as const) {
    const { calls, options } = fakes({ running: () => true, asked: true, load });
    assert.equal(await changeProject(options), null, label);
    assert.deepEqual(calls, [], label);
  }

  const { calls, options } = fakes({ running: () => true, asked: true, load: async () => { throw new Error("That folder isn't a project"); } });
  await assert.rejects(changeProject(options), /That folder isn't a project/);
  assert.deepEqual(calls, []);
});

test("sends are refused while the turns are stopped for a switch, and go again once it is over", async () => {
  const switcher = createProjectSwitcher();
  const seen: string[] = [];
  const { options } = fakes({
    load: async () => {
      // While the dialog is open the window keeps working (a turn started now makes the switch ask).
      seen.push(`dialog: ${switcher.canSend()}`);
      return { path: "/b" };
    },
    stop: async () => {
      // A message sent during the stop wait would start a turn behind the stop: it is refused.
      seen.push(`stop wait: ${switcher.canSend()}`);
    },
  });

  await switcher.change(options);

  assert.deepEqual(seen, ["dialog: true", "stop wait: false"]);
  assert.equal(switcher.canSend(), true);

  // A switch that fails while stopping lets sends go again too.
  const failing = fakes({ stop: async () => { throw new Error("boom"); } });
  await assert.rejects(switcher.change(failing.options), /boom/);
  assert.equal(switcher.canSend(), true);
});

test("one switch at a time: a second one while the first runs is ignored", async () => {
  const switcher = createProjectSwitcher();
  let finishLoad: (project: { path: string }) => void = () => {};
  const first = fakes({ load: () => new Promise((resolve) => { finishLoad = resolve; }) });
  const second = fakes();

  const running = switcher.change(first.options);
  assert.equal(await switcher.change(second.options), undefined);
  assert.deepEqual(second.calls, []);
  finishLoad({ path: "/b" });
  assert.deepEqual(await running, { path: "/b" });
  assert.deepEqual(first.calls, ["stop /a", "adopt /b"]);
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
