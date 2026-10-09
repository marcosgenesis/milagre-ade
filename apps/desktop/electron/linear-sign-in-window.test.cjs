const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createLinearSignInWindow } = require("./linear-sign-in-window.cjs");

const AUTHORIZE = "https://linear.app/oauth/authorize?client_id=cid&state=s";

// A fake BrowserWindow that records how it was made and what it loaded; `close()` fires "closed" like Electron.
function fakes() {
  const windows = [];
  const external = [];
  let cancels = 0;
  const timers = [];
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.cleared = 0;
      this.webContents = {
        session: { clearStorageData: async () => this.cleared++ },
        setWindowOpenHandler: (handler) => (this.openHandler = handler),
      };
      windows.push(this);
    }
    loadURL(url) {
      this.loaded = url;
      return Promise.resolve();
    }
    isDestroyed() {
      return this.destroyed;
    }
    close() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit("closed");
    }
  }
  const signIn = createLinearSignInWindow({
    BrowserWindow,
    shell: { openExternal: async (url) => external.push(url) },
    cancel: () => cancels++,
    setTimeoutImpl: (fn) => timers.push(fn),
  });
  return { signIn, windows, external, timers, cancels: () => cancels };
}

test("only Linear's authorize page opens, in a session of its own each time", () => {
  const { signIn, windows } = fakes();
  assert.equal(signIn.open("https://evil.example/oauth/authorize?x"), false);
  assert.equal(signIn.open("https://linear.app/settings"), false);
  assert.equal(windows.length, 0);
  assert.equal(signIn.open(AUTHORIZE), true);
  assert.equal(windows[0].loaded, AUTHORIZE);
  const { partition, sandbox, nodeIntegration } = windows[0].options.webPreferences;
  assert.match(partition, /^linear-sign-in-/);
  assert.doesNotMatch(partition, /^persist:/, "the session is never written to disk");
  assert.equal(sandbox, true);
  assert.equal(nodeIntegration, false);
  signIn.open(AUTHORIZE);
  assert.notEqual(windows[1].options.webPreferences.partition, partition, "a new sign-in starts signed out");
  assert.equal(windows[0].isDestroyed(), true, "the older window goes");
});

test("closing the window before the sign-in ends cancels it and wipes the session", async () => {
  const { signIn, windows, cancels } = fakes();
  signIn.open(AUTHORIZE);
  windows[0].close();
  await Promise.resolve();
  assert.equal(cancels(), 1);
  assert.equal(windows[0].cleared, 1);
  assert.equal(signIn.isOpen(), false);
});

test("a finished sign-in shows the callback page a moment, then closes without cancelling", () => {
  const { signIn, windows, timers, cancels } = fakes();
  signIn.open(AUTHORIZE);
  signIn.finish();
  assert.equal(windows[0].isDestroyed(), false);
  timers[0]();
  assert.equal(windows[0].isDestroyed(), true);
  assert.equal(cancels(), 0);
});

test("a replaced or failed sign-in closes the window without cancelling the newer one", () => {
  const { signIn, windows, cancels } = fakes();
  signIn.open(AUTHORIZE);
  signIn.close();
  assert.equal(windows[0].isDestroyed(), true);
  assert.equal(cancels(), 0);
});

test("links that open a new window go to the browser", () => {
  const { signIn, windows, external } = fakes();
  signIn.open(AUTHORIZE);
  assert.deepEqual(windows[0].openHandler({ url: "https://linear.app/terms" }), { action: "deny" });
  assert.deepEqual(windows[0].openHandler({ url: "file:///etc/passwd" }), { action: "deny" });
  assert.deepEqual(external, ["https://linear.app/terms"]);
});
