import assert from "node:assert/strict";
import test from "node:test";
import { diffState } from "@milagre/shared/state-patch";

// This Mac and one paired computer, each with a Project at the same path, each answering state:read for its own.
const ID = "6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7";
const PATH = "/code/app";
type Listener = (update: any) => void;
const listeners: { project: Listener[]; computer: Listener[] } = { project: [], computer: [] };
const hosts: Record<string, { epoch: string; version: number; state: any; reads: string[] }> = {
  local: { epoch: "mac", version: 0, state: {}, reads: [] },
  [ID]: { epoch: "studio", version: 0, state: {}, reads: [] },
};
const reader = (who: string) => ({
  async readState(scope: string) {
    hosts[who].reads.push(scope);
    return { state: hosts[who].state, version: hosts[who].version, epoch: hosts[who].epoch };
  },
});
(globalThis as any).window = {
  milagre: {
    ...reader("local"),
    onProjectState: (listener: Listener) => (listeners.project.push(listener), () => {}),
    onLinkState: () => () => {},
    onAgentEvent: () => () => {},
    onComputerEvent: (listener: Listener) => (listeners.computer.push(listener), () => {}),
    on: (id: string) => reader(id),
  },
};
const { stateEvents } = await import("./state-events.ts");
const seen: string[] = [];
stateEvents.onProjectState(({ path, state }) => seen.push(`${path} ${(state as any).title}`));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The Mac's next state, sent as a patch the way its daemon sends it (a computer's arrives named, through main). */
function change(who: string, next: any) {
  const host = hosts[who];
  const base = host.version;
  const patch = diffState(host.state, next);
  host.state = next;
  host.version++;
  const numbering = { patch, base, version: host.version, epoch: host.epoch };
  if (who === "local") for (const listener of listeners.project) listener({ path: PATH, ...numbering });
  else for (const listener of listeners.computer) listener({ computerId: who, channel: "project:state", payload: { path: `${who}|${PATH}`, ...numbering } });
}

test("the same path on this Mac and on a computer keeps two states, each read from and patched by its own Mac", async () => {
  hosts.local.state = { title: "mine" };
  hosts.local.version = 3;
  hosts[ID].state = { title: "theirs" };
  hosts[ID].version = 8;
  change("local", { title: "mine 2" });
  change(ID, { title: "theirs 2" });
  await tick();
  await tick();
  assert.deepEqual(hosts.local.reads, [PATH]);
  assert.deepEqual(hosts[ID].reads, [`${ID}|${PATH}`], "the computer's state is read from the computer");
  assert.deepEqual(new Set(seen), new Set([`${PATH} mine 2`, `${ID}|${PATH} theirs 2`]));
  change(ID, { title: "theirs 3" });
  change("local", { title: "mine 3" });
  await tick();
  assert.deepEqual(seen.slice(2), [`${ID}|${PATH} theirs 3`, `${PATH} mine 3`]);
  assert.equal(hosts[ID].reads.length, 1, "a patch applies to the computer's own state without reading it again");
  assert.equal(hosts.local.reads.length, 1);
});
