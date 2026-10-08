import type { AgentCliStatus, ModelProvider } from "./model.ts";
export const PROVIDERS: readonly ModelProvider[];
export function providerName(provider: ModelProvider): string;
export function cliName(provider: ModelProvider): string;
export function pickerProviders(status: AgentCliStatus | null | undefined, ...keep: ModelProvider[]): ModelProvider[];
export function accountType(plan?: string | null): "Business" | "Team" | "Personal" | null;
