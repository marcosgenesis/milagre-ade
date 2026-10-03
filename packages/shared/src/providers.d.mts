import type { ModelProvider } from "./model.ts";
export const PROVIDERS: readonly ModelProvider[];
export function providerName(provider: ModelProvider): string;
export function cliName(provider: ModelProvider): string;
