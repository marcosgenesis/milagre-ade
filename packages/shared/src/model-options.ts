import type { ModelOption, ModelCapabilities, ModelCapability, EffortLevel } from "./model.ts";

/** The Claude models Claude Code 2.1.288 offers fast mode on; a guess until Claude reports its own list. */
const CLAUDE_FAST_MODELS = ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"];

/** What the agent reported for this model, or a cautious guess while it hasn't answered. */
export function capabilityFor(model: ModelOption, capabilities: ModelCapabilities | null): ModelCapability {
  const reported = capabilities?.[model.provider][model.id];
  if (reported) return reported;
  // Every GPT model codex-cli 0.160.0 lists has the "priority" tier.
  if (model.provider === "codex") return { efforts: ["low", "medium", "high"], ultracode: false, fastMode: true };
  // Antigravity reports one model per thinking level; the catalog's families carry those levels as efforts. No fast tier.
  if (model.provider === "antigravity") {
    const family = antigravityFamilies(ANTIGRAVITY_AGENT_OPTIONS).find((item) => item.id === model.id);
    return { efforts: family?.efforts ?? [], ...(family?.defaultEffort ? { defaultEffort: family.defaultEffort } : {}), ultracode: false, fastMode: false };
  }
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

// Antigravity (docs/adr/0006-antigravity-over-acp.md) reports one model per thinking level, named "<Family> (<Level>)":
// "Gemini 3.1 Pro (High)", "Gemini 3.1 Pro (Low)". Milagre shows one model per family and offers the levels as its
// efforts, like Claude and Codex. The agent's ids are irregular ("gemini-pro-agent" is Pro at High), so each family
// keeps a table from effort to the agent's own id.

/** One entry of the agent's `model` config option, as session/new reports it. */
export interface AgentModelOption {
  value: string;
  name?: string;
  description?: string;
}

/** One model family: Milagre's id for it, its efforts lightest first, and the agent id for each effort. */
export interface AntigravityFamily {
  id: string;
  name: string;
  efforts: EffortLevel[];
  defaultEffort?: EffortLevel;
  /** The agent model id for each effort; a family without levels has its one id under "". */
  variants: Record<EffortLevel, string>;
  /** The agent options the family was made from, in the agent's order. */
  options: AgentModelOption[];
}

/** What Antigravity 1.3.0 reports, in its order. The picker groups these until a session reports its own. */
export const ANTIGRAVITY_AGENT_OPTIONS: AgentModelOption[] = [
  { value: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
  { value: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
  { value: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
  { value: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)" },
  { value: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
  { value: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)" },
  { value: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)" },
  { value: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)" },
  { value: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)" },
  { value: "gemini-3.6-flash-medium", name: "Gemini 3.6 Flash (Medium)" },
  { value: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)" },
];

/** Milagre's wording and recommendations per family, by family id; the agent describes models only by their ids. */
export const ANTIGRAVITY_FAMILY_COPY: Record<string, { description: string; recommended?: boolean }> = {
  "gemini-3.8-flash": { description: "Fast", recommended: true },
  "gemini-3.1-pro": { description: "Most capable for complex work", recommended: true },
  "gemini-3.7-flash": { description: "Previous generation fast model" },
  "gemini-3.6-flash": { description: "Older fast model" },
};

/** The family the text generator asks, and at which effort: the fastest current model at its lightest level. */
export const ANTIGRAVITY_TEXT_FAMILY = { model: "gemini-3.8-flash", effort: "low" } as const;

const LEVEL_ORDER = ["low", "medium", "high"];
const levelRank = (level: string) => {
  const index = LEVEL_ORDER.indexOf(level);
  return index === -1 ? LEVEL_ORDER.length : index;
};

/** A stable id for a family name: "Gemini 3.1 Pro" -> "gemini-3.1-pro". */
export function familySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "Gemini 3.1 Pro (High)" -> { family: "Gemini 3.1 Pro", level: "high" }; a name without "(Level)" has no level. */
export function splitModelName(name: string): { family: string; level: EffortLevel | null } {
  const match = /^(.*\S)\s*\(\s*([A-Za-z][\w-]*)\s*\)$/.exec(name.trim());
  return match ? { family: match[1], level: match[2].toLowerCase() } : { family: name.trim(), level: null };
}

/**
 * Groups the agent's per-level models into families, in the order the agent lists each family first. Levels are
 * ordered low < medium < high, any other level after them in the agent's order. `current` is the session's model:
 * its level becomes its family's default effort; otherwise the default is "high", else the heaviest level.
 */
export function antigravityFamilies(options: readonly AgentModelOption[] | null | undefined, current?: string | null): AntigravityFamily[] {
  const families = new Map<string, AntigravityFamily>();
  const levelOf = new Map<string, EffortLevel>();
  for (const option of options ?? []) {
    if (typeof option?.value !== "string" || !option.value) continue;
    const { family: name, level } = splitModelName(option.name?.trim() || option.value);
    const id = familySlug(name) || option.value;
    let family = families.get(id);
    if (!family) {
      family = { id, name, efforts: [], variants: {}, options: [] };
      families.set(id, family);
    }
    const key = level ?? "";
    if (key in family.variants) continue;
    family.variants[key] = option.value;
    family.options.push(option);
    if (level) {
      family.efforts.push(level);
      levelOf.set(option.value, level);
    }
  }
  for (const family of families.values()) {
    // A family that mixes a bare name with levelled ones keeps only the levels as efforts.
    family.efforts = family.efforts
      .map((level, index) => ({ level, index }))
      .sort((a: { level: string; index: number }, b: { level: string; index: number }) => levelRank(a.level) - levelRank(b.level) || a.index - b.index)
      .map(({ level }) => level);
    if (!family.efforts.length) continue;
    const currentLevel = current && family.options.some((option) => option.value === current) ? levelOf.get(current) : undefined;
    family.defaultEffort = currentLevel ?? (family.efforts.includes("high") ? "high" : family.efforts.at(-1));
  }
  return [...families.values()];
}

/**
 * The agent model id for Milagre's `model` (a family id) at `effort`. A raw agent id (a chat saved before families)
 * is used as it is. A family without the effort uses its default. Undefined when nothing matches.
 */
export function resolveAntigravityModel(families: readonly AntigravityFamily[], model: string | undefined, effort?: EffortLevel | null): string | undefined {
  if (!model) return undefined;
  if (families.some((family) => Object.values(family.variants).includes(model))) return model;
  const family = families.find((item) => item.id === model);
  if (!family) return undefined;
  if (!family.efforts.length) return family.variants[""] ?? family.options[0]?.value;
  const level = effort && family.efforts.includes(effort) ? effort : (family.defaultEffort ?? family.efforts.at(-1)!);
  return family.variants[level];
}

function antigravityCatalog(): ModelOption[] {
  return antigravityFamilies(ANTIGRAVITY_AGENT_OPTIONS).map((family) => {
    const copy = ANTIGRAVITY_FAMILY_COPY[family.id];
    return {
      id: family.id,
      name: family.name,
      provider: "antigravity",
      description: copy?.description ?? "",
      ...(copy?.recommended ? { recommended: true } : {}),
    };
  });
}

/**
 * The maintained list: what codex-cli 0.160.0, Claude Code 2.1.288 and Antigravity 1.3.0 report, recommended model first.
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
  ...antigravityCatalog(),
];
