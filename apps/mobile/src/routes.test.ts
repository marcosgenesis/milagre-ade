import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouteSupervisor, HOLD_MS } from "./routes.ts";
import type { RelayTransport } from "./relay-transport.ts";
import type { LanRoute } from "./lan-route.ts";

const A = "ws://192.168.1.20:8798";
const B = "ws://10.0.0.7:8798";
const route = (endpoints = [A, B]): LanRoute => ({
  hostId: "H".repeat(22),
  key: "K".repeat(43),
  endpoints,
  learnedAt: 0,
});

type HarnessOptions = {
  answers?: Record<string, boolean>;
  opens?: Record<string, boolean>;
  lan?: LanRoute | undefined;
  closeThrows?: boolean;
};

function harness(options: HarnessOptions = {}) {
  const { answers = { [A]: true, [B]: true }, opens = {}, closeThrows = false } = options;
  // An explicit `lan: undefined` means "no learned route", so it must not fall back to the default.
  const lan = "lan" in options ? options.lan : route();
  const clock = { now: 0 };
  const state = {
    lan,
    answers,
    opens,
    probed: [] as string[],
    opened: [] as string[],
    closed: [] as string[],
    lost: new Map<string, () => void>(),
  };
  const supervisor = createRouteSupervisor({
    lan: () => state.lan,
    probe: async (endpoint, hostId) => {
      state.probed.push(endpoint);
      assert.equal(hostId, "H".repeat(22));
      return state.answers[endpoint] ?? false;
    },
    openLan: async (endpoint, _lan, onLost) => {
      state.opened.push(endpoint);
      if (state.opens[endpoint] === false) throw new Error("hello refused");
      state.lost.set(endpoint, onLost);
      return {
        close: () => {
          state.closed.push(endpoint);
          if (closeThrows) throw new Error("close failed");
        },
      } as unknown as RelayTransport;
    },
    now: () => clock.now,
  });
  return { supervisor, state, clock };
}

test("starts on the primary route and moves to the first LAN endpoint that answers", async () => {
  const { supervisor, state } = harness({ answers: { [A]: false, [B]: true } });
  assert.equal(supervisor.current().kind, "primary");
  const seen: string[] = [];
  supervisor.subscribe((next) => seen.push(next.kind));
  const active = await supervisor.check();
  assert.deepEqual(active.kind === "lan" && active.endpoint, B);
  assert.deepEqual(state.probed.toSorted(), [A, B].toSorted());
  assert.deepEqual(state.opened, [B]);
  assert.deepEqual(seen, ["lan"]);
});

test("no learned route, or nothing answering, stays on the primary route", async () => {
  assert.equal((await harness({ lan: undefined }).supervisor.check()).kind, "primary");
  assert.equal((await harness({ answers: {} }).supervisor.check()).kind, "primary");
});

test("an endpoint that answers but refuses the hello is held back for five minutes", async () => {
  const { supervisor, state, clock } = harness({
    answers: { [A]: true },
    opens: { [A]: false },
    lan: route([A]),
  });
  assert.equal((await supervisor.check()).kind, "primary");
  clock.now = HOLD_MS - 1;
  await supervisor.check();
  assert.deepEqual(state.opened, [A]);
  clock.now = HOLD_MS;
  state.opens[A] = true;
  assert.equal((await supervisor.check()).kind, "lan");
});

test("a lost LAN socket falls back to the primary route without a hold", async () => {
  const { supervisor, state } = harness({ lan: route([A]) });
  await supervisor.check();
  state.lost.get(A)!();
  assert.equal(supervisor.current().kind, "primary");
  assert.equal((await supervisor.check()).kind, "lan");
});

test("on LAN, a check that no longer reaches the endpoint, or finds it unadvertised, falls back", async () => {
  const { supervisor, state } = harness({ lan: route([A]) });
  await supervisor.check();
  state.answers[A] = false;
  assert.equal((await supervisor.check()).kind, "primary");
  assert.deepEqual(state.closed, [A]);
  state.answers[A] = true;
  await supervisor.check();
  state.lan = route([B]);
  state.answers[B] = false;
  assert.equal((await supervisor.check()).kind, "primary");
});

test("a probe answered by another Mac (hostId mismatch) is not a route", async () => {
  // The native probe returns false on a hostId mismatch; here that is an endpoint that does not answer.
  const { supervisor, state } = harness({ answers: { [A]: false, [B]: false } });
  assert.equal((await supervisor.check()).kind, "primary");
  assert.deepEqual(state.opened, []);
});

test("suspend closes the LAN socket but keeps the route; concurrent checks share one walk", async () => {
  const { supervisor, state } = harness({ lan: route([A]) });
  await Promise.all([supervisor.check(), supervisor.check()]);
  assert.deepEqual(state.opened, [A]);
  supervisor.suspend();
  assert.deepEqual(state.closed, [A]);
  assert.equal(supervisor.current().kind, "lan");
  assert.equal((await supervisor.check()).kind, "lan");
});

test("close() drops the LAN socket, and a walk still in flight opens nothing", async () => {
  const first = harness({ lan: route([A]) });
  await first.supervisor.check();
  first.supervisor.close();
  assert.equal(first.supervisor.current().kind, "primary");
  assert.deepEqual(first.state.closed, [A]);
  const second = harness({ lan: route([A]) });
  const walking = second.supervisor.check();
  second.supervisor.close();
  await walking;
  assert.equal(second.supervisor.current().kind, "primary");
  assert.deepEqual(second.state.opened, []);
});

test("a transport whose close() throws cannot stick the supervisor on LAN", async () => {
  const lost = harness({ lan: route([A]), closeThrows: true });
  const seen: string[] = [];
  lost.supervisor.subscribe((next) => seen.push(next.kind));
  await lost.supervisor.check();
  assert.doesNotThrow(() => lost.state.lost.get(A)!());
  assert.equal(lost.supervisor.current().kind, "primary");
  assert.deepEqual(seen, ["lan", "primary"]);
  assert.equal((await lost.supervisor.check()).kind, "lan");

  const unreachable = harness({ lan: route([A]), closeThrows: true });
  await unreachable.supervisor.check();
  unreachable.state.answers[A] = false;
  assert.equal((await unreachable.supervisor.check()).kind, "primary");

  const suspended = harness({ lan: route([A]), closeThrows: true });
  await suspended.supervisor.check();
  assert.doesNotThrow(() => suspended.supervisor.suspend());
  assert.doesNotThrow(() => suspended.supervisor.close());
  assert.equal(suspended.supervisor.current().kind, "primary");
});
