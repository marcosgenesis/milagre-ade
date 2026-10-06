// @ts-check
// Which update feed this install follows. Lives in userData because the check runs before the renderer loads.
const fs = require("node:fs");
const CHANNELS = /** @type {const} */ (["stable", "beta"]);
/**
 * @param {{ file: string }} options
 * @returns {{ get(): "stable" | "beta", set(channel: string): "stable" | "beta" }}
 */
function createReleaseChannelStore({ file }) {
  /** @type {"stable" | "beta"} */
  let channel = "stable";
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8")).channel;
    if (saved === "stable" || saved === "beta") channel = saved;
  } catch {}
  return {
    get: () => channel,
    set(next) {
      if (next !== "stable" && next !== "beta") throw new Error(`Unknown release channel: ${next}`);
      channel = next;
      fs.writeFileSync(file, JSON.stringify({ channel }));
      return channel;
    },
  };
}
/** @param {{ channel?: string | null, allowPrerelease?: boolean, allowDowngrade?: boolean }} autoUpdater @param {string} channel */
function configureUpdater(autoUpdater, channel) {
  autoUpdater.channel = channel === "beta" ? "beta" : "latest";
  autoUpdater.allowPrerelease = channel === "beta";
  autoUpdater.allowDowngrade = false;
}
/** @param {any} error */
const isChannelNotPublished = error => error?.code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND";
module.exports = { createReleaseChannelStore, configureUpdater, isChannelNotPublished, CHANNELS };
