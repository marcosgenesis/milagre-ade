import { useEffect, useState } from "react";

/**
 * Where the panels docked beside the chat go: the workspace between the sidebar and the git changes panel, which an
 * expanded design fills; `right`, how much of the window's right edge the changes panel takes, so the docks sit to its
 * left and it stays the rightmost; and `top` and `bottom`, the sidebar card's, so every panel lines up with it.
 * From the right: the changes panel, a docked simulator, then the designs.
 */
export function useDockArea() {
  const [area, setArea] = useState<{ left: number; right: number; width: number; top: number; bottom: number } | null>(null);
  useEffect(() => {
    const main = document.querySelector<HTMLElement>("[data-workspace-main]") ?? document.querySelector<HTMLElement>("[data-chat-pane]");
    if (!main) return;
    // The workspace's own width, without the space a dock reserves in it. The changes panel opening narrows <main>.
    const measure = () => {
      const rect = main.getBoundingClientRect();
      const right = document.querySelector("[data-changes-slot]")?.getBoundingClientRect().width ?? 0;
      // Lined up with the sidebar's card, top and bottom.
      const sidebar = document.querySelector("aside[aria-label='Workspace navigation']")?.getBoundingClientRect();
      setArea({
        left: rect.left,
        right,
        width: window.innerWidth - rect.left - right,
        top: sidebar?.top ?? 40,
        bottom: sidebar ? window.innerHeight - sidebar.bottom : 12,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return area;
}

/** Sent when the user expands the designs to fill the workspace: the other side panels close for them. */
export const DESIGNS_EXPANDED = "milagre:designs-expanded";

/** Runs `close` when the designs expand to fill the workspace. */
export function useCloseWhenDesignsExpand(close: () => void) {
  useEffect(() => {
    window.addEventListener(DESIGNS_EXPANDED, close);
    return () => window.removeEventListener(DESIGNS_EXPANDED, close);
  }, [close]);
}
