const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

function loadPreload() {
  const listeners = new Set();
  let exposed;
  const ipcRenderer = {
    on: (channel, listener) => channel === "computers:event" && listeners.add(listener),
    removeListener: (channel, listener) => channel === "computers:event" && listeners.delete(listener),
    invoke: async () => undefined,
    send() {},
  };
  const original = Module["_load"];
  Module["_load"] = function (request, ...rest) {
    if (request === "electron") return { ipcRenderer, webUtils: {}, contextBridge: { exposeInMainWorld: (_name, value) => (exposed = value) } };
    return original.call(this, request, ...rest);
  };
  const file = path.join(__dirname, "preload.cjs");
  delete require.cache[file];
  try {
    require(file);
  } finally {
    Module["_load"] = original;
  }
  const emit = (event) => {
    for (const listener of [...listeners]) listener({}, event);
  };
  return { bridge: exposed, listeners, emit };
}

test("every computer subscription shares one computers:event listener, filtered per computer and channel", () => {
  const { bridge, listeners, emit } = loadPreload();
  assert.equal(listeners.size, 0);
  const got = [];
  const offs = [];
  for (let i = 0; i < 40; i++) offs.push(bridge.on("a").onProjectState((p) => got.push(["a", p])));
  const offB = bridge.on("b").onProjectState((p) => got.push(["b", p]));
  const all = [];
  const offAll = bridge.onComputerEvent((e) => all.push(e));
  assert.equal(listeners.size, 1, "one ipcRenderer listener however many subscriptions");
  emit({ computerId: "b", channel: "project:state", payload: 1 });
  emit({ computerId: "a", channel: "link:state", payload: 2 });
  assert.deepEqual(got, [["b", 1]]);
  assert.equal(all.length, 2);
  offB();
  emit({ computerId: "b", channel: "project:state", payload: 3 });
  assert.equal(got.length, 1, "unsubscribed callbacks stop hearing");
  for (const off of offs) off();
  offAll();
  assert.equal(listeners.size, 0, "the listener goes with the last subscription");
});
