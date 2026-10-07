import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentModels } from "@milagre/shared/model";
import { modelsFor, selectedModel, sendOptions } from "./turn-options.ts";

const reported: AgentModels = {
  claude: null,
  codex: [
    {
      id: "reported-model",
      name: "Reported",
      description: "",
      recommended: true,
      efforts: ["low", "high"],
      defaultEffort: "low",
      ultracode: false,
      fastMode: false,
    },
  ],
};

test("reported models control effort and fast mode in the sent options", () => {
  const model = selectedModel("codex", "reported-model", reported);
  assert.deepEqual(sendOptions(model, { effort: "ultra", fastMode: true, permissionMode: "ask" }), {
    provider: "codex",
    model: "reported-model",
    effort: "low",
    fastMode: false,
    permissionMode: "ask",
  });
  assert.equal(modelsFor("codex", reported).length, 1);
});

test("a saved model stays selected if the current CLI no longer lists it", () => {
  assert.equal(selectedModel("codex", "previous-model", reported).id, "previous-model");
  assert.equal(selectedModel("codex", "", reported).id, "reported-model");
  assert.ok(modelsFor("claude", reported).every((model) => model.provider === "claude"));
});

test("models without effort omit it, and supported fast mode is explicit", () => {
  const model = { ...selectedModel("codex", "", reported), efforts: [], fastMode: true };
  assert.deepEqual(sendOptions(model, { effort: "high", fastMode: true, permissionMode: "auto" }), {
    provider: "codex",
    model: "reported-model",
    fastMode: true,
    permissionMode: "auto",
  });
});
