import { useEffect, useSyncExternalStore } from "react";
import { MODEL_CATALOG, PERMISSION_MODES } from "../model";
import type { PermissionMode } from "../model";
import type { ChatOrder } from "./chat-list";

export type ThemePreference = "system" | "light" | "dark";
/** Whether plan usage reads as the share used or the share left. */
export type UsageDisplay = "used" | "remaining";
/** How long Claude's replies run: Concise is Claude Code's own terse output style. */
export type ClaudeReplies = "concise" | "normal";

export interface AppSettings {
  theme: ThemePreference;
  defaultModelId: string;
  defaultPermissionMode: PermissionMode;
  usageDisplay: UsageDisplay;
  showUsageInSidebar: boolean;
  /** Show a system notification when a chat waits on an approval or question while Milagre is in the background. */
  notifyWhenWaiting: boolean;
  notifyOnCompletion: boolean;
  showDockBadge: boolean;
  /** Keep the Mac from sleeping while an agent works; the screen can still turn off. */
  keepAwake: boolean;
  /** The editor that "Open in" uses, by id; empty means the first one found. */
  editorId: string;
  /** Applies to Claude only; Codex is unchanged. */
  claudeReplies: ClaudeReplies;
  /** Apply TLDR writing rules to both providers. */
  tldrEnabled: boolean;
  /** Sidebar chats by start date, or with the latest message first. */
  chatOrder: ChatOrder;
  /** Let the blurred desktop show through the window (macOS). */
  windowTranslucent: boolean;
  /** How much of the desktop shows through the window's own background, 10 to 100. */
  windowTranslucency: number;
  /** How much shows through the sidebar and panels, 10 to 90. */
  panelTranslucency: number;
  /** Keep the dot grid while translucent. */
  translucentDots: boolean;
}

const STORAGE_KEY = "milagre-settings";
const LEGACY_THEME_KEY = "milagre-theme";
const THEMES: ThemePreference[] = ["system", "light", "dark"];
const USAGE_DISPLAYS: UsageDisplay[] = ["used", "remaining"];
const CLAUDE_REPLIES: ClaudeReplies[] = ["concise", "normal"];
const CHAT_ORDERS: ChatOrder[] = ["created", "recent"];
export const WINDOW_TRANSLUCENCY_RANGE = { min: 10, max: 100, step: 5 };
export const PANEL_TRANSLUCENCY_RANGE = { min: 10, max: 90, step: 5 };
const clampTo = (value: unknown, range: { min: number; max: number }, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : fallback);
const DEFAULTS: AppSettings = { theme: "light", defaultModelId: MODEL_CATALOG[0].id, defaultPermissionMode: "ask", usageDisplay: "used", showUsageInSidebar: true, notifyWhenWaiting: true, notifyOnCompletion: true, showDockBadge: true, keepAwake: true, editorId: "", claudeReplies: "concise", tldrEnabled: true, chatOrder: "created", windowTranslucent: false, windowTranslucency: 80, panelTranslucency: 40, translucentDots: true };

