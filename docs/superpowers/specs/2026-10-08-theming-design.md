# Theming

Date: 2026-10-08. Status: approved design, spec for review.

## Goal

Let people change how Milagre looks, on the Mac and the phone. The default
becomes **Milagre Blue**, a blue-tinted palette; today's palette stays as
**Gray**. Catppuccin and other popular editor themes are available, every
surface follows the theme, and a **Custom theme** built from a few colors
lives behind Experimental.

Decisions made with Victor:

- Milagre Blue tints the surfaces, not only the accent: navy in dark,
  cool blue-white in light, with a brighter blue accent.
- Themes are families. Each has a light and a dark palette, and the existing
  System / Light / Dark mode picks which one shows.
- The choice is per device. Nothing syncs through the daemon.
- The custom theme is built from three seed colors per mode (background,
  text, accent). Every other token is derived.
- Everyone moves to Milagre Blue when this ships, including existing users.
  Nobody has picked a theme yet, so there is nothing to preserve.

Designs on the Chat canvas: `theme-picker-desktop` (Settings › Appearance)
and `custom-theme-editor` (Experimental › Custom theme).

## Themes

| Group      | Theme        | Dark palette     | Light palette    |
| ---------- | ------------ | ---------------- | ---------------- |
| Milagre    | Milagre Blue | new              | new              |
| Milagre    | Gray         | today's `.dark`  | today's `:root`  |
| Catppuccin | Mocha        | Mocha            | Latte            |
| Catppuccin | Macchiato    | Macchiato        | Latte            |
| Catppuccin | Frappé       | Frappé           | Latte            |
| Popular    | Tokyo Night  | Night            | Day              |
| Popular    | Dracula      | Dracula          | Alucard          |
| Popular    | Nord         | Polar Night      | Snow Storm       |
| Popular    | Rosé Pine    | Main             | Dawn             |
| Popular    | Gruvbox      | Dark (medium)    | Light (medium)   |
| Popular    | Solarized    | Dark             | Light            |
| Popular    | One Dark     | One Dark         | One Light        |

Palette values come from each theme's official published palette. Where
a theme's spec has no direct value for one of our tokens (`hover-2`,
`line-soft`, tints), the token is derived the same way the custom theme
derives it.

Milagre Blue starting values (tune visually during PR 1):

- Dark: `page` oklch(0.2 0.03 258), `surface` oklch(0.25 0.035 258), `ink`
  oklch(0.95 0.012 255), `accent` oklch(0.68 0.17 253).
- Light: `page` oklch(0.98 0.008 250), `canvas` oklch(0.955 0.015 250),
  `surface` white, `accent` oklch(0.6 0.2 255).

## Token set

One shape, `ThemePalette`, shared by both apps. Names follow desktop's CSS
variables; the phone maps them to its camelCase keys.

- Surfaces: `page`, `canvas`, `surface`, `inset`, `hover`, `hover2`, `field`
- Ink: `ink`, `ink2`, `ink3`, `onAccent`
- Lines: `line`, `lineStrong`, `lineSoft`
- Accent: `accent`, `accentInk`, `accentTint`
- Status: `green`, `greenTint`, `orange`, `orangeTint`, `red`, `redTint`, `purple`
- Tooltip: `tooltipBg`, `tooltipFg`, `tooltipMuted`, `tooltipBorder`
- Diff: `diffAdd`, `diffAddWord`, `diffRemove`, `diffRemoveWord`
- Terminal: 16 ANSI colors plus `cursor` and `selection`
- Syntax: the existing `SyntaxKind` set from `file-syntax.mjs`: `plain`,
  `comment`, `keyword`, `string`, `number`, `function`, `type`, `tag`,
  `property`, `operator`, `punctuation`

Shadows, stripes and `grid-line` stay in CSS: they are built from the
tokens above or from black/white alpha, and differ only by mode.

Values are stored as hex strings. Hex works in CSS, React Native, xterm and
SVG without conversion, and the theme sources publish hex.

## Architecture

### Shared registry: `packages/shared/src/themes/`

