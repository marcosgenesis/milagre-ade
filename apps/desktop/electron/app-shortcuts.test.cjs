const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { forwardAppShortcuts, isAppShortcut } = require("./app-shortcuts.cjs");

const key = (key, extra = {}) => ({ type: "keyDown", key, meta: true, control: false, shift: true, alt: false, ...extra });

test("only the app's ⌘⇧ shortcuts are forwarded; other keys reach the focused frame", () => {
  assert.equal(isAppShortcut(key("E"), "darwin"), true);
  assert.equal(isAppShortcut(key("s"), "darwin"), true);
  assert.equal(isAppShortcut(key("z"), "darwin"), false, "⌘⇧Z stays redo in the focused frame");
  assert.equal(isAppShortcut(key("E", { shift: false }), "darwin"), false);
  assert.equal(isAppShortcut(key("E", { type: "keyUp" }), "darwin"), false);
  assert.equal(isAppShortcut(key("E", { meta: false, control: true }), "linux"), true);
  assert.equal(isAppShortcut(key("E"), "linux"), false, "⌘ is no shortcut off macOS");
});

test("a forwarded shortcut is kept from the frame and sent to the renderer", () => {
  const contents = new EventEmitter();
  const sent = [];
  contents.send = (...args) => sent.push(args);
  forwardAppShortcuts(contents, "darwin");
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  contents.emit("before-input-event", event, key("E"));
  contents.emit("before-input-event", event, key("a"));
  assert.equal(prevented, 1);
  assert.deepEqual(sent, [["app:shortcut", "e"]]);
});
