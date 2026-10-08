import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANTIGRAVITY_AGENT_OPTIONS,
  MODEL_CATALOG,
  antigravityFamilies,
  capabilityFor,
  contextWindowFor,
  familySlug,
  resolveAntigravityModel,
  splitModelName,
} from "./model-options.ts";

test("Antigravity's per-level models group into one family per name, levels as efforts", () => {
  const families = antigravityFamilies(ANTIGRAVITY_AGENT_OPTIONS);
  assert.deepEqual(
    families.map(({ id, name, efforts, defaultEffort }) => ({ id, name, efforts, defaultEffort })),
    [
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", efforts: ["low", "medium", "high"], defaultEffort: "high" },
      { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", efforts: ["low", "high"], defaultEffort: "high" },
      { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", efforts: ["low", "medium", "high"], defaultEffort: "high" },
      { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", efforts: ["low", "medium", "high"], defaultEffort: "high" },
    ],
  );
  // Irregular agent ids map through the variant table: Pro at High is "gemini-pro-agent".
  assert.deepEqual(families[1].variants, { high: "gemini-pro-agent", low: "gemini-3.1-pro-low" });
});

test("a name without a level is its own family with no efforts; unknown levels sort after low, medium and high", () => {
  const families = antigravityFamilies([
    { value: "preview-id", name: "Gemini 4 Preview", description: "A preview" },
    { value: "x-turbo", name: "Gemini X (Turbo)" },
    { value: "x-high", name: "Gemini X (High)" },
    { value: "x-low", name: "Gemini X (Low)" },
    { value: "x-low-again", name: "Gemini X (Low)" },
    { value: "bare" },
  ]);
  assert.deepEqual(
    families.map(({ id, efforts, variants }) => ({ id, efforts, variants })),
    [
      { id: "gemini-4-preview", efforts: [], variants: { "": "preview-id" } },
      { id: "gemini-x", efforts: ["low", "high", "turbo"], variants: { turbo: "x-turbo", high: "x-high", low: "x-low" } },
      { id: "bare", efforts: [], variants: { "": "bare" } },
    ],
  );
  assert.equal(resolveAntigravityModel(families, "gemini-4-preview", "high"), "preview-id");
  assert.equal(resolveAntigravityModel(families, "gemini-x", "turbo"), "x-turbo");
  assert.deepEqual(splitModelName("Gemini 3.1 Pro (High)"), { family: "Gemini 3.1 Pro", level: "high" });
  assert.deepEqual(splitModelName("Gemini 4 Preview"), { family: "Gemini 4 Preview", level: null });
  assert.equal(familySlug("Gemini 3.1 Pro"), "gemini-3.1-pro");
});

test("the session's current model sets its family's default effort", () => {
  const families = antigravityFamilies(ANTIGRAVITY_AGENT_OPTIONS, "gemini-3.8-flash-medium");
  assert.equal(families[0].defaultEffort, "medium");
  assert.equal(families[1].defaultEffort, "high");
  assert.equal(resolveAntigravityModel(families, "gemini-3.8-flash"), "gemini-3.8-flash-medium");
});

test("resolveAntigravityModel maps a family and effort to the agent id, keeps raw agent ids, and knows nothing else", () => {
  const families = antigravityFamilies(ANTIGRAVITY_AGENT_OPTIONS);
  assert.equal(resolveAntigravityModel(families, "gemini-3.1-pro", "high"), "gemini-pro-agent");
  assert.equal(resolveAntigravityModel(families, "gemini-3.1-pro", "low"), "gemini-3.1-pro-low");
  // Pro has no Medium: its default effort.
  assert.equal(resolveAntigravityModel(families, "gemini-3.1-pro", "medium"), "gemini-pro-agent");
  assert.equal(resolveAntigravityModel(families, "gemini-3.8-flash", undefined), "gemini-3.8-flash-high");
  assert.equal(resolveAntigravityModel(families, "gemini-3.8-flash-low", "high"), "gemini-3.8-flash-low");
  assert.equal(resolveAntigravityModel(families, "nope", "high"), undefined);
  assert.equal(resolveAntigravityModel(families, undefined, "high"), undefined);
});

test("the catalog lists Antigravity's four families, and capabilityFor offers each family's efforts", () => {
  const antigravity = MODEL_CATALOG.filter((model) => model.provider === "antigravity");
  assert.deepEqual(
    antigravity.map((model) => [model.id, model.name, model.description, model.recommended === true]),
    [
      ["gemini-3.8-flash", "Gemini 3.8 Flash", "Fast", true],
      ["gemini-3.1-pro", "Gemini 3.1 Pro", "Most capable for complex work", true],
      ["gemini-3.7-flash", "Gemini 3.7 Flash", "Previous generation fast model", false],
      ["gemini-3.6-flash", "Gemini 3.6 Flash", "Older fast model", false],
    ],
  );
  assert.deepEqual(capabilityFor(antigravity[1], null), { efforts: ["low", "high"], defaultEffort: "high", ultracode: false, fastMode: false });
  assert.deepEqual(capabilityFor(antigravity[0], null), { efforts: ["low", "medium", "high"], defaultEffort: "high", ultracode: false, fastMode: false });
  // A raw agent id saved by an older chat has no effort control.
  assert.deepEqual(capabilityFor({ id: "gemini-pro-agent", name: "x", provider: "antigravity", description: "" }, null), {
    efforts: [],
    ultracode: false,
    fastMode: false,
  });
});

test("each model's context window: 1M Claude from Opus 4.7 on, 200K before it, 272K GPT, about 1M Gemini", () => {
  const window = (provider: "claude" | "codex" | "antigravity", id: string) => contextWindowFor({ provider, id });
  for (const id of ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5", "claude-haiku-5-5", "claude-opus-4-7", "claude-opus-4-8"])
    assert.equal(window("claude", id), 1_000_000, id);
  for (const id of ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-5", "claude-opus-4-1", "claude-opus-4", "claude-3-7-sonnet"])
    assert.equal(window("claude", id), 200_000, id);
  assert.equal(window("codex", "gpt-6.1-sol"), 272_000);
  assert.equal(window("antigravity", "gemini-3.1-pro"), 1_048_576);
  assert.equal(window("antigravity", "claude-sonnet-4-6"), undefined);
});
