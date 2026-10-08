// @ts-check
const { isChannelNotPublished } = require("./release-channel.cjs");

/** One updater owns downloads, background checks, and explicit host shutdown for installation. */
function createAppUpdates({ updater, enabled, prepare, stopHost, publish, now = Date.now }) {
  /** @type {import('../app/src/electron').UpdateState} */
  let state = { status: "idle", version: null, progress: 0 };
  /** @type {Promise<typeof state> | null} */
  let checking = null;
  /** @type {Promise<void> | null} */
  let installing = null;
  let lastCheck = -Infinity;
  /** @param {Partial<typeof state>} next */
  const update = (next) => {
    state = { ...state, ...next };
    publish(state);
    return state;
  };
  const failed = () => {
    if (state.status === "installing") return update({ status: "downloaded", error: "Could not restart Milagre. Try again." });
    return update({
      status: "error",
      error: state.status === "downloading" ? "Could not download the update. Try again." : "Could not check for updates. Try again.",
    });
  };
  updater.autoDownload = true;
  // A normal quit must leave the shared host running; installation explicitly stops it.
  updater.autoInstallOnAppQuit = false;
  updater.on("update-available", (info) => update({ status: "downloading", version: info.version, progress: 0, error: undefined }));
  updater.on("update-not-available", () => update({ status: "up-to-date", version: null, error: undefined }));
  updater.on("download-progress", (progress) => update({ status: "downloading", progress: Math.max(0, Math.min(100, progress.percent)) }));
  updater.on("update-downloaded", (info) => update({ status: "downloaded", version: info.version, progress: 100, error: undefined }));
  updater.on("error", failed);
  function check(force = false) {
    if (!enabled) return Promise.resolve(update({ status: "unavailable" }));
    if (checking) return checking;
    if (["downloading", "downloaded", "installing"].includes(state.status)) return Promise.resolve(state);
    if (!force && now() - lastCheck < 60000) return Promise.resolve(state);
    lastCheck = now();
    update({ status: "checking", progress: 0, error: undefined });
    checking = Promise.resolve()
      .then(prepare)
      .then(() => updater.checkForUpdates())
      .then(
        () => (state.status === "checking" ? update({ status: "up-to-date", version: null }) : state),
        (error) => {
          if (isChannelNotPublished(error)) return update({ status: "up-to-date", version: null, error: undefined });
          // electron-updater also emits an error event; preserve its download-specific explanation.
          return state.status === "error" ? state : failed();
        },
      )
      .finally(() => {
        checking = null;
      });
    return checking;
  }
  function install() {
    if (installing) return installing;
    if (state.status !== "downloaded") return Promise.resolve();
    update({ status: "installing", error: undefined });
    installing = Promise.resolve()
      .then(stopHost)
      .then(() => updater.quitAndInstall())
      .catch(() => {
        update({ status: "downloaded", error: "Could not restart Milagre. Try again." });
      })
      .finally(() => {
        installing = null;
      });
    return installing;
  }
  return { get: () => state, check, install };
}

function watchAppUpdates(
  controller,
  {
    app,
    powerMonitor,
    schedule = (callback, ms) => {
      const timer = setInterval(callback, ms);
      timer.unref();
      return () => clearInterval(timer);
    },
  },
) {
  const refresh = () => {
    void controller.check();
  };
  app.on("browser-window-focus", refresh);
  powerMonitor.on("resume", refresh);
  const cancel = schedule(refresh, 5 * 60000);
  app.once("will-quit", () => {
    cancel();
    app.removeListener("browser-window-focus", refresh);
    powerMonitor.removeListener("resume", refresh);
  });
  refresh();
}
module.exports = { createAppUpdates, watchAppUpdates };
