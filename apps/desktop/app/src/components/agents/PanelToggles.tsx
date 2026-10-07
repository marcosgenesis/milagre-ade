import { useEffect, useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PaintBoardIcon, SmartphoneIcon } from "@hugeicons/core-free-icons";
import Tooltip from "../primitives/Tooltip";

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
  const toggle = panel?.toggle;
  useEffect(() => {
    if (open === undefined || !toggle) return;
    panels = { ...panels, [name]: { open, toggle } };
    listeners.forEach((listener) => listener());
    return () => {
      const { [name]: _gone, ...rest } = panels;
      panels = rest;
      listeners.forEach((listener) => listener());
    };
  }, [name, open, toggle]);
}

/** The panels with a button now. */
export function useSidePanels() {
  return useSyncExternalStore(subscribe, snapshot);
}

const BUTTONS: { name: PanelName; label: string; icon: typeof PaintBoardIcon }[] = [
  { name: "designs", label: "designs", icon: PaintBoardIcon },
  { name: "simulator", label: "simulator", icon: SmartphoneIcon },
];

/** How many buttons PanelToggles shows, for what sits left of them. */
export const sidePanelCount = (shown: Partial<Record<PanelName, SidePanel>>) => BUTTONS.filter(({ name }) => shown[name]).length;

/**
 * The top-right buttons for the Chat's designs and simulator, left of the changes toggle, `right` pixels from the
 * window's edge. A button shows only while its Chat has something for it.
 */
export function PanelToggles({ right }: { right: number }) {
  const shown = useSidePanels();
  const buttons = BUTTONS.filter(({ name }) => shown[name]);
  if (!buttons.length) return null;
  return (
    // Same line as the traffic lights and the changes toggle (top 14px, 32px tall).
    <div data-slot="panel-toggles" className="fixed top-[14px] z-[60] flex gap-1 [-webkit-app-region:no-drag]" style={{ right }}>
      {buttons.map(({ name, label, icon }) => {
        const panel = shown[name]!;
        return (
          <Tooltip key={name} label={panel.open ? `Hide ${label}` : `Show ${label}`} side="bottom" align="end">
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
