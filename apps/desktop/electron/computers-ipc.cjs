const { ALIASES, NOT_REMOTE, isLocalOnly, qualifyEvent, qualifyResult, stripComputer } = require("./computer-routing.cjs");

/**
 * The window's side of computers.cjs (spec "This Mac (Electron main) › Computers"): the IPC the preload's
 * window.milagre.computers calls, the list pushed to every window after each change (computers:changed), and each
 * computer's runtime events, tagged with its id (computers:event). `send(channel, payload)` reaches every window.
 * @param {{
 *   ipcMain: { handle: (channel: string, handler: (event: any, ...args: any[]) => any) => void };
 *   computers: any;
 *   thisMac: () => string;
 *   send: (channel: string, payload: unknown) => void;
 * }} options
 */
function registerComputers({ ipcMain, computers, thisMac, send }) {
  const snapshot = () => ({ thisMac: thisMac(), computers: computers.list() });

  ipcMain.handle("computers:list", async () => {
    await computers.loaded;
    return snapshot();
  });
  ipcMain.handle("computers:preview", (_event, link) => computers.preview(link));
  // Electron keeps only an error's message across IPC; Add computer needs its code too ("cancelled" says nothing).
  ipcMain.handle("computers:add", async (event, link, options) => {
    try {
      const computer = await computers.add(
        link,
        { name: typeof options?.name === "string" ? options.name : undefined },
        {
          onPending: () => {
            if (!event.sender.isDestroyed()) event.sender.send("computers:pending");
          },
        },
      );
      return { ok: true, computer };
    } catch (error) {
      const code = /** @type {any} */ (error)?.code;
      return {
        ok: false,
        code: typeof code === "string" ? code : "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
  ipcMain.handle("computers:cancel-add", () => computers.cancelAdd());
  ipcMain.handle("computers:rename", async (_event, id, name) => {
    await computers.rename(String(id), String(name ?? ""));
    return snapshot();
  });
  ipcMain.handle("computers:remove", async (_event, id) => {
    await computers.remove(String(id));
    return snapshot();
  });
  ipcMain.handle("computers:set-enabled", (_event, on) => computers.setEnabled(on === true));
  // One call on a computer: this Mac's own actions are refused, its id leaves the arguments, and what comes back names it.
  ipcMain.handle("computers:invoke", async (_event, id, channel, args) => {
    const computerId = String(id);
    const name = String(channel);
    if (isLocalOnly(name)) throw new Error(NOT_REMOTE);
    const method = ALIASES[name] ?? name;
    const result = await computers.invoke(computerId, method, stripComputer(computerId, Array.isArray(args) ? args : []));
    return qualifyResult(computerId, method, result);
  });

  return {
    changed: () => send("computers:changed", snapshot()),
    /** @param {string} computerId @param {string} channel @param {unknown} payload */
    event: (computerId, channel, payload) => send("computers:event", { computerId, channel, payload: qualifyEvent(computerId, channel, payload) }),
  };
}

module.exports = { registerComputers };
