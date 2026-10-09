const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createPowerBlocker } = require("./power.cjs");
const { KeepAwake } = require("@milagre/core/keep-awake");

test("overlapping turns hold one macOS assertion and release it after the final turn", () => {
  const children = [];
  const blocker = createPowerBlocker({
    platform: "darwin",
    spawn(command, args) {
      assert.equal(command, "/usr/bin/caffeinate");
      assert.deepEqual(args, ["-i", "-w", String(process.pid)]);
      const child = new EventEmitter();
      child.unref = () => {};
      child.kill = (signal) => {
        child.signal = signal;
      };
      children.push(child);
      return child;
    },
  });
  const awake = new KeepAwake({ powerSaveBlocker: blocker });
  awake.turnStarted("a");
  awake.turnStarted("b");
  assert.equal(children.length, 1);
  awake.turnEnded("a");
  assert.equal(children[0].signal, undefined);
  awake.turnEnded("b");
  assert.equal(children[0].signal, "SIGTERM");
  awake.turnStarted("c");
  awake.quit();
  assert.equal(children[1].signal, "SIGTERM");
});
