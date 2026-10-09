import type { Scheme, ThemePalette } from "@milagre/shared/themes";

export const THEME_EVENT = "milagre-theme";
const kebab = (key: string) =>
  key
    .replace(/([a-z])([A-Z0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Za-z])/g, "$1-$2")
    .toLowerCase();
const SHIKI: Record<string, keyof ThemePalette["syntax"]> = {
  "--shiki-foreground": "plain",
  "--shiki-token-comment": "comment",
  "--shiki-token-keyword": "keyword",
  "--shiki-token-string": "string",
  "--shiki-token-string-expression": "string",
  "--shiki-token-constant": "number",
  "--shiki-token-function": "function",
  "--shiki-token-parameter": "property",
  "--shiki-token-punctuation": "punctuation",
  "--shiki-token-link": "type",
};

/** A translucent variant: the color keeps `1 - amount` of its opacity. */
const see = (color: string, amount: string) => `color-mix(in srgb, ${color} calc((1 - ${amount}) * 100%), transparent)`;

/** The resolved theme as one stylesheet; `html:root` outranks the static fallbacks in styles.css. */
export function themeStylesheet(palette: ThemePalette, scheme: Scheme) {
  const lines: string[] = [];
  // `purple` stays Ultracode's brand color on desktop (styles.css), like the provider logos.
  for (const [key, value] of Object.entries(palette)) if (typeof value === "string" && key !== "purple") lines.push(`--${kebab(key)}: ${value};`);
  palette.ansi.forEach((color, index) => lines.push(`--ansi-${index}: ${color};`));
  for (const [kind, color] of Object.entries(palette.syntax)) lines.push(`--syntax-${kind}: ${color};`);
  for (const [name, kind] of Object.entries(SHIKI)) lines.push(`${name}: ${palette.syntax[kind]};`);
  const surfaceShare = scheme === "dark" ? "0.95" : "0.7";
  return `html:root {
  ${lines.join("\n  ")}
}
html:root.translucent {
  --page: ${see(palette.page, "var(--window-translucency, 0.8)")};
  --surface: ${see(palette.surface, `var(--panel-translucency, 0.4) * ${surfaceShare}`)};
  --inset: ${see(palette.inset, "var(--panel-translucency, 0.4)")};
  --field: ${see(palette.field, "var(--panel-translucency, 0.4)")};
}`;
}

export function applyPalette(palette: ThemePalette, scheme: Scheme) {
  let sheet = document.getElementById("milagre-theme") as HTMLStyleElement | null;
  if (!sheet) {
    sheet = document.createElement("style");
    sheet.id = "milagre-theme";
    document.head.appendChild(sheet);
  }
  sheet.textContent = themeStylesheet(palette, scheme);
  window.dispatchEvent(new Event(THEME_EVENT));
}
