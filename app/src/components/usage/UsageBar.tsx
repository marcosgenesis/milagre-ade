import { usageTone } from "./format";

const FILL = { normal: "bg-ink-2", warning: "bg-orange", critical: "bg-red" } as const;

export function UsageBar({ usedPercent, className }: { usedPercent: number; className: string }) {
  return (
    <span aria-hidden className={`relative block shrink-0 overflow-hidden rounded-full bg-line-strong ${className}`}>
      <span
        className={`absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-300 ease-out motion-reduce:transition-none ${FILL[usageTone(usedPercent)]}`}
        style={{ width: `${usedPercent}%` }}
      />
    </span>
  );
}
