// The "Translucent window" appearance setting: macOS draws the desktop and windows behind Milagre
// blurred through a see-through window. The renderer makes its own backgrounds see-through at the
// same time (the `translucent` class on <html>). The blur material follows the native theme, so
// Milagre's resolved theme is pinned on it while translucent and handed back to macOS when not.
const OPAQUE_BACKGROUND = "#f4f9fe";
const CLEAR_BACKGROUND = "#00000000";

function applyTranslucency({ window, nativeTheme, platform = process.platform }, { on, theme, background }) {
  if (platform !== "darwin") return;
  if (on) {
    nativeTheme.themeSource = theme === "dark" ? "dark" : "light";
    window.setBackgroundColor(CLEAR_BACKGROUND);
    window.setVibrancy("sidebar");
  } else {
    nativeTheme.themeSource = "system";
    window.setVibrancy(null);
    window.setBackgroundColor(/^#[0-9a-f]{6}$/i.test(background) ? background : OPAQUE_BACKGROUND);
  }
}

module.exports = { applyTranslucency, OPAQUE_BACKGROUND };
