import { useEffect, useRef } from "react";

/**
 * Closes an open popover when the pointer goes down anywhere outside it, or the window loses focus.
 * Listens in the capture phase so a handler that stops propagation (the terminal, a drag surface) can't keep
 * it open. `inside` decides what counts as the popover: its panel and its trigger, so the trigger's own
 * click still toggles it.
 */
export function useDismiss(open: boolean, close: () => void, inside: (target: Element) => boolean) {
  const latest = useRef({ close, inside });
  latest.current = { close, inside };

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !latest.current.inside(event.target)) latest.current.close();
    };
    const blur = () => latest.current.close();
    document.addEventListener("pointerdown", pointer, true);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("blur", blur);
    };
  }, [open]);
}
