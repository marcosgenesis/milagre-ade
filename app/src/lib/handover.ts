import type { ModelProvider } from "../model";

export const otherProvider = (provider: ModelProvider): ModelProvider => (provider === "codex" ? "claude" : "codex");
export const providerLabel = (provider: ModelProvider) => (provider === "codex" ? "Codex" : "Claude");

/** Why the handover row is disabled, or null. A running turn would leave work out of the brief. */
export function handoverBlocker({ running, cli }: { running: boolean; cli: string | null }): string | null {
  if (running) return "Stop the turn or wait for it to finish to hand over.";
  return cli;
}
