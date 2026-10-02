const assert = require("node:assert/strict");
const test = require("node:test");
const { KeepAwake } = require("./keep-awake.cjs");

function fakeBlocker() {
  const active = new Set();
  let next = 1;
  return {
    started: [],
    stopped: [],
    start(type) {
      const id = next++;
      active.add(id);
      this.started.push(type);
      return id;
    },
    stop(id) {
      active.delete(id);
      this.stopped.push(id);
    },
    isStarted: (id) => active.has(id),
    get held() {
      return active.size;
    },
  };
}

test("one blocker holds for overlapping turns and stops after the last", () => {
  const blocker = fakeBlocker();
  const awake = new KeepAwake({ powerSaveBlocker: blocker });
  awake.turnStarted("a");
  awake.turnStarted("b");
  assert.deepEqual(blocker.started, ["prevent-app-suspension"]);
  assert.equal(blocker.held, 1);
  awake.turnEnded("a");
  assert.equal(blocker.held, 1);
  awake.turnEnded("b");
  assert.equal(blocker.held, 0);
});

test("a repeated start for one chat does not stack", () => {
  const blocker = fakeBlocker();
  const awake = new KeepAwake({ powerSaveBlocker: blocker });
  awake.turnStarted("a");
  awake.turnStarted("a");
  awake.turnEnded("a");
  assert.equal(blocker.held, 0);
  assert.equal(blocker.started.length, 1);
});

test("a second turn after the first ended takes a fresh blocker", () => {
  const blocker = fakeBlocker();
  const awake = new KeepAwake({ powerSaveBlocker: blocker });
  awake.turnStarted("a");
  awake.turnEnded("a");
  awake.turnStarted("a");
  assert.equal(blocker.started.length, 2);
  assert.equal(blocker.held, 1);
});

test("an ending that never had a start does nothing", () => {
  const blocker = fakeBlocker();
  const awake = new KeepAwake({ powerSaveBlocker: blocker });
  awake.turnEnded("a");
  assert.equal(blocker.stopped.length, 0);
});

test("with the setting off no blocker starts", () => {
  const blocker = fakeBlocker();
  const awake = new KeepAwake({ powerSaveBlocker: blocker, enabled: false });
  awake.turnStarted("a");
  assert.equal(blocker.started.length, 0);
  assert.equal(awake.isHolding, false);
});

test("turning the setting off mid-turn releases at once, and on again holds for the running turn", () => {
  const blocker = fakeBlocker();
  const awake = new KeepAwake({ powerSaveBlocker: blocker });
  awake.turnStarted("a");
  assert.equal(blocker.held, 1);
  awake.setEnabled(false);
  assert.equal(blocker.held, 0);
  awake.turnEnded("b");
  assert.equal(blocker.held, 0);
  awake.setEnabled(true);
  assert.equal(blocker.held, 1);
  awake.turnEnded("a");
  assert.equal(blocker.held, 0);
});

test("a closed or crashed chat releases its turn", () => {
  const blocker = fakeBlocker();
  const awake = new KeepAwake({ powerSaveBlocker: blocker });
  awake.turnStarted("a");
  awake.turnStarted("b");
  awake.chatClosed("a");
  assert.equal(blocker.held, 1);
  awake.chatClosed("b");
  assert.equal(blocker.held, 0);
});

test("quitting releases and later turns hold nothing", () => {
  const blocker = fakeBlocker();
  const awake = new KeepAwake({ powerSaveBlocker: blocker });
  awake.turnStarted("a");
  awake.quit();
  assert.equal(blocker.held, 0);
  awake.turnStarted("b");
  assert.equal(blocker.held, 0);
});

test("observe follows a chat's events", () => {
  const blocker = fakeBlocker();
  const awake = new KeepAwake({ powerSaveBlocker: blocker });
  awake.observe("a", { type: "turn-started", turnId: "1" });
  awake.observe("a", { type: "text-delta", messageId: "1", text: "hi" });
  assert.equal(blocker.held, 1);
  awake.observe("a", { type: "turn-failed", message: "x" });
  assert.equal(blocker.held, 0);
  awake.observe("b", { type: "turn-started", turnId: "2" });
  awake.observe("b", { type: "turn-cancelled" });
  assert.equal(blocker.held, 0);
});
