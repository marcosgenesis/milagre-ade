import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { followTerminal, type TerminalFollower } from "@milagre/shared/terminal-client";
import type { TerminalInfo } from "@milagre/shared/terminal";
import { isMac } from "./shortcut-hints";
import { removeTerminal, updateTerminal } from "./terminal-store";

// One xterm per Terminal, kept while the Terminal runs. Switching Chats or tabs moves its element between panels
// instead of building it again, so scrollback and selection survive and nothing is read twice.

type Session = { id: string; chatId: string; term: Terminal; fit: FitAddon; element: HTMLDivElement; follower: TerminalFollower; opened: boolean };
const sessions = new Map<string, Session>();

const LIGHT: ITheme = {
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#7d4e00",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#633c01",
  brightBlue: "#218bff",
  brightMagenta: "#a475f9",
  brightCyan: "#3192aa",
  brightWhite: "#8c959f",
};
const DARK: ITheme = {
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#ffffff",
};

/** The app's colors as xterm takes them; the panel's own surface shows through the transparent background. */
function terminalTheme(): ITheme {
  const root = document.documentElement,
    style = getComputedStyle(root);
  const color = (name: string) => style.getPropertyValue(name).trim();
  const dark = root.classList.contains("dark");
  return {
    ...(dark ? DARK : LIGHT),
    background: "#00000000",
    foreground: color("--ink"),
    cursor: color("--ink"),
    cursorAccent: color("--surface"),
    selectionBackground: color("--accent") ? `color-mix(in oklch, ${color("--accent")} 30%, transparent)` : undefined,
  };
}

function fontFamily() {
  const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  return mono || 'ui-monospace, "SF Mono", Menlo, monospace';
}

let themeWatch: MutationObserver | null = null;
function watchTheme() {
  if (themeWatch) return;
  themeWatch = new MutationObserver(() => {
    const theme = terminalTheme();
    for (const session of sessions.values()) session.term.options.theme = theme;
  });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
}

function create(info: TerminalInfo): Session {
  watchTheme();
  const term = new Terminal({
    allowTransparency: true,
    cursorBlink: true,
    fontFamily: fontFamily(),
    fontSize: 12.5,
    lineHeight: 1.2,
    scrollback: 10_000,
    macOptionIsMeta: false,
    theme: terminalTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // ⌘ shortcuts belong to the app (⌘T, ⌘K, ⌘1…9); ⌘C and ⌘V go through the window's Edit menu to xterm's copy and paste.
  term.attachCustomKeyEventHandler((event) => !(isMac ? event.metaKey : event.ctrlKey && event.shiftKey));
  const element = document.createElement("div");
  element.className = "h-full w-full";
  element.dataset.terminalId = info.id;
  const follower = followTerminal({
    terminalId: info.id,
    api: window.milagre.terminals,
    write: (data) => term.write(data),
    reset: (data) => {
      term.reset();
      term.write(data);
    },
    info: updateTerminal,
    ended: () => {
      dispose(info.id);
      removeTerminal(info.chatId, info.id);
    },
  });
  term.onData((data) => follower.send(data));
  term.onBinary((data) => follower.send(data));
  term.onResize(({ cols, rows }) => follower.resize(cols, rows));
  const session = { id: info.id, chatId: info.chatId, term, fit, element, follower, opened: false };
  sessions.set(info.id, session);
  return session;
}

/** Shows the Terminal in `container`, building its xterm the first time. */
export function attachTerminal(info: TerminalInfo, container: HTMLElement) {
  const session = sessions.get(info.id) ?? create(info);
  if (session.element.parentElement !== container) container.replaceChildren(session.element);
  if (!session.opened) {
    session.term.open(session.element);
    session.opened = true;
    // Focus listeners need the textarea xterm makes on open.
    session.term.textarea?.addEventListener("focus", () => window.milagre.setTerminalFocused(true));
    session.term.textarea?.addEventListener("blur", () => window.milagre.setTerminalFocused(false));
  }
  fitTerminal(info.id);
  return session;
}

/** Fits the Terminal to its panel and claims the PTY's size for this window: the last viewer to fit or type sets it. */
export function fitTerminal(id: string) {
  const session = sessions.get(id);
  if (!session?.opened || !session.element.isConnected || !session.element.clientWidth || !session.element.clientHeight) return;
  try {
    session.fit.fit();
  } catch {
    return;
  }
  session.follower.resize(session.term.cols, session.term.rows);
}

export function focusTerminal(id: string) {
  const session = sessions.get(id);
  if (!session?.opened) return;
  session.term.focus();
  session.follower.resize(session.term.cols, session.term.rows);
}

export function terminalHasFocus(id: string) {
  const session = sessions.get(id);
  return Boolean(session?.term.textarea && document.activeElement === session.term.textarea);
}

export function dispose(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  session.follower.stop();
  if (session.term.textarea && document.activeElement === session.term.textarea) window.milagre.setTerminalFocused(false);
  session.term.dispose();
  session.element.remove();
}

/** Ends viewers for Terminals the host no longer lists. */
export function pruneTerminals(chatId: string, live: Set<string>) {
  for (const session of sessions.values()) if (session.chatId === chatId && !live.has(session.id)) dispose(session.id);
}
