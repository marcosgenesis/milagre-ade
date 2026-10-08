import type { AdvisorResultContext } from "./model.ts";
export function advisorResultLabel(context: AdvisorResultContext): string {
  const provider = context.provider === "codex" ? "Codex" : "Claude";
  const outcome = context.outcome === "completed" ? "result" : context.outcome === "failed" ? "failed" : "stopped";
  return `${provider} advisor ${outcome}: ${context.title}`;
}
