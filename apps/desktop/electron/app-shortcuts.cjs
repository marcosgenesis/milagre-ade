// @ts-check
// The app's ⌘⇧ shortcuts, caught before any frame gets the key. With focus inside an embedded frame (a design on the
// canvas, the simulator viewer) the key goes to that frame and the window's own listeners never see it, so these are
// sent on to the renderer, which handles them as if pressed there. Every other key reaches the focused frame as usual.
const APP_SHORTCUT_KEYS = new Set(["d", "e", "l", "s", "t"]);

/**
 * Whether this key is one of the app's ⌘⇧ shortcuts (Ctrl+Shift off macOS).
 * @param {{ type: string; key: string; meta: boolean; control: boolean; shift: boolean; alt: boolean }} input
 * @param {NodeJS.Platform} platform
 */
function isAppShortcut(input, platform) {
  const command = platform === "darwin" ? input.meta : input.control;
  return input.type === "keyDown" && command && input.shift && !input.alt && APP_SHORTCUT_KEYS.has(input.key.toLowerCase());
}

/**
 * Forwards the app's shortcuts from any frame of the window to its renderer, on "app:shortcut".
 * @param {Electron.WebContents} contents
 * @param {NodeJS.Platform} [platform]
 */
function forwardAppShortcuts(contents, platform = process.platform) {
  contents.on("before-input-event", (event, input) => {
    if (!isAppShortcut(input, platform)) return;
    event.preventDefault();
    contents.send("app:shortcut", input.key.toLowerCase());
  });
}

module.exports = { forwardAppShortcuts, isAppShortcut };
