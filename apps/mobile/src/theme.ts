import { useMemo, useSyncExternalStore } from "react";
import { Appearance, DynamicColorIOS, Platform, useColorScheme, type ColorValue } from "react-native";
import { resolvePalette, withAlpha, type ThemePalette } from "@milagre/shared/themes";
import { readThemeSettings, saveThemeSettings } from "./hosts-native";
import { getThemeSettings, initThemeStore, setThemeSettings, subscribeTheme, type PhoneThemeSettings } from "./theme-store";

// Desktop's tokens (apps/desktop/app/src/styles.css), converted from oklch so both apps share one palette.
const light = {
  page: "#fafafb",
  canvas: "#f1f2f3",
  surface: "#ffffff",
  inset: "#f7f8f9",
  hover: "#f4f5f6",
  field: "#f2f2f3",
  ink: "#1f2124",
  ink2: "#62656b",
  ink3: "#9a9da3",
  line: "#ecedef",
  lineStrong: "#e0e2e5",
  accent: "#0285ff",
  accentInk: "#0070dd",
  accentTint: "#e9f3ff",
  green: "#199a4d",
  purple: "#ad46ff",
  purpleInk: "#8e2bdc",
  purpleTint: "#f6edff",
  greenTint: "#e8f5ed",
  orange: "#ef720d",
  orangeTint: "#fdf1e5",
  red: "#e3474c",
  redTint: "#fcecec",
  onInk: "#ffffff",
  idleDot: "#9a9da366",
  backdrop: "#00000033",
  diffAdd: "#e4f9ea",
  diffAddWord: "#b1ebc4",
  diffRemove: "#ffeceb",
  diffRemoveWord: "#ffc9c8",
};
const dark: typeof light = {
  page: "#17181a",
  canvas: "#1c1d1f",
  surface: "#232427",
  inset: "#1f2022",
  hover: "#2a2b2e",
  field: "#2b2c2f",
  ink: "#f2f3f4",
  ink2: "#a5a8ad",
  ink3: "#6c6f75",
  line: "#2e3033",
  lineStrong: "#3a3c40",
  accent: "#3d9aff",
  accentInk: "#7ec0ff",
  accentTint: "#3d9aff29",
  green: "#3cbb72",
  purple: "#ad46ff",
  purpleInk: "#d0a3ff",
  purpleTint: "#ad46ff2e",
  greenTint: "#3cbb7224",
  orange: "#f68f3c",
  orangeTint: "#f68f3c24",
  red: "#ee5c61",
  redTint: "#ee5c6124",
  onInk: "#17181a",
  idleDot: "#6c6f7566",
  backdrop: "#00000066",
  diffAdd: "#3cbb721f",
  diffAddWord: "#3cbb724d",
  diffRemove: "#ee5c611f",
  diffRemoveWord: "#ee5c614d",
};
export type Palette = { [K in keyof typeof light]: ColorValue };
// iOS resolves dynamic colors natively, so the app follows light and dark mode without re-rendering.
export const colors = Object.fromEntries(
  Object.keys(light).map((key) => {
    const name = key as keyof typeof light;
    return [
      name,
      Platform.OS === "ios" ? DynamicColorIOS({ light: light[name], dark: dark[name] }) : Appearance.getColorScheme() === "dark" ? dark[name] : light[name],
    ];
  }),
) as Palette;
/** Raw hex values, for SVG and native components that cannot take a dynamic color. */
export const hex = (scheme: string | null | undefined) => (scheme === "dark" ? dark : light);
export const fonts = { mono: Platform.OS === "ios" ? "Menlo" : "monospace" };

/** The themed palette plus the phone's short names. Task 7 renames this to `Palette` once the old one is gone. */
export type AppPalette = ThemePalette & {
  bg: string;
  panel: string;
  text: string;
  muted: string;
  error: string;
  onInk: string;
  idleDot: string;
  backdrop: string;
};

function applyMode(mode: PhoneThemeSettings["mode"]) {
  Appearance.setColorScheme(mode === "system" ? "unspecified" : mode);
}
void initThemeStore({ read: readThemeSettings, save: saveThemeSettings }).then(() => applyMode(getThemeSettings().mode));

function extend(p: ThemePalette): AppPalette {
  return {
    ...p,
    bg: p.page,
    panel: p.surface,
    text: p.ink,
    muted: p.ink2,
    error: p.red,
    onInk: p.onAccent,
    idleDot: withAlpha(p.ink3, 0.4),
    backdrop: "#00000033",
  };
}

function setTheme(patch: Partial<PhoneThemeSettings>) {
  setThemeSettings(patch);
  if (patch.mode) applyMode(patch.mode);
}

export function useTheme() {
  const settings = useSyncExternalStore(subscribeTheme, getThemeSettings);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const palette = useMemo(() => extend(resolvePalette(settings.colorTheme, scheme, settings.customTheme)), [settings.colorTheme, settings.customTheme, scheme]);
  return { colors: palette, scheme, settings, set: setTheme } as const;
}
