import { XTERM_CSS, XTERM_FIT_JS, XTERM_JS } from "./xterm-bundle.gen";

/** The colors the phone's Terminal draws with; `scheme` picks the ANSI palette. */
export type TerminalTheme = { scheme: "light" | "dark"; background: string; ink: string; ink3: string; accent: string };

/**
 * What the WebView tells React Native: it is ready at a size, the user typed (`input`), the screen's size changed, or a
 * held Ctrl was used. Everything else crosses the other way as calls to the window functions in the script below.
 */
export type TerminalViewMessage =
  | { channel: "milagre-terminal"; event: "ready"; cols: number; rows: number }
  | { channel: "milagre-terminal"; event: "input"; data: string }
  | { channel: "milagre-terminal"; event: "resize"; cols: number; rows: number }
  | { channel: "milagre-terminal"; event: "ctrl-used" };

const ANSI = {
  light: [
    "#24292f",
    "#cf222e",
    "#116329",
    "#7d4e00",
    "#0969da",
    "#8250df",
    "#1b7c83",
    "#6e7781",
    "#57606a",
    "#a40e26",
    "#1a7f37",
    "#633c01",
    "#218bff",
    "#a475f9",
    "#3192aa",
    "#8c959f",
  ],
  dark: [
    "#484f58",
    "#ff7b72",
    "#3fb950",
    "#d29922",
    "#58a6ff",
    "#bc8cff",
    "#39c5cf",
    "#b1bac4",
    "#6e7681",
    "#ffa198",
    "#56d364",
    "#e3b341",
    "#79c0ff",
    "#d2a8ff",
    "#56d4dd",
    "#ffffff",
  ],
};
const NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

/** xterm's theme for the phone, the same palette desktop's panel uses. */
export function xtermTheme(theme: TerminalTheme) {
  const colors = ANSI[theme.scheme];
  const named: Record<string, string> = {};
  NAMES.forEach((name, index) => {
    named[name] = colors[index];
    named[`bright${name[0].toUpperCase()}${name.slice(1)}`] = colors[index + 8];
  });
  return {
    ...named,
    background: theme.background,
    foreground: theme.ink,
    cursor: theme.ink,
    cursorAccent: theme.background,
    selectionBackground: `${theme.accent}55`,
  };
}

/** A value as a script literal that can't end the page's <script> element. */
export const scriptValue = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

// Runs in the WebView. The host's output arrives through terminalWrite/terminalReset; keys go back as `input`. A held
// Ctrl (the key bar's) turns the next letter into its control character, as a hardware keyboard's Ctrl would.
const SCRIPT = `
(function () {
  var post = function (message) {
    message.channel = "milagre-terminal";
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  };
  var element = document.getElementById("terminal");
  var term = new Terminal({ fontFamily: "Menlo, monospace", fontSize: 12, lineHeight: 1.15, scrollback: 10000, cursorBlink: true, theme: INITIAL_THEME });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(element);
  var ctrl = false;
  term.onData(function (data) {
    if (ctrl && data.length === 1) {
      var code = data.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) data = String.fromCharCode(code - 64);
      ctrl = false;
      post({ event: "ctrl-used" });
    }
    post({ event: "input", data: data });
  });
  term.onResize(function (size) { post({ event: "resize", cols: size.cols, rows: size.rows }); });
  var refit = function () { try { fit.fit(); } catch (error) {} };
  new ResizeObserver(refit).observe(element);
  window.terminalWrite = function (data) { term.write(data); };
  window.terminalReset = function (data) { term.reset(); term.write(data); };
  window.terminalTheme = function (theme) { term.options.theme = theme; document.body.style.background = theme.background; };
  window.terminalFocus = function () { term.focus(); };
  window.terminalCtrl = function (held) { ctrl = held; };
  window.terminalSend = function (data) { post({ event: "input", data: data }); term.focus(); };
  refit();
  post({ event: "ready", cols: term.cols, rows: term.rows });
})();
`;

/** The WebView's whole page: xterm, its fit addon and the glue above, with no network access needed. */
export function createTerminalHtml(theme: TerminalTheme) {
  const initial = xtermTheme(theme);
  const script = SCRIPT.replace("INITIAL_THEME", scriptValue(initial));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>${XTERM_CSS}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${theme.background}}#terminal{position:absolute;inset:4px 8px 0 8px}.xterm .xterm-viewport{background-color:transparent}
</style></head><body><div id="terminal"></div><script>${XTERM_JS}</script><script>${XTERM_FIT_JS}</script><script>${script.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
