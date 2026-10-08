import type { SimulatorTheme } from "@milagre/shared/simulator-receiver";

/** The app palette for the controls of embedded simulator and browser viewers; the captured screen keeps its own colors. */
export function viewerTheme(): SimulatorTheme {
  const root = document.documentElement,
    style = getComputedStyle(root);
  const color = (name: string) => style.getPropertyValue(name).trim();
  return {
    scheme: root.classList.contains("dark") ? "dark" : "light",
    surface: color("--surface"),
    ink: color("--ink"),
    ink2: color("--ink-2"),
    line: color("--line"),
    hover: color("--hover"),
    accent: color("--accent"),
  };
}
