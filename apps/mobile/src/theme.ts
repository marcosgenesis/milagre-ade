import { useSyncExternalStore } from "react";
import { Appearance, Platform, useColorScheme } from "react-native";
import { onColor, resolvePalette, withAlpha, type ThemePalette } from "@milagre/shared/themes";
import { readThemeSettings, saveThemeSettings } from "./hosts-native";
import { getThemeSettings, initThemeStore, setThemeSettings, subscribeTheme, type PhoneThemeSettings } from "./theme-store";

export const fonts = { mono: Platform.OS === "ios" ? "Menlo" : "monospace" };

/** The themed palette plus the phone's short names. */
export type Palette = ThemePalette & {
  bg: string;
  panel: string;
  text: string;
  muted: string;
  error: string;
  onInk: string;
  idleDot: string;
  backdrop: string;
  purpleInk: string;
  purpleTint: string;
};

function applyMode(mode: PhoneThemeSettings["mode"]) {
  Appearance.setColorScheme(mode === "system" ? "unspecified" : mode);
}
void initThemeStore({ read: readThemeSettings, save: saveThemeSettings }).then(() => applyMode(getThemeSettings().mode));

// Ultracode's purple is a brand color, the same in every theme (desktop keeps --purple out of the theme sheet too).
const ULTRACODE = {
  light: { purple: "#ad46ff", purpleInk: "#8e2bdc", purpleTint: "#f6edff" },
  dark: { purple: "#ad46ff", purpleInk: "#d0a3ff", purpleTint: "#ad46ff2e" },
};
function extend(p: ThemePalette, scheme: "light" | "dark"): Palette {
  return {
    ...p,
    ...ULTRACODE[scheme],
    bg: p.page,
    panel: p.surface,
    text: p.ink,
    muted: p.ink2,
    error: p.red,
    onInk: onColor(p.ink, p.page),
    idleDot: withAlpha(p.ink3, 0.4),
    backdrop: scheme === "dark" ? "#00000066" : "#00000033",
  };
}

function setTheme(patch: Partial<PhoneThemeSettings>) {
  setThemeSettings(patch);
  if (patch.mode) applyMode(patch.mode);
}

// One palette object per theme, shared by every component, so per-palette style caches hit across the app.
const paletteCache = new Map<string, Palette>();
function paletteFor(settings: PhoneThemeSettings, scheme: "light" | "dark"): Palette {
  const key = `${settings.colorTheme}|${scheme}|${JSON.stringify(settings.customTheme ?? null)}`;
  let palette = paletteCache.get(key);
  if (!palette) {
    if (paletteCache.size > 24) paletteCache.clear();
    palette = extend(resolvePalette(settings.colorTheme, scheme, settings.customTheme), scheme);
    paletteCache.set(key, palette);
  }
  return palette;
}

export function useTheme() {
  const settings = useSyncExternalStore(subscribeTheme, getThemeSettings);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const palette = paletteFor(settings, scheme);
  return { colors: palette, scheme, settings, set: setTheme } as const;
}

/** A hook for a style sheet that depends on the palette: built once per palette, shared by every component that calls it. */
export function createStylesHook<T>(make: (colors: Palette) => T): () => T {
  const cache = new WeakMap<Palette, T>();
  return () => {
    const { colors } = useTheme();
    let styles = cache.get(colors);
    if (!styles) {
      styles = make(colors);
      cache.set(colors, styles);
    }
    return styles;
  };
}
