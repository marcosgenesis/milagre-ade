import type { ModelOption, ModelCapabilities, ModelCapability, EffortLevel } from "./model.ts";

/** The Claude models Claude Code 2.1.288 offers fast mode on; a guess until Claude reports its own list. */
const CLAUDE_FAST_MODELS = ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"];

/** What the agent reported for this model, or a cautious guess while it hasn't answered. */
export function capabilityFor(model: ModelOption, capabilities: ModelCapabilities | null): ModelCapability {
  const reported = capabilities?.[model.provider][model.id];
  if (reported) return reported;
  // Every GPT model codex-cli 0.160.0 lists has the "priority" tier.
  if (model.provider === "codex") return { efforts: ["low", "medium", "high"], ultracode: false, fastMode: true };
  const fastMode = CLAUDE_FAST_MODELS.includes(model.id);
  if (model.id.includes("haiku")) return { efforts: [], ultracode: false, fastMode };
  const modern = /claude-(opus|sonnet|fable)-5/.test(model.id);
  return { efforts: modern ? ["low", "medium", "high", "xhigh", "max"] : ["low", "medium", "high", "max"], ultracode: modern, fastMode };
}

/** Keeps the chosen effort when the model takes it, else its default, else the nearest middle level. */
export function effortFor(capability: ModelCapability, effort: EffortLevel): EffortLevel | undefined {
  const { efforts } = capability;
  if (efforts.length === 0) return undefined;
  if (efforts.includes(effort)) return effort;
  if (capability.defaultEffort && efforts.includes(capability.defaultEffort)) return capability.defaultEffort;
  return efforts.includes("high") ? "high" : efforts[Math.floor(efforts.length / 2)];
}

/**
 * The maintained list: what codex-cli 0.160.0 and Claude Code 2.1.288 report, recommended model first.
 * The picker shows it until the agents report their own lists (agent:models), and for an agent whose
 * CLI is missing, too old or couldn't be asked.
 */
export const MODEL_CATALOG: ModelOption[] = [
  { id: "gpt-6.1-sol", name: "GPT-6.1-Sol", provider: "codex", description: "Latest generation workhorse model", recommended: true },
  { id: "gpt-6-astra", name: "GPT-6-Astra", provider: "codex", description: "Frontier intelligence for the most demanding work" },
  { id: "gpt-6-sol", name: "GPT-6-Sol", provider: "codex", description: "Previous generation workhorse model" },
  { id: "gpt-6-luna", name: "GPT-6-Luna", provider: "codex", description: "Fast and affordable model for easier tasks" },
  { id: "gpt-5.6-sol", name: "GPT-5.6-Sol", provider: "codex", description: "Older generation workhorse model" },
  { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", provider: "codex", description: "Older balanced model for straightforward work" },
  { id: "gpt-5.6-luna", name: "GPT-5.6-Luna", provider: "codex", description: "Older fast and efficient model" },
  { id: "gpt-5.5", name: "GPT-5.5", provider: "codex", description: "Legacy coding model" },
  { id: "claude-opus-5-5", name: "Opus 5.5", provider: "claude", description: "For complex work and everyday tasks", recommended: true },
  { id: "claude-fable-5-1", name: "Fable 5.1", provider: "claude", description: "For your toughest challenges" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", provider: "claude", description: "Most efficient for simpler tasks" },
  { id: "claude-haiku-4-5", name: "Haiku 4.5", provider: "claude", description: "Fastest for quick answers" },
  { id: "claude-sonnet-5", name: "Sonnet 5", provider: "claude", description: "Efficient for routine tasks" },
  { id: "claude-opus-5", name: "Opus 5", provider: "claude", description: "Best for everyday, complex tasks" },
  { id: "claude-fable-5", name: "Fable 5", provider: "claude", description: "Most capable for your hardest and longest-running tasks" },
  { id: "claude-opus-4-8", name: "Opus 4.8", provider: "claude", description: "Best for everyday, complex tasks" },
  { id: "claude-opus-4-7", name: "Opus 4.7", provider: "claude", description: "Best for everyday, complex tasks" },
  { id: "claude-opus-4-6", name: "Opus 4.6", provider: "claude", description: "Best for everyday, complex tasks" },
  { id: "claude-sonnet-4-6", name: "Sonnet 4.6", provider: "claude", description: "Efficient for routine tasks" },
];

