const { randomUUID } = require("node:crypto");

// Only Linear's own authorize page opens here; anything else in the event is ignored.
const AUTHORIZE = "https://linear.app/oauth/authorize?";

/**
 * Add workspace's Linear sign-in, in a window of the Mac app's own with an empty session: the browser would reuse
 * its Linear login, so a second account could never sign in. The session lives in memory only and is wiped when the
 * window goes. Closing the window before the sign-in ends cancels it (`cancel`).
 */
function createLinearSignInWindow({ BrowserWindow, shell, cancel, setTimeoutImpl = setTimeout }) {
  let current = null; // { window, ended }: `ended` once the sign-in is over, so closing it cancels nothing

  function open(url) {
    if (typeof url !== "string" || !url.startsWith(AUTHORIZE)) return false;
    close();
    const window = new BrowserWindow({
      width: 520,
      height: 720,
      title: "Sign in to Linear",
      webPreferences: { partition: `linear-sign-in-${randomUUID()}`, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    // Links that open a new window (Linear's terms, help) go to the browser; the sign-in stays in this one.
    window.webContents.setWindowOpenHandler(({ url: target }) => {
      if (target.startsWith("https://")) void shell.openExternal(target);
      return { action: "deny" };
    });
    const entry = { window, ended: false };
    current = entry;
    const session = window.webContents.session;
    window.on("closed", () => {
      if (current === entry) current = null;
      void session.clearStorageData().catch(() => {});
      if (!entry.ended) cancel();
    });
    void window.loadURL(url).catch(() => {});
    return true;
  }

  // The sign-in finished: the callback page stays up a moment, then the window closes itself.
  function finish() {
    const entry = current;
    if (!entry) return;
    entry.ended = true;
    setTimeoutImpl(() => {
      if (!entry.window.isDestroyed()) entry.window.close();
    }, 1200);
  }

  // A newer sign-in replaced this one, or it failed: the window goes at once.
  function close() {
    const entry = current;
    if (!entry) return;
    entry.ended = true;
    current = null;
    if (!entry.window.isDestroyed()) entry.window.close();
  }

  return { open, finish, close, isOpen: () => current !== null };
}

module.exports = { createLinearSignInWindow };
