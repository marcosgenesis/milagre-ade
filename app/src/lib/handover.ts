import type { ChatMessage, ModelOption, ModelProvider } from "../model";
import { modelForChat } from "./agent-runs.ts";

export const otherProvider = (provider: ModelProvider): ModelProvider => (provider === "codex" ? "claude" : "codex");
export const providerLabel = (provider: ModelProvider) => (provider === "codex" ? "Codex" : "Claude");

/** Why the handover row is disabled, or null. A running turn would leave work out of the brief. */
export function handoverBlocker({ running, cli }: { running: boolean; cli: string | null }): string | null {
  if (running) return "Stop the turn or wait for it to finish to hand over.";
  return cli;
}

/** The model a handover to `provider` runs on: the last one used on that provider in the project, else its first. Undefined when the catalog has none. */
export function handoverModel(selected: ModelOption, provider: ModelProvider, projectMessages: ChatMessage[], models: ModelOption[]): ModelOption | undefined {
  const model = modelForChat(selected, provider, projectMessages, models);
  return model.provider === provider ? model : undefined;
}
