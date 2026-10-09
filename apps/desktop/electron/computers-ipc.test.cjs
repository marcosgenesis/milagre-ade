const test = require("node:test");
const assert = require("node:assert/strict");
const { registerComputers } = require("./computers-ipc.cjs");

const studio = {
  id: "c1",
  name: "studio",
  hostId: "h".repeat(22),
  relayHost: "relay.milagre.cloud",
  state: "online",
  route: "lan",
  lastSeen: 1,
  addedAt: 1,
  message: null,
  lan: true,
  lanRoutes: ["ws://192.168.1.5:8798"],
};

/** ipcMain as computers-ipc.cjs uses it, and a window that records what it is sent. */
function setup(computers) {
  const handlers = new Map();
  const sent = [];
  const windowSent = [];
  const sender = { isDestroyed: () => false, send: (channel, payload) => windowSent.push([channel, payload]) };
  const ipc = registerComputers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    computers: { loaded: Promise.resolve(), list: () => [studio], ...computers },
    thisMac: () => "victor-mbp",
    send: (channel, payload) => sent.push([channel, payload]),
  });
  const call = (channel, ...args) => handlers.get(channel)({ sender }, ...args);
  return { ipc, call, sent, windowSent, handlers };
}

test("the window reads this Mac's name with the computers, and hears each change", async () => {
  const { ipc, call, sent } = setup({});
  assert.deepEqual(await call("computers:list"), { thisMac: "victor-mbp", computers: [studio] });
  ipc.changed();
  assert.deepEqual(sent, [["computers:changed", { thisMac: "victor-mbp", computers: [studio] }]]);
});

test("adding tells the asking window when the other Mac asks its owner, and a refusal comes back as words and a code", async () => {
  const calls = [];
  const { call, windowSent } = setup({
    async add(link, options, { onPending }) {
      calls.push([link, options]);
      onPending();
      if (link === "bad") throw Object.assign(new Error("studio didn't allow this Mac."), { code: "denied" });
      return studio;
    },
  });
  assert.deepEqual(await call("computers:add", "milagre://pair?x", { name: "Studio" }), { ok: true, computer: studio });
  assert.deepEqual(calls, [["milagre://pair?x", { name: "Studio" }]]);
  assert.deepEqual(windowSent, [["computers:pending", undefined]]);
  assert.deepEqual(await call("computers:add", "bad", {}), { ok: false, code: "denied", message: "studio didn't allow this Mac." });
  assert.deepEqual(await call("computers:add", "plain", { name: 7 }), { ok: true, computer: studio });
  assert.deepEqual(calls.at(-1), ["plain", { name: undefined }], "a name that isn't text is left out");
});

test("a computer's runtime events reach every window tagged with it, and a call goes to its runtime", async () => {
  const invoked = [];
  const { ipc, call, sent } = setup({ invoke: async (id, method, args) => (invoked.push([id, method, args]), { ok: 1 }) });
  ipc.event("c1", "project:state", { path: "/p" });
  assert.deepEqual(sent, [["computers:event", { computerId: "c1", channel: "project:state", payload: { path: "/p" } }]]);
  assert.deepEqual(await call("computers:invoke", "c1", "project:recent", undefined), { ok: 1 });
  assert.deepEqual(invoked, [["c1", "project:recent", []]]);
});
