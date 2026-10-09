import { useEffect, useRef } from "react";

/**
 * The one way a transient surface (a picker, menu or anchored popover) closes: a pointer press anywhere
 * outside it, or the window losing focus to anything but an iframe inside it. Escape is the caller's, since it also decides where focus goes.
 * Listens in the capture phase so a handler that stops propagation (the terminal, a drag surface) can't
 * keep it open. `inside` decides what counts as the surface: its panel and its trigger, so the trigger's
 * own click still toggles it.
 *
 * A scroll outside the surface or a window resize moves its trigger. A surface anchored to a trigger
 * passes `follow`, which repositions it; one anchored to a point (a context menu) closes instead.
 *
 * While anything is open, `<html>` carries `data-popover-open`, which turns the title-bar drag strip into
 * a plain surface (styles.css). The window never sees a press on a drag region, so without this a click
 * on the title bar would leave the popover open.
 */
export function useDismiss(open: boolean, close: () => void, inside: (target: Element) => boolean, follow?: () => void) {
  const latest = useRef({ close, inside, follow });
  latest.current = { close, inside, follow };

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!(event.target instanceof Element) || !latest.current.inside(event.target)) latest.current.close();
    };
    const moved = (event: Event) => {
      if (event.target instanceof Element && latest.current.inside(event.target)) return;
      (latest.current.follow ?? latest.current.close)();
    };
    // Focus moving into an embedded viewer (a simulator or browser iframe in the panel) blurs the window too; that stays inside.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const dismiss = () => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        const active = document.activeElement;
        if (active instanceof HTMLIFrameElement && latest.current.inside(active)) return;
        latest.current.close();
      }, 0);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    window.addEventListener("blur", dismiss);
    openCount += 1;
    document.documentElement.toggleAttribute("data-popover-open", true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
      window.removeEventListener("blur", dismiss);
      clearTimeout(pending);
      openCount -= 1;
      if (openCount === 0) document.documentElement.toggleAttribute("data-popover-open", false);
    };
  }, [open]);
}

let openCount = 0;
