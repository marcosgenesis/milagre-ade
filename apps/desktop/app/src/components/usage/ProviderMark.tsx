import { HugeiconsIcon } from "@hugeicons/react";
import { ChatGptIcon, ClaudeIcon } from "@hugeicons/core-free-icons";
import type { ModelProvider } from "../../model";
import { ANTIGRAVITY_PATH } from "../ProviderLogo";

const MARKS = { claude: ClaudeIcon, codex: ChatGptIcon } as const;

export function ProviderMark({ provider, size = 12 }: { provider: ModelProvider; size?: number }) {
  // Hugeicons has no Antigravity mark, so it is Lobe Icons' filled one, the same as ProviderLogo.
  if (provider === "antigravity")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden="true" className="shrink-0">
        <path d={ANTIGRAVITY_PATH} />
      </svg>
    );
  return <HugeiconsIcon icon={MARKS[provider]} size={size} strokeWidth={1.8} color="currentColor" />;
}
