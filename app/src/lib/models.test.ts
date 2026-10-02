import assert from "node:assert/strict";
import test from "node:test";
import type { AgentModels, ModelOption, ReportedModel } from "../model";
import { capabilitiesFrom, keepIfSame, mergeModels, nextSelection, providerForId, resolveModel } from "./models.ts";
import { supportsFastMode } from "../model.ts";

test("fast mode is offered only on supported Claude Opus models", () => {
  for (const id of ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]) assert.equal(supportsFastMode({ id, provider: "claude", name: id }), true);
  for (const id of ["claude-opus-4-7", "claude-sonnet-5-5", "gpt-6-astra"]) assert.equal(supportsFastMode({ id, provider: id.startsWith("gpt") ? "codex" : "claude", name: id }), false);
});

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

const catalog: ModelOption[] = [
  { id: "gpt-6-astra", name: "GPT-6-Astra", provider: "codex", description: "", recommended: true },
  { id: "gpt-6-sol", name: "GPT-6-Sol", provider: "codex", description: "" },
  { id: "claude-opus-5-5", name: "Opus 5.5", provider: "claude", description: "", recommended: true },
  { id: "claude-haiku-4-5", name: "Haiku 4.5", provider: "claude", description: "" },
];
const pick = (id: string) => catalog.find((model) => model.id === id)!;

test("a locked Claude chat stays on its model when the default is a Codex model", () => {
  const current = pick("claude-haiku-4-5");
  assert.equal(nextSelection(catalog, current, { defaultId: "gpt-6-astra", applyDefault: true, lockedProvider: "claude" }), current);
  assert.equal(nextSelection(catalog, current, { defaultId: "gpt-6-astra", applyDefault: false, lockedProvider: "claude" }), current);
});

test("the Settings default replaces the starting model once, when nothing locks the chat", () => {
  assert.equal(nextSelection(catalog, pick("gpt-6-astra"), { defaultId: "claude-haiku-4-5", applyDefault: true }).id, "claude-haiku-4-5");
  assert.equal(nextSelection(catalog, pick("gpt-6-astra"), { defaultId: "claude-haiku-4-5", applyDefault: false }).id, "gpt-6-astra");
  assert.equal(nextSelection(catalog, pick("gpt-6-astra"), { defaultId: "claude-haiku-4-5", applyDefault: true, lockedProvider: "codex" }).id, "gpt-6-astra");
});

test("a refetch with identical lists changes nothing", () => {
  const current = pick("claude-haiku-4-5");
  const again = catalog.map((model) => ({ ...model }));
  assert.equal(nextSelection(again, current, { defaultId: "gpt-6-astra", applyDefault: false }), current);
  const lists = { codex: [{ id: "a" }], claude: null };
  assert.equal(keepIfSame(lists, JSON.parse(JSON.stringify(lists))), lists);
  assert.notEqual(keepIfSame(lists, { codex: [{ id: "b" }], claude: null }), lists);
});

test("a stale id gives way to its provider's recommended model", () => {
  assert.equal(nextSelection(catalog, { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", provider: "codex", description: "" }, { defaultId: "gpt-6.1-sol", applyDefault: false }).id, "gpt-6-astra");
  assert.equal(nextSelection(catalog, { id: "claude-sonnet-4-5", name: "Sonnet 4.5", provider: "claude", description: "" }, { defaultId: "x", applyDefault: false }).id, "claude-opus-5-5");
  // a stale default applies to its own provider
  assert.equal(nextSelection(catalog, pick("gpt-6-astra"), { defaultId: "claude-sonnet-4-5", applyDefault: true }).id, "claude-opus-5-5");
  assert.equal(nextSelection(catalog, pick("claude-opus-5-5"), { defaultId: "gpt-6.1-sol", applyDefault: true }).id, "gpt-6-astra");
  assert.equal(providerForId("claude-sonnet-4-5"), "claude");
  assert.equal(providerForId("gpt-6.1-sol"), "codex");
});
