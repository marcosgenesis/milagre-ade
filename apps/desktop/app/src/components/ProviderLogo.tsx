import { useId } from "react";
import { ANTIGRAVITY_LOGO, CLAUDE_LOGO, CODEX_LOGO } from "@milagre/shared/provider-logos";
import type { ModelProvider } from "../model";

/** Each agent's brand mark in its own colors (shapes in @milagre/shared/provider-logos). */
export function ProviderLogo({ provider, size = 15 }: { provider: ModelProvider; size?: number }) {
  // Gradient, mask and filter ids are per instance: two logos on one page must not share them.
  const id = `logo${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      {provider === "claude" && <path d={CLAUDE_LOGO.d} fill={CLAUDE_LOGO.fill} />}
      {provider === "codex" && (
        <>
          <defs>
            <linearGradient id={`${id}-codex`} gradientUnits="userSpaceOnUse" x1="12" x2="12" y1="0" y2="24">
              {CODEX_LOGO.stops.map((stop) => (
                <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
              ))}
            </linearGradient>
          </defs>
          <path d={CODEX_LOGO.d} fill={`url(#${id}-codex)`} fillRule="evenodd" clipRule="evenodd" />
        </>
      )}
      {provider === "antigravity" && (
        <>
          <defs>
            <mask id={`${id}-arch`} maskUnits="userSpaceOnUse" x="0" y="1" width="24" height="23">
              <path d={ANTIGRAVITY_LOGO.d} fill="#fff" />
            </mask>
            {ANTIGRAVITY_LOGO.blobs.map((blob) => (
              <filter
                key={blob.id}
                id={`${id}-${blob.id}`}
                filterUnits="userSpaceOnUse"
                x={blob.region[0]}
                y={blob.region[1]}
                width={blob.region[2]}
                height={blob.region[3]}
                colorInterpolationFilters="sRGB"
              >
                <feGaussianBlur stdDeviation={blob.blur} />
              </filter>
            ))}
          </defs>
          <g mask={`url(#${id}-arch)`}>
            {ANTIGRAVITY_LOGO.blobs.map((blob) => (
              <path key={blob.id} d={blob.d} fill={blob.fill} filter={`url(#${id}-${blob.id})`} />
            ))}
          </g>
        </>
      )}
    </svg>
  );
}
