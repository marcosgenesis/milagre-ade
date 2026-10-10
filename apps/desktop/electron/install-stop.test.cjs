const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { stopInstalledHost } = require("./install-stop.cjs");

function client() {
  const item = new EventEmitter();
  item.close = () => {};
  return item;
}

test("installer shutdown waits for the daemon to save and disconnect", async () => {
  const item = client();
  const accepted = Promise.withResolvers();
  const saved = Promise.withResolvers();
  item.call = async (method) => {
    assert.equal(method, "daemon:stop");
    accepted.resolve();
    await saved.promise;
    item.emit("close");
    return { stopping: true };
  };
  let stopped = false;
  const stopping = stopInstalledHost({ dataDir: "/profile", connect: async () => item }).then(() => {
    stopped = true;
  });
  await accepted.promise;
  assert.equal(stopped, false);
  saved.resolve();
  await stopping;
  assert.equal(stopped, true);
});

test("a failed save blocks installer replacement and closes only its client", async () => {
  const item = client();
  let closed = false;
  item.close = () => {
    closed = true;
  };
  item.call = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(stopInstalledHost({ dataDir: "/profile", connect: async () => item }), /disk full/);
  assert.equal(closed, true);
});

test("a missing daemon is allowed only when there is no recorded owner", async () => {
  const connect = async () => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };
  await stopInstalledHost({ dataDir: "/profile", connect, exists: () => false });
  await assert.rejects(stopInstalledHost({ dataDir: "/profile", connect, exists: () => true }), /missing/);
});

test("authentication errors block installer replacement even without an ownership file", async () => {
  await assert.rejects(
    stopInstalledHost({
      dataDir: "/profile",
      exists: () => false,
      connect: async () => {
        throw Object.assign(new Error("unauthorized"), { code: "UNAUTHORIZED" });
      },
    }),
    /unauthorized/,
  );
});

test("an unresponsive host blocks installer replacement without killing a PID", async () => {
  const item = client();
  item.call = async () => ({ stopping: true });
  await assert.rejects(stopInstalledHost({ dataDir: "/profile", connect: async () => item, timeoutMs: 20 }), /did not stop/);
});