- `types.ts`: `ThemePalette`, `ThemeDefinition { id, name, group, dark,
  light, darkLabel, lightLabel }`, `ThemeId`, `ThemeMode`.
- `palettes/*.ts`: one file per family.
- `index.ts`: `themes` (ordered list for the picker), `getTheme(id)`,
  `resolvePalette(id, scheme, custom?)`, `DEFAULT_THEME_ID = "milagre-blue"`.
- `derive.ts`: `deriveTheme({ background, text, accent }, scheme)` returns
  a full `ThemePalette`. Works in OKLCH: surfaces step lightness from the
  background, ink levels mix text toward background, tints mix accent into
  background, and status colors keep their hue with lightness matched to the
  background. Also exports `contrastRatio(a, b)` (WCAG).
- Exported from `@milagre/shared` like the other modules.

Unit tests cover every registered palette having every token, `deriveTheme`
staying above 4.5:1 for `ink` on `page` given reasonable seeds, and
`resolvePalette` falling back to Milagre Blue for an unknown id.

### Desktop

Settings (`apps/desktop/app/src/lib/settings.ts`):

- `theme` (System/Light/Dark) is renamed in the UI to **Mode**. The stored
  field stays `theme`, so saved preferences carry over.
- New `colorTheme: ThemeId | "custom"`, default `"milagre-blue"`. `load()`
  validates it against the registry.
- New `customTheme: { light: Seeds; dark: Seeds } | null` and
  `customThemeEnabled: boolean` (the Experimental switch).

Applying (`useApplyTheme`, and `applyThemeNow()` before the first render):
resolve the palette for the current id and scheme, then write it as one
generated `<style id="milagre-theme">` sheet under `html:root`, which
outranks the static values in `styles.css`. The sheet also carries the
translucent variants, so `.translucent` no longer needs hand-copied values. `styles.css` keeps today's Milagre Blue values
as the static fallback, so the first paint before React mounts is already
correct. The `.dark` class stays for shadows, Shiki and `@custom-variant dark`.

What changes to follow the theme:

- **Terminal** (`lib/terminal-sessions.ts`): `terminalTheme()` reads the
  ANSI colors from the palette instead of the hardcoded `LIGHT`/`DARK` tables.
  The existing `MutationObserver` re-applies on change; it also watches
  `style` on `<html>` (or listens to a theme-change event).
- **Code highlighting** (`components/markdown/highlighter.ts`): switch to
  Shiki's `createCssVariablesTheme`, so tokens render as
  `var(--syntax-keyword)` and change with the theme without re-highlighting.
  Desktop diff syntax uses the same tokens.
- **Diff tints**: the `--diff-*` variables move into the palette.
- **Translucent window** (`styles.css` `.translucent` rules): replaced by
  `html:root.translucent` rules in the generated sheet, using
  `color-mix(in srgb, <theme color> <alpha>, transparent)`. `window-translucency.cjs` `OPAQUE_BACKGROUND` becomes a
  value the renderer sends over the existing IPC (the current `page`), so
  the window background matches the theme.
- **Viewers** (`components/agents/viewerTheme.ts`): already reads CSS
  variables; check it picks up the new ones.
- **Leftover hardcoded colors**: `subagent-canvas.css` (18), tag colors and
  `bg-white`/`text-white` uses in `Settings.tsx`, `ChatRow.tsx` and
  `GitActionsDialog.tsx` move to tokens where they represent theme surfaces.
  Provider logos keep their brand colors.

UI (`components/Settings.tsx`):

- **Appearance**: the Mode row (segmented System / Light / Dark), then the
  theme grid in three groups (Milagre, Catppuccin, Popular), three columns,
  Slack style. Each tile has a swatch (page color with an accent quarter),
  the name, and a small line naming the paired light theme. The selected
  tile has an accent ring. Picking applies right away. A **Custom** tile
  appears in the Milagre group once the Experimental switch is on.
- **Experimental › Beta**: a **Custom theme** switch. When on, a Custom
  theme group shows a Light/Dark segment for which palette you're editing,
  three color rows (Background, Text, Accent) with a swatch and hex input
  using the native color picker, a **Start from** menu that copies the
  seeds of any registered theme, a live preview card, a contrast readout
  that turns orange below 4.5:1, and Copy as JSON / Paste JSON / Reset.
  Editing selects Custom as the active theme.
