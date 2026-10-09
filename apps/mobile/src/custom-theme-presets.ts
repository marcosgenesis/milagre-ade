import { resolvePalette, type Scheme, type ThemeSeeds } from "@milagre/shared/themes";

/** Milagre Blue, Catppuccin Mocha, Dracula, Nord, Rosé Pine, Gruvbox, Tokyo Night and One Dark. */
const PRESET_THEMES = ["milagre-blue", "catppuccin-mocha", "dracula", "nord", "rose-pine", "gruvbox", "tokyo-night", "one-dark"];

/** Eight swatches per seed, taken from those themes' page, ink and accent in the scheme being edited. */
export function presets(scheme: Scheme): Record<keyof ThemeSeeds, string[]> {
  const palettes = PRESET_THEMES.map((id) => resolvePalette(id, scheme));
  return { background: palettes.map((p) => p.page), text: palettes.map((p) => p.ink), accent: palettes.map((p) => p.accent) };
}
