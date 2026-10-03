import { MODEL_CATALOG, capabilityFor, effortFor } from "@milagre/shared/model-options";
import { type AgentModels, type ModelCapability, type ModelOption, type ModelProvider, type PermissionMode } from '@milagre/shared/model';

export type MobileModel = ModelOption & ModelCapability;
export type TurnPreferences = { provider: ModelProvider; model: string; effort: string; fastMode: boolean; permissionMode: PermissionMode };
export const defaultPreferences: TurnPreferences = { provider: 'codex', model: '', effort: 'high', fastMode: false, permissionMode: 'ask' };

export function modelsFor(provider: ModelProvider, reported?: AgentModels | null): MobileModel[] {
  const offered = reported?.[provider];
  return offered?.length ? offered.map(model => ({ ...model, provider })).sort((a, b) => Number(b.recommended) - Number(a.recommended))
    : MODEL_CATALOG.filter(model => model.provider === provider).map(model => ({ ...model, ...capabilityFor(model, null) }));
}
export function selectedModel(provider: ModelProvider, wanted: string, reported?: AgentModels | null): MobileModel {
  const models = modelsFor(provider, reported);
  if (!wanted) return models.find(model => model.recommended) || models[0];
  const known = models.find(model => model.id === wanted);
  if (known) return known;
  const saved = { provider, id: wanted, name: wanted, description: 'Previously used in this Chat' };
  return { ...saved, ...capabilityFor(saved, null) };
}
export function sendOptions(model: MobileModel, preferences: Pick<TurnPreferences, 'effort' | 'fastMode' | 'permissionMode'>) {
  const effort = effortFor(model, preferences.effort);
  return { provider: model.provider, model: model.id, ...(effort ? { effort } : {}), fastMode: model.fastMode && preferences.fastMode, permissionMode: preferences.permissionMode };
}
