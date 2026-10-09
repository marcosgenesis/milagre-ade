import { isHex, resolveThemeSettings, type CustomTheme, type ThemeChoice } from "@milagre/shared/themes";

// The phone's color theme, read once and shared by every screen. No React Native imports, so it runs under node:test.
export type PhoneThemeSettings = {
  mode: "system" | "light" | "dark";
  colorTheme: ThemeChoice;
  customThemeEnabled: boolean;
  customTheme: CustomTheme | null;
};

export const DEFAULT_PHONE_THEME: PhoneThemeSettings = {
  mode: "system",
  colorTheme: "milagre-blue",
  customThemeEnabled: false,
  customTheme: null,
};

const MODES: readonly PhoneThemeSettings["mode"][] = ["system", "light", "dark"];

// Same check as desktop's settings.ts: both schemes carry a hex background, text and accent.
function isCustomTheme(value: unknown): value is CustomTheme {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return ["light", "dark"].every((scheme) => {
    const seeds = record[scheme] as Record<string, unknown> | undefined;
    return !!seeds && ["background", "text", "accent"].every((key) => typeof seeds[key] === "string" && isHex(seeds[key]));
  });
}

export function parsePhoneThemeSettings(raw: string | null): PhoneThemeSettings {
  if (!raw) return DEFAULT_PHONE_THEME;
  let saved: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_PHONE_THEME;
    saved = parsed as Record<string, unknown>;
  } catch {
    return DEFAULT_PHONE_THEME;
  }
  const customTheme = isCustomTheme(saved.customTheme) ? saved.customTheme : null;
  const customThemeEnabled = typeof saved.customThemeEnabled === "boolean" ? saved.customThemeEnabled : false;
  return {
    mode: MODES.includes(saved.mode as PhoneThemeSettings["mode"]) ? (saved.mode as PhoneThemeSettings["mode"]) : "system",
    colorTheme: resolveThemeSettings({ colorTheme: saved.colorTheme, customThemeEnabled, customTheme }),
    customThemeEnabled,
    customTheme,
  };
}

type ThemeIo = { read(): Promise<string | null>; save(raw: string): Promise<void> };

let state = DEFAULT_PHONE_THEME;
let io: ThemeIo | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const getThemeSettings = () => state;

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setThemeSettings(patch: Partial<PhoneThemeSettings>) {
  state = { ...state, ...patch };
  notify();
  if (io) void io.save(JSON.stringify(state)).catch(() => {});
}

export async function initThemeStore(next: ThemeIo) {
  io = next;
  state = parsePhoneThemeSettings(await next.read().catch(() => null));
  notify();
}
