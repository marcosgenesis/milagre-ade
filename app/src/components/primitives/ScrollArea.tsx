import { type HTMLAttributes, type Ref, useImperativeHandle, useRef } from "react";
import { useScrollFade } from "../../lib/use-scroll-fade";

/**
 * The app's scroll container: vertical scroll that stays inside it, the shared thin scrollbar from styles.css, and
 * edge fades that show only while there's more to scroll that way. Every scrolling list or panel uses this instead
 * of wiring overflow, overscroll and useScrollFade by hand. Cap its height through the parent (a max-height flex
 * column) or a class. Inside another scroller (tool output in the transcript), pass `chainScroll` so the wheel moves
 * on to the outer one once this one reaches its end.
 */
export function ScrollArea({ as: Tag = "div", ref, chainScroll = false, className = "", ...props }: HTMLAttributes<HTMLElement> & {
  as?: "div" | "ul" | "ol";
  ref?: Ref<HTMLElement>;
  chainScroll?: boolean;
}) {
  const inner = useRef<HTMLElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLElement, []);
  useScrollFade(inner);
  return <Tag ref={inner as Ref<never>} className={`scroll-fade min-h-0 overflow-y-auto ${chainScroll ? "" : "overscroll-contain"} ${className}`} {...props} />;
}