function load(): AppSettings {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<AppSettings>;
    const legacyTheme = window.localStorage.getItem(LEGACY_THEME_KEY);
    const theme = saved.theme ?? legacyTheme;
    return {
      theme: THEMES.includes(theme as ThemePreference) ? (theme as ThemePreference) : DEFAULTS.theme,
      // Any saved id is kept: the agents report models the maintained list lacks, and App falls back
      // to a provider's recommended model when the saved one isn't offered.
      defaultModelId: typeof saved.defaultModelId === "string" && saved.defaultModelId ? saved.defaultModelId : DEFAULTS.defaultModelId,
      defaultPermissionMode: PERMISSION_MODES.some((mode) => mode.id === saved.defaultPermissionMode) ? saved.defaultPermissionMode! : DEFAULTS.defaultPermissionMode,
      usageDisplay: USAGE_DISPLAYS.includes(saved.usageDisplay as UsageDisplay) ? saved.usageDisplay! : DEFAULTS.usageDisplay,
      showUsageInSidebar: typeof saved.showUsageInSidebar === "boolean" ? saved.showUsageInSidebar : DEFAULTS.showUsageInSidebar,
      notifyWhenWaiting: typeof saved.notifyWhenWaiting === "boolean" ? saved.notifyWhenWaiting : DEFAULTS.notifyWhenWaiting,
      notifyOnCompletion: typeof saved.notifyOnCompletion === "boolean" ? saved.notifyOnCompletion : DEFAULTS.notifyOnCompletion,
      showDockBadge: typeof saved.showDockBadge === "boolean" ? saved.showDockBadge : DEFAULTS.showDockBadge,
      keepAwake: typeof saved.keepAwake === "boolean" ? saved.keepAwake : DEFAULTS.keepAwake,
      editorId: typeof saved.editorId === "string" ? saved.editorId : DEFAULTS.editorId,
      tldrEnabled: typeof saved.tldrEnabled === "boolean" ? saved.tldrEnabled : DEFAULTS.tldrEnabled,
      claudeReplies: CLAUDE_REPLIES.includes(saved.claudeReplies as ClaudeReplies) ? saved.claudeReplies! : DEFAULTS.claudeReplies,
      chatOrder: CHAT_ORDERS.includes(saved.chatOrder as ChatOrder) ? saved.chatOrder! : DEFAULTS.chatOrder,
      windowTranslucent: typeof saved.windowTranslucent === "boolean" ? saved.windowTranslucent : DEFAULTS.windowTranslucent,
      windowTranslucency: clampTo(saved.windowTranslucency, WINDOW_TRANSLUCENCY_RANGE, DEFAULTS.windowTranslucency),
      panelTranslucency: clampTo(saved.panelTranslucency, PANEL_TRANSLUCENCY_RANGE, DEFAULTS.panelTranslucency),
      translucentDots: typeof saved.translucentDots === "boolean" ? saved.translucentDots : DEFAULTS.translucentDots,
    };
  } catch {
    return DEFAULTS;
  }
}

let current = load();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSettings() {
  return current;
}

export function updateSettings(patch: Partial<AppSettings>) {
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Settings still apply for this session when storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

export function useSettings() {
  return useSyncExternalStore(subscribe, getSettings);
}

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function subscribeSystemTheme(listener: () => void) {
  darkQuery.addEventListener("change", listener);
  return () => darkQuery.removeEventListener("change", listener);
}

export function useResolvedTheme(): "light" | "dark" {
  const { theme } = useSettings();
  const systemDark = useSyncExternalStore(subscribeSystemTheme, () => darkQuery.matches);
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

/** ⌘⇧T: flips to the opposite of what's on screen, pinning light or dark even from System. */
export function toggleTheme() {
  const { theme } = getSettings();
  const dark = theme === "system" ? darkQuery.matches : theme === "dark";
  updateSettings({ theme: dark ? "light" : "dark" });
}

export function useApplyTheme() {
  const theme = useResolvedTheme();
  const { windowTranslucent, windowTranslucency, panelTranslucency } = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("theme-switching");
    root.classList.toggle("dark", theme === "dark");
    const frame = window.requestAnimationFrame(() => root.classList.remove("theme-switching"));
    return () => window.cancelAnimationFrame(frame);
  }, [theme]);
  // The window itself goes see-through in the main process; the renderer's backgrounds follow.
  useEffect(() => {
    document.documentElement.classList.toggle("translucent", windowTranslucent);
    void window.milagre?.setWindowTranslucent(windowTranslucent, theme).catch(() => {});
  }, [windowTranslucent, theme]);
  useEffect(() => {
    document.documentElement.style.setProperty("--window-translucency", String(windowTranslucency / 100));
    document.documentElement.style.setProperty("--panel-translucency", String(panelTranslucency / 100));
  }, [windowTranslucency, panelTranslucency]);
}
