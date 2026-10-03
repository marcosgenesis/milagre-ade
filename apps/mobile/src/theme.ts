import { Appearance, DynamicColorIOS, Platform, type ColorValue } from 'react-native';

// Desktop's tokens (apps/desktop/app/src/styles.css), converted from oklch so both apps share one palette.
const light = {
  page: '#fafafb', canvas: '#f1f2f3', surface: '#ffffff', inset: '#f7f8f9', hover: '#f4f5f6', field: '#f2f2f3',
  ink: '#1f2124', ink2: '#62656b', ink3: '#9a9da3', line: '#ecedef', lineStrong: '#e0e2e5',
  accent: '#0285ff', accentInk: '#0070dd', accentTint: '#e9f3ff',
  green: '#199a4d', greenTint: '#e8f5ed', orange: '#ef720d', orangeTint: '#fdf1e5', red: '#e3474c', redTint: '#fcecec',
  onInk: '#ffffff', idleDot: '#9a9da366', backdrop: '#00000033',
  diffAdd: '#e4f9ea', diffAddWord: '#b1ebc4', diffRemove: '#ffeceb', diffRemoveWord: '#ffc9c8',
};
const dark: typeof light = {
  page: '#17181a', canvas: '#1c1d1f', surface: '#232427', inset: '#1f2022', hover: '#2a2b2e', field: '#2b2c2f',
  ink: '#f2f3f4', ink2: '#a5a8ad', ink3: '#6c6f75', line: '#2e3033', lineStrong: '#3a3c40',
  accent: '#3d9aff', accentInk: '#7ec0ff', accentTint: '#3d9aff29',
  green: '#3cbb72', greenTint: '#3cbb7224', orange: '#f68f3c', orangeTint: '#f68f3c24', red: '#ee5c61', redTint: '#ee5c6124',
  onInk: '#17181a', idleDot: '#6c6f7566', backdrop: '#00000066',
  diffAdd: '#3cbb721f', diffAddWord: '#3cbb724d', diffRemove: '#ee5c611f', diffRemoveWord: '#ee5c614d',
};
export type Palette = { [K in keyof typeof light]: ColorValue };
// iOS resolves dynamic colors natively, so the app follows light and dark mode without re-rendering.
export const colors = Object.fromEntries(Object.keys(light).map(key => {
  const name = key as keyof typeof light;
  return [name, Platform.OS === 'ios' ? DynamicColorIOS({ light: light[name], dark: dark[name] }) : Appearance.getColorScheme() === 'dark' ? dark[name] : light[name]];
})) as Palette;
/** Raw hex values, for SVG and native components that cannot take a dynamic color. */
export const hex = (scheme: string | null | undefined) => scheme === 'dark' ? dark : light;
export const fonts = { mono: Platform.OS === 'ios' ? 'Menlo' : 'monospace' };
