import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_OUT, SPRING_LAYOUT } from "../../lib/ease";

/**
 * The panel's column beside <main>. Its width springs open from zero so the chat narrows with it instead of
 * jumping; the -12px margin cancels the row's gap while the column is empty, and <main> keeps its own right padding.
 * It clips only while its width moves: clipped at rest, it would cut the panel's shadow at its left edge.
 */
export function ChangesPanelSlot({ open, children }: { open: boolean; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [sliding, setSliding] = useState(false);
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="changes-panel"
          data-changes-slot
          className={`-ml-3 flex min-h-0 shrink-0 ${sliding ? "overflow-hidden" : "overflow-visible"}`}
          onAnimationStart={() => setSliding(true)}
          onAnimationComplete={() => setSliding(false)}
          initial={{ width: 0 }}
          animate={{ width: "auto" }}
          exit={{ width: 0 }}
          transition={reduced ? { duration: 0 } : SPRING_LAYOUT}
        >
          <motion.div
            className="flex min-h-0 pt-[60px] pr-3 pb-3"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={reduced ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
