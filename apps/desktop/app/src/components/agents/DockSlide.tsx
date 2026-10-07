import { forwardRef, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { motion, useMotionValue, useMotionValueEvent, useReducedMotion, animate } from "motion/react";
import { EASE_OUT, SPRING_LAYOUT } from "../../lib/ease";

/**
 * A panel docked at the window's right, entering the way the git changes panel does: its width springs open from
 * zero, the chat making room as it grows (through `reserve`, the CSS variable the chat panes read), and its content
 * slides in from the right as it fades in. Closing (under AnimatePresence) runs it backwards. `width` null lays it out
 * by its own `style` instead (a panel filling the workspace), which only fades.
 */
export const DockSlide = forwardRef<
  HTMLDivElement,
  {
    width: number | null;
    reserve: string;
    style: CSSProperties;
    className: string;
    children: ReactNode;
    onEntered?: () => void;
  } & Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "children">
>(function DockSlide({ width, reserve, style, className, children, onEntered, ...rest }, ref) {
  const reduced = useReducedMotion();
  const shown = useMotionValue(reduced || width === null ? (width ?? 0) : 0);
  const [sliding, setSliding] = useState(!reduced && width !== null);
  // The chat's room follows the panel's width as it springs, as it follows the changes panel's.
  useMotionValueEvent(shown, "change", (value) => {
    if (width !== null) document.documentElement.style.setProperty(reserve, `${value > 0.5 ? value + 12 : 0}px`);
  });
  useEffect(() => {
    if (width === null) {
      document.documentElement.style.removeProperty(reserve);
      return;
    }
    if (reduced) {
      shown.set(width);
      document.documentElement.style.setProperty(reserve, `${width + 12}px`);
    } else {
      setSliding(true);
      const controls = animate(shown, width, { ...SPRING_LAYOUT, onComplete: () => setSliding(false) });
      return () => controls.stop();
    }
  }, [width, reduced, reserve, shown]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty(reserve);
    },
    [reserve],
  );
  return (
    <motion.div
      ref={ref}
      {...(rest as object)}
      // Laid out by its own style, the width it sprang to must go too, or it would outrank `right`.
      style={width === null ? { ...style, width: "auto" } : { ...style, width: shown }}
      // Clipped only while the width moves: clipped at rest it would cut the panel's shadow.
      className={`${className} ${sliding ? "overflow-hidden" : ""}`}
      exit={
        reduced
          ? { opacity: 0, transition: { duration: 0 } }
          : width === null
            ? { opacity: 0, transition: { duration: 0.18 } }
            : { width: 0, transition: SPRING_LAYOUT }
      }
      onAnimationComplete={(definition: unknown) => {
        if (definition && typeof definition === "object" && "width" in definition) document.documentElement.style.removeProperty(reserve);
      }}
    >
      <motion.div
        className="flex min-h-0 flex-1 flex-col"
        style={width === null ? undefined : { width, minWidth: width }}
        initial={reduced ? false : { opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduced ? undefined : { opacity: 0, x: 24 }}
        transition={reduced ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT }}
        onAnimationComplete={onEntered}
      >
        {children}
      </motion.div>
    </motion.div>
  );
});
