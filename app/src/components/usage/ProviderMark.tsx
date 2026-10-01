import { HugeiconsIcon } from "@hugeicons/react";
import { ChatGptIcon, ClaudeIcon } from "@hugeicons/core-free-icons";
import type { ModelProvider } from "../../model";

const MARKS = { claude: ClaudeIcon, codex: ChatGptIcon } as const;

export function ProviderMark({ provider, size = 12 }: { provider: ModelProvider; size?: number }) {
  return <HugeiconsIcon icon={MARKS[provider]} size={size} strokeWidth={1.8} color="currentColor" />;
}
