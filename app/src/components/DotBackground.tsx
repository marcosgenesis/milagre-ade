import type { ReactNode } from "react";
import { useSettings } from "../lib/settings";

export function DotBackground({ children }: { children: ReactNode }) {
  const { windowTranslucent, translucentDots } = useSettings();
  const dots = !windowTranslucent || translucentDots;
  return (
    <div className="relative h-screen overflow-hidden bg-page">
      {dots && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 [background-size:20px_20px] [background-image:radial-gradient(var(--line-strong)_1px,transparent_1px)] dark:[background-image:radial-gradient(var(--line)_1px,transparent_1px)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-page [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]"
          />
        </>
      )}
      <div className="relative z-10 flex h-full min-h-0">{children}</div>
    </div>
  );
}
