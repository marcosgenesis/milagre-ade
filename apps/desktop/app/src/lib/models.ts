import type { AgentModels, ModelCapabilities, ModelOption, ModelProvider } from "../model";

const PROVIDERS: ModelProvider[] = ["codex", "claude"];

/**
 * The models the picker offers: each agent's own list, its recommended model first, or the maintained
 * list for an agent that hasn't reported one (still loading, CLI missing or too old, lookup failed).
 */
export function mergeModels(reported: AgentModels | null, fallback: ModelOption[]): ModelOption[] {
  return PROVIDERS.flatMap((provider) => {
    const list = reported?.[provider];
    if (!list?.length) return fallback.filter((model) => model.provider === provider);
    const options: ModelOption[] = list.map(({ id, name, description, recommended }) => ({ id, name, provider, description, ...(recommended ? { recommended: true } : {}) }));
    return [...options.filter((model) => model.recommended), ...options.filter((model) => !model.recommended)];
  });
}

/** What each reported model accepts, by provider and model id (see capabilityFor). */
export function capabilitiesFrom(reported: AgentModels | null): ModelCapabilities | null {
  if (!reported) return null;
  const byId = (provider: ModelProvider) => Object.fromEntries((reported[provider] ?? []).map(({ id, efforts, defaultEffort, ultracode }) => [id, { efforts, ...(defaultEffort ? { defaultEffort } : {}), ultracode }]));
  return { codex: byId("codex"), claude: byId("claude") };
}

/** `wanted` when the list has it; otherwise the recommended model of `provider`, any model of it, or the first model. */
export function resolveModel(models: ModelOption[], wanted: string | undefined, provider: ModelProvider): ModelOption {
  return models.find((model) => model.id === wanted)
    ?? models.find((model) => model.provider === provider && model.recommended)
    ?? models.find((model) => model.provider === provider)
    ?? models[0];
}

/** The provider an id belongs to, for an id no list offers any more (Claude ids start with "claude"). */
export function providerForId(id: string | undefined): ModelProvider {
  return id?.startsWith("claude") ? "claude" : "codex";
}

/** The same lists (by value), so a refetch that changed nothing doesn't re-render the app. */
export function keepIfSame<T>(previous: T, next: T): T {
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}

/**
 * The model the composer shows once `models` changed (lists arrived or were fetched again).
 * - `applyDefault` is true once: when the agents' lists first arrive and the user hasn't picked a model. The
 *   Settings default then replaces the model the app started with, unless the open chat is locked to the other
 *   provider (a chat stays on the agent it started with).
 * - Every other time the current model stays, or gives way to its provider's recommended model when the lists
 *   no longer offer it.
 * Returns `current` itself when nothing changed, so the composer doesn't re-render.
 */
export function nextSelection(models: ModelOption[], current: ModelOption, { defaultId, applyDefault, lockedProvider }: { defaultId: string; applyDefault: boolean; lockedProvider?: ModelProvider }): ModelOption {
  const useDefault = applyDefault && (lockedProvider === undefined || providerForId(defaultId) === lockedProvider || models.find((model) => model.id === defaultId)?.provider === lockedProvider);
  const wanted = useDefault ? defaultId : current.id;
  const provider = lockedProvider ?? (useDefault ? models.find((model) => model.id === wanted)?.provider ?? providerForId(wanted) : current.provider);
  const next = resolveModel(models, wanted, provider);
  return next.id === current.id && next.name === current.name && next.provider === current.provider ? current : next;
}
