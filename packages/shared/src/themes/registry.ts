import { milagreThemes } from "./palettes/milagre.ts";
import { catppuccinThemes } from "./palettes/catppuccin.ts";
import { popularThemes } from "./palettes/popular.ts";
import type { ThemeDefinition, ThemeId } from "./types.ts";

export const DEFAULT_THEME_ID: ThemeId = "milagre-blue";
export const themes: readonly ThemeDefinition[] = [...milagreThemes, ...catppuccinThemes, ...popularThemes];
export const byId = new Map<string, ThemeDefinition>(themes.map((theme) => [theme.id, theme]));
export const getTheme = (id: string) => byId.get(id);
