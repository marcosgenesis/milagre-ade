const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createAppUpdates, watchAppUpdates } = require("./app-updates.cjs");
function fixture() {
  let time = 0,
    checks = 0,
    stops = 0,
    installs = 0;
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {
    checks++;
    updater.emit("update-not-available");
  };
  updater.quitAndInstall = () => {
    installs++;
  };
  const controller = createAppUpdates({
    updater,
    enabled: true,
    prepare: async () => {},
    stopHost: async () => {
      stops++;
    },
    publish() {},
    now: () => time,
  });
  return {
    updater,
    controller,
    advance: (ms) => {
      time += ms;
    },
    counts: () => ({ checks, stops, installs }),
  };
}
test("startup, focus and wake find releases without reopening the app; rapid focus is throttled and quit cleans up", async () => {
  const f = fixture(),
    app = new EventEmitter(),
    power = new EventEmitter();
  let tick,
    cancelled = false;
  watchAppUpdates(f.controller, {
    app,
    powerMonitor: power,
    schedule: (callback, ms) => {
      tick = () => {
        f.advance(ms);
        callback();
      };
      return () => {
        cancelled = true;
      };
    },
  });
  await new Promise(setImmediate);
  app.emit("browser-window-focus");
  assert.equal(f.counts().checks, 1);
  f.advance(60000);
  app.emit("browser-window-focus");
  await new Promise(setImmediate);
  assert.equal(f.counts().checks, 2);
  tick();
  await new Promise(setImmediate);
  assert.equal(f.counts().checks, 3);
  f.advance(60000);
  power.emit("resume");
  await new Promise(setImmediate);
  assert.equal(f.counts().checks, 4);
  app.emit("will-quit");
  assert.equal(cancelled, true);
  assert.equal(power.listenerCount("resume"), 0);
});
test("checks coalesce and a ready download is never replaced by a background check", async () => {
  const f = fixture();
  let release;
  f.updater.checkForUpdates = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const first = f.controller.check(true),
    second = f.controller.check(true);
  assert.equal(first, second);
  await new Promise(setImmediate);
  f.updater.emit("update-downloaded", { version: "1.2.3" });
  release();
  await first;
  await f.controller.check(true);
  assert.equal(f.controller.get().status, "downloaded");
  assert.equal(f.controller.get().version, "1.2.3");
});
test("only a downloaded update can stop agents; duplicate install clicks stop the host once", async () => {
  const f = fixture();
  await f.controller.install();
  assert.equal(f.counts().stops, 0);
  f.updater.emit("update-downloaded", { version: "1.2.3" });
  await Promise.all([f.controller.install(), f.controller.install()]);
  assert.deepEqual(f.counts(), { checks: 0, stops: 1, installs: 1 });
  assert.equal(f.controller.get().status, "installing");
});
test("failed host shutdown keeps the downloaded update retryable and does not run the installer", async () => {
  const updater = new EventEmitter();
  let attempts = 0,
    installs = 0;
  updater.quitAndInstall = () => {
    installs++;
  };
  const controller = createAppUpdates({
    updater,
    enabled: true,
    prepare: async () => {},
    publish() {},
    stopHost: async () => {
      if (++attempts === 1) throw new Error("save failed");
    },
  });
  updater.emit("update-downloaded", { version: "1.2.3" });
  await controller.install();
  assert.equal(controller.get().status, "downloaded");
  assert.match(controller.get().error, /restart/i);
  assert.equal(installs, 0);
  await controller.install();
  assert.equal(installs, 1);
});
test("offline check and failed download retry without losing the known version", async () => {
  const f = fixture();
  f.updater.checkForUpdates = async () => {
    throw new Error("offline");
  };
  await f.controller.check(true);
  assert.equal(f.controller.get().status, "error");
  f.updater.checkForUpdates = async () => {
    f.updater.emit("update-available", { version: "1.2.3" });
    f.updater.emit("error", new Error("download failed"));
  };
  await f.controller.check(true);
  assert.equal(f.controller.get().version, "1.2.3");
  assert.match(f.controller.get().error, /download/i);
  f.updater.checkForUpdates = async () => {
    f.updater.emit("update-downloaded", { version: "1.2.3" });
  };
  await f.controller.check(true);
  assert.equal(f.controller.get().status, "downloaded");
  assert.equal(f.controller.get().error, undefined);
});
