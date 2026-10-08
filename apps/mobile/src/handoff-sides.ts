import { providerName } from "@milagre/shared/providers";
import type { HandoffContext } from "@milagre/shared/model";

/** The two sides of a handoff divider: each side's model name, else its provider's. Same rule as desktop's handoffLabel. */
export function handoffSides(context: HandoffContext, models: { id: string; name: string }[]) {
  const side = ({ provider, model }: HandoffContext["from"]) => models.find((item) => item.id === model)?.name ?? providerName(provider);
  return { from: side(context.from), to: side(context.to), restored: context.from.provider === context.to.provider };
}
