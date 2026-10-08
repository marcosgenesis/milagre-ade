import { useEffect, useRef, useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PaintBoardIcon, SmartphoneIcon } from "@hugeicons/core-free-icons";
import Tooltip from "../primitives/Tooltip";
import { isModalOpen } from "../../lib/modal";

/** A side panel the open Chat can show: whether it is open, and what shows or hides it. */
export type SidePanel = { open: boolean; toggle: () => void };
type PanelName = "designs" | "simulator";

// The Chat's designs and its simulator register here while they have something to show, so the window's top-right
// corner can offer a button for each without owning their state.
let panels: Partial<Record<PanelName, SidePanel>> = {};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => panels;

/** Offers this panel's button while `panel` is set; null takes it away (the Chat has no designs, or no simulator). */
export function useSidePanel(name: PanelName, panel: SidePanel | null) {
  const open = panel?.open;
  // The button calls the newest toggle, so a toggle made anew each render doesn't publish the panel again: only
  // opening and closing it does.
  const toggle = useRef(panel?.toggle);
  toggle.current = panel?.toggle;
  useEffect(() => {
    if (open === undefined) return;
    panels = { ...panels, [name]: { open, toggle: () => toggle.current?.() } };
    listeners.forEach((listener) => listener());
    return () => {
      const { [name]: _gone, ...rest } = panels;
      panels = rest;
      listeners.forEach((listener) => listener());
    };
  }, [name, open]);
}

/** The panels with a button now. */
export function useSidePanels() {
  return useSyncExternalStore(subscribe, snapshot);
}

// ⌘⇧D is the changes panel's, ⌘⇧T the theme's and ⌘⇧L the canvas's (App handles those).
const BUTTONS: { name: PanelName; label: string; icon: typeof PaintBoardIcon; shortcut: string; key: string }[] = [
  { name: "designs", label: "designs", icon: PaintBoardIcon, shortcut: "⌘⇧E", key: "e" },
  { name: "simulator", label: "simulator", icon: SmartphoneIcon, shortcut: "⌘⇧S", key: "s" },
];

/**
 * The corner's buttons sit 40px apart (32px wide, 8px between): wide enough that the shortcut hints under them, shown
 * while ⌘ is held, don't run into each other. What sits left of them moves this much per button.
 */
export const CORNER_PITCH = 40;

/** How many buttons PanelToggles shows, for what sits left of them. */
export const sidePanelCount = (shown: Partial<Record<PanelName, SidePanel>>) => BUTTONS.filter(({ name }) => shown[name]).length;

/**
 * The top-right buttons for the Chat's designs and simulator, left of the changes toggle, `right` pixels from the
 * window's edge. A button shows only while its Chat has something for it.
 */
export function PanelToggles({ right }: { right: number }) {
  const shown = useSidePanels();
  // Each button's shortcut, while its button shows.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isModalOpen()) return;
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
      const button = BUTTONS.find(({ key }) => key === event.key.toLowerCase());
      const panel = button && panels[button.name];
      if (!panel) return;
      event.preventDefault();
      panel.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const buttons = BUTTONS.filter(({ name }) => shown[name]);
  if (!buttons.length) return null;
  return (
    // Same line as the traffic lights and the changes toggle (top 14px, 32px tall).
    <div data-slot="panel-toggles" className="fixed top-[14px] z-[60] flex gap-2 [-webkit-app-region:no-drag]" style={{ right }}>
      {buttons.map(({ name, label, icon, shortcut }) => {
        const panel = shown[name]!;
        return (
          <Tooltip key={name} label={panel.open ? `Hide ${label}` : `Show ${label}`} shortcut={shortcut} compactHint side="bottom" align="end">
            <button
              type="button"
              aria-label={`Toggle ${label} panel`}
              aria-pressed={panel.open}
              data-panel-toggle={name}
              onClick={panel.toggle}
              className={`flex size-8 items-center justify-center rounded-control transition-colors hover:bg-hover hover:text-ink ${panel.open ? "bg-hover text-ink" : "text-ink-3"}`}
            >
              <HugeiconsIcon icon={icon} size={18} strokeWidth={1.8} color="currentColor" />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
