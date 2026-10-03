import { type RefObject, useEffect } from "react";

/** Marks a scroll container with data-fade-top / data-fade-bottom while there's more to scroll that way; `.scroll-fade` turns them into edge fades. */
export function useScrollFade(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = element;
      element.toggleAttribute("data-fade-top", scrollTop > 1);
      element.toggleAttribute("data-fade-bottom", scrollTop + clientHeight < scrollHeight - 1);
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    // Content changes (new chats, filtered commands) change what's left to scroll.
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    const mutations = new MutationObserver(() => {
      for (const child of Array.from(element.children)) observer.observe(child);
      update();
    });
    mutations.observe(element, { childList: true, subtree: true });
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
      mutations.disconnect();
    };
  }, [ref]);
}
