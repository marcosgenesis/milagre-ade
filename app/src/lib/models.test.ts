import assert from "node:assert/strict";
import test from "node:test";
import type { AgentModels, ModelOption, ReportedModel } from "../model";
import { capabilitiesFrom, mergeModels, resolveModel } from "./models.ts";

const fallback: ModelOption[] = [
  { id: "gpt-6-astra", name: "GPT-6-Astra", provider: "codex", description: "Frontier", recommended: true },
  { id: "gpt-6-sol", name: "GPT-6-Sol", provider: "codex", description: "Workhorse" },
  { id: "claude-opus-5-5", name: "Opus 5.5", provider: "claude", description: "Everyday", recommended: true },
  { id: "claude-sonnet-4-6", name: "Sonnet 4.6", provider: "claude", description: "Routine" },
];
const reported = (id: string, extra: Partial<ReportedModel> = {}): ReportedModel => ({ id, name: id.toUpperCase(), description: `${id} model`, recommended: false, efforts: ["low", "high"], ultracode: false, ...extra });

test("each agent's own list replaces the maintained one, recommended model first", () => {
  const models: AgentModels = { codex: [reported("gpt-5.5"), reported("gpt-6.1-sol", { recommended: true })], claude: null };
  assert.deepEqual(mergeModels(models, fallback), [
    { id: "gpt-6.1-sol", name: "GPT-6.1-SOL", provider: "codex", description: "gpt-6.1-sol model", recommended: true },
    { id: "gpt-5.5", name: "GPT-5.5", provider: "codex", description: "gpt-5.5 model" },
    fallback[2],
    fallback[3],
  ]);
});

test("the maintained list stands in while nothing is reported, or for an empty list", () => {
  assert.deepEqual(mergeModels(null, fallback), fallback);
  assert.deepEqual(mergeModels({ codex: [], claude: null }, fallback), fallback);
});

test("capabilities come from the reported models", () => {
  const models: AgentModels = { codex: [reported("gpt-6-sol", { efforts: ["low", "ultra"], defaultEffort: "medium" })], claude: [reported("claude-opus-5-5", { efforts: ["low", "xhigh"], ultracode: true })] };
  assert.deepEqual(capabilitiesFrom(models), {
    codex: { "gpt-6-sol": { efforts: ["low", "ultra"], defaultEffort: "medium", ultracode: false } },
    claude: { "claude-opus-5-5": { efforts: ["low", "xhigh"], ultracode: true } },
  });
  assert.deepEqual(capabilitiesFrom({ codex: null, claude: null }), { codex: {}, claude: {} });
  assert.equal(capabilitiesFrom(null), null);
});

test("a model no longer offered gives way to its provider's recommended one", () => {
  assert.equal(resolveModel(fallback, "gpt-6-sol", "codex").id, "gpt-6-sol");
  assert.equal(resolveModel(fallback, "gpt-6.1-sol", "codex").id, "gpt-6-astra");
  assert.equal(resolveModel(fallback, "claude-sonnet-4-5", "claude").id, "claude-opus-5-5");
  assert.equal(resolveModel(fallback.filter((model) => !model.recommended), undefined, "claude").id, "claude-sonnet-4-6");
});
