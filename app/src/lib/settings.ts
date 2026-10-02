import { useEffect, useSyncExternalStore } from "react";
import { MODEL_CATALOG, PERMISSION_MODES } from "../model";
import type { PermissionMode } from "../model";

export type ThemePreference = "system" | "light" | "dark";
/** Whether plan usage reads as the share used or the share left. */
export type UsageDisplay = "used" | "remaining";

export interface AppSettings {
  theme: ThemePreference;
  defaultModelId: string;
  defaultPermissionMode: PermissionMode;
  usageDisplay: UsageDisplay;
  showUsageInSidebar: boolean;
  /** Show a system notification when a chat waits on an approval or question while Milagre is in the background. */
  notifyWhenWaiting: boolean;
}

const STORAGE_KEY = "milagre-settings";
const LEGACY_THEME_KEY = "milagre-theme";
const THEMES: ThemePreference[] = ["system", "light", "dark"];
const USAGE_DISPLAYS: UsageDisplay[] = ["used", "remaining"];
const DEFAULTS: AppSettings = { theme: "light", defaultModelId: MODEL_CATALOG[0].id, defaultPermissionMode: "ask", usageDisplay: "used", showUsageInSidebar: true, notifyWhenWaiting: true };

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

export function useApplyTheme() {
  const theme = useResolvedTheme();
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("theme-switching");
    root.classList.toggle("dark", theme === "dark");
    const frame = window.requestAnimationFrame(() => root.classList.remove("theme-switching"));
    return () => window.cancelAnimationFrame(frame);
  }, [theme]);
}
