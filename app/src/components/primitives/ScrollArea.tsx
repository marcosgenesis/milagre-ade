import { type HTMLAttributes, type Ref, useImperativeHandle, useRef } from "react";
import { useScrollFade } from "../../lib/use-scroll-fade";

/**
 * The app's scroll container: vertical scroll that stays inside it, the shared thin scrollbar from styles.css, and
 * edge fades that show only while there's more to scroll that way. Every scrolling list or panel uses this instead
 * of wiring overflow, overscroll and useScrollFade by hand. Cap its height through the parent (a max-height flex
 * column) or a class.
 */
export function ScrollArea({ as: Tag = "div", ref, className = "", ...props }: HTMLAttributes<HTMLElement> & {
  as?: "div" | "ul" | "ol";
  ref?: Ref<HTMLElement>;
}) {
  const inner = useRef<HTMLElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLElement, []);
  useScrollFade(inner);
  return <Tag ref={inner as Ref<never>} className={`scroll-fade min-h-0 overflow-y-auto overscroll-contain ${className}`} {...props} />;
}