- The command palette's quick settings gain "Theme: <name>" entries.

### Phone

The phone has no theme setting today and `colors` is a module constant, so
it cannot change at runtime.

- `apps/mobile/src/theme.ts` becomes a `ThemeProvider` plus `useTheme()`
  returning `{ colors, scheme, themeId }`. `colors` comes from
  `resolvePalette`, so the hand-converted hex table goes away. `hex(scheme)`
  callers switch to `useTheme().colors`.
- The 21 files that import `colors` move to the hook. `ui.tsx` styles that
  are built with `StyleSheet.create` at import become a
  `useThemedStyles(factory)` helper memoized per palette.
- React Navigation's theme (`app/_layout.tsx`) and the status bar follow the
  palette.
- Terminal (`terminal-receiver.ts`, `terminal.tsx`) and file syntax
  (`file-code.tsx`) read the palette's ANSI and syntax colors.
  `syntaxColors` in `file-syntax.mjs` is replaced by the palette's syntax
  tokens.
- Mode: a System / Light / Dark setting, applied with
  `Appearance.setColorScheme`.
- Storage: SecureStore like Murilo mode, key `milagre.theme.v1`, holding
  `{ mode, colorTheme, customThemeEnabled, customTheme }`.
- UI: a new **Appearance** row in Settings opens a page with the Mode
  segmented control and the same three-group grid as two columns of tiles.
  Experimental gains the Custom theme switch and editor: three color rows
  with hex input and a preset swatch row (the phone has no system color
  picker without a native module), Start from, preview, contrast readout,
  Paste JSON and Copy JSON.
- No native changes. `app.json` splash colors stay as they are, so this
  ships as an OTA with no new build. Check the fingerprint before merging.

Embedded viewers (`simulator-receiver.mjs`, `browser-receiver.mjs`) take
the palette's values through the existing `SimulatorTheme` path on both
platforms instead of their inline `#0285ff` defaults.

## Error handling

- An unknown or removed theme id falls back to Milagre Blue on load.
- Pasted JSON is validated (three hex seeds per mode). Invalid input shows
  an inline error and changes nothing.
- A custom theme with low contrast is allowed but flagged. We don't block it.
- Turning off the Experimental switch while Custom is active switches back
  to Milagre Blue and keeps the saved seeds.

## Testing

- Unit (`npm test -- --unit`): registry completeness, `deriveTheme`,
  `contrastRatio`, settings `load()` validation and fallback, JSON
  import validation.
- Electron check: a new `scripts/test-theming.cjs` that opens Appearance,
  picks Catppuccin Mocha, asserts `--page` on `<html>` and the xterm
  background changed, toggles Light and asserts Latte values, enables
  Custom in Experimental, sets an accent, and asserts it applies. It saves
  screenshots for the PR when `MILAGRE_SCREENSHOT_DIR` is set.
- Phone: verify on a slim simulator with a local dev build. Walk Appearance,
  switch themes, and check chat, terminal, file view, diff and settings. Take
  screenshots for the PR.

## Delivery

Three PRs, each verified on both platforms where it applies:

1. **Registry + desktop themes.** Shared registry with all 12 themes,
   desktop apply, terminal, Shiki, diff, translucency, viewers, Appearance
   grid. Milagre Blue becomes the default.
2. **Phone themes.** `useTheme` migration, Appearance page, terminal and
   syntax, viewers. Published as an OTA after merge.
3. **Custom theme on both.** `deriveTheme`, the Experimental switch and
   editor, JSON copy and paste.

PR 1 changes desktop's default look before the phone follows. The gap lasts
until PR 2's OTA, which is acceptable because settings are per device anyway.

## Out of scope

- Syncing the theme between devices.
- Per-project or per-Worktree themes.
- Vision-assistive (color-blind) presets. Can be added later as a group.
- Importing VS Code theme files.
- Changing the app icon or native splash per theme.
