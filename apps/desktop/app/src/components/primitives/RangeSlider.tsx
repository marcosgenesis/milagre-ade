import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useLayoutEffect, useState } from "react";
import { SPRING_GLIDE } from "../../lib/ease";
import { useSlider } from "../../lib/use-slider";
import type { SliderOptions } from "../../lib/use-slider";

// Grab feedback for the handle's height only.
const SPRING_BOUNCY = { type: "spring", stiffness: 500, damping: 14, mass: 0.7 } as const;
// The handle's centre runs from HANDLE_INSET to width - HANDLE_INSET, and the tick dots follow it.
const HANDLE_INSET = 8;

export interface RangeSliderProps extends SliderOptions {
  /** A tick dot at each step. */
  showTicks?: boolean;
  className?: string;
}

/** After beUI's Range Slider: tick dots and a vertical-bar handle that bounces as it lands on each
 * step. Drag anywhere on the track or use the arrow keys; reduced motion drops the springs. */
export function RangeSlider({ showTicks = true, className = "", ...options }: RangeSliderProps) {
  const reduce = useReducedMotion();
  const { percent, dragging, min, max, step, trackProps, handleProps } = useSlider(options);
  const [trackWidth, setTrackWidth] = useState(176);
  useLayoutEffect(() => {
    const track = trackProps.ref.current;
    if (!track) return;
    const measure = () => {
      const width = track.getBoundingClientRect().width;
      if (width > 0) setTrackWidth(width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [trackProps.ref]);

  // One spring-smoothed position drives the handle and the fill.
  const target = useMotionValue(percent);
  useEffect(() => {
    target.set(percent);
  }, [percent, target]);
  const smooth = useSpring(target, SPRING_GLIDE);
  const position = reduce ? target : smooth;
  const handleX = useTransform(position, (p) => HANDLE_INSET + (Math.max(0, trackWidth - HANDLE_INSET * 2 - 4) * p) / 100);
  // The rounded fill ends at the handle; translating a full-size fill inside the clip keeps its corner round.
  const fillX = useTransform(position, (p) => (p >= 100 ? "0%" : `calc(${p - 100}% + ${14 - 0.16 * p}px)`));

  // Floor, so a range the step does not divide stops its dots at the last whole step.
  const steps = Math.floor(Number(((max - min) / step).toFixed(6)));
  const ticks = showTicks && steps > 0 && steps <= 50 ? Array.from({ length: steps + 1 }, (_, i) => Number((min + i * step).toFixed(6))) : [];

  return (
    <div
      {...trackProps}
      className={`relative flex h-8 touch-none select-none items-center overflow-hidden rounded-control bg-field ${options.disabled ? "pointer-events-none opacity-50" : "cursor-grab active:cursor-grabbing"} ${className}`}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-[2px] inset-y-0 overflow-hidden rounded-control">
        <motion.div className="absolute inset-0 rounded-control bg-ink/15" style={{ x: fillX }} />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left: HANDLE_INSET + 2, right: HANDLE_INSET + 2 }}>
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/25"
            style={{ left: `${((tick - min) / (max - min)) * 100}%` }}
          />
        ))}
      </div>
      <motion.div
        {...handleProps}
        animate={reduce ? undefined : { scaleY: dragging ? 1.35 : 1 }}
        transition={SPRING_BOUNCY}
        className="absolute top-1/2 left-0 h-5 w-1 rounded-full bg-ink outline-none ring-inset ring-ink/30 focus-visible:ring-4"
        style={{ x: handleX, y: "-50%" }}
      />
    </div>
  );
}
