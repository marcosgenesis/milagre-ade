import { providerName } from "./providers.mjs";
import type { AdvisorResultContext } from "./model.ts";
export function advisorResultLabel(context: AdvisorResultContext): string {
  const provider = providerName(context.provider);
  const outcome = context.outcome === "completed" ? "result" : context.outcome === "failed" ? "failed" : "stopped";
  return `${provider} advisor ${outcome}: ${context.title}`;
}

/** Provider input roles remain user/assistant; clients identify host context as app-owned. */
export function messageSender(message: Pick<import("./model.ts").ChatMessage, "role" | "context">): "app" | "user" | "assistant" {
  return typeof message.context === "object" && message.context?.kind === "advisor-result" ? "app" : (message.role ?? "assistant");
}
