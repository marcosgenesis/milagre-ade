const assert = require("node:assert/strict");
const test = require("node:test");
const { applyTranslucency, OPAQUE_BACKGROUND } = require("./window-translucency.cjs");

function fakeWindow() {
  return {
    calls: [],
    setVibrancy(material) { this.calls.push(["vibrancy", material]); },
    setBackgroundColor(color) { this.calls.push(["background", color]); },
  };
}

test("turning translucency on blurs the desktop behind a see-through window, in Milagre's theme", () => {
  const window = fakeWindow();
  const nativeTheme = { themeSource: "system" };
  applyTranslucency({ window, nativeTheme, platform: "darwin" }, { on: true, theme: "dark" });
  assert.deepEqual(window.calls, [["background", "#00000000"], ["vibrancy", "sidebar"]]);
  assert.equal(nativeTheme.themeSource, "dark");
});

test("turning it off restores the opaque window and lets macOS pick the native theme again", () => {
  const window = fakeWindow();
  const nativeTheme = { themeSource: "dark" };
  applyTranslucency({ window, nativeTheme, platform: "darwin" }, { on: false, theme: "light" });
  assert.deepEqual(window.calls, [["vibrancy", null], ["background", OPAQUE_BACKGROUND]]);
  assert.equal(nativeTheme.themeSource, "system");
});

test("off macOS the window is left alone", () => {
  const window = fakeWindow();
  const nativeTheme = { themeSource: "system" };
  applyTranslucency({ window, nativeTheme, platform: "linux" }, { on: true, theme: "dark" });
  assert.deepEqual(window.calls, []);
  assert.equal(nativeTheme.themeSource, "system");
});
