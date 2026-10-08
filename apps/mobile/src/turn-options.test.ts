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

import { afterSend, afterSheet, turnTarget, defaultPreferences } from "./turn-options.ts";

const claudeChat = { ...defaultPreferences, provider: "codex" as const, model: "gpt-6", pickedOn: "claude" as const };

test("a pick holds while the chat is still on the provider it was picked against", () => {
  assert.deepEqual(turnTarget(claudeChat, "claude", defaultPreferences), { provider: "codex", model: "gpt-6", picked: true });
});

test("a pick is ignored after the chat's provider changes elsewhere", () => {
  assert.deepEqual(turnTarget(claudeChat, "codex", defaultPreferences), { provider: "codex", model: "gpt-6", picked: false });
  assert.deepEqual(turnTarget({ ...claudeChat, provider: "claude", model: "x" }, "codex", defaultPreferences), { provider: "codex", model: "", picked: false });
});

test("a pick is spent by a send, whether or not the handoff succeeds", () => {
  const target = turnTarget(claudeChat, "claude", defaultPreferences);
  const spent = afterSend(claudeChat, target, "claude", "gpt-6");
  assert.equal(spent.pickedOn, undefined);
  // The handoff failed and the chat is back on claude: the chat decides.
  assert.deepEqual(turnTarget(spent, "claude", defaultPreferences), { provider: "claude", model: "", picked: false });
  // The handoff succeeded and the chat is on codex.
  assert.deepEqual(turnTarget(spent, "codex", defaultPreferences), { provider: "codex", model: "", picked: false });
});

test("a send without a pick keeps the chat's model", () => {
  const saved = { ...defaultPreferences, provider: "claude" as const };
  const target = turnTarget(saved, "claude", defaultPreferences);
  assert.equal(afterSend(saved, target, "claude", "opus").model, "opus");
});

test("a chat with no provider yet follows the saved preferences", () => {
  assert.deepEqual(turnTarget({ ...defaultPreferences, provider: "claude", model: "m" }, undefined, defaultPreferences), {
    provider: "claude",
    model: "m",
    picked: false,
  });
  assert.equal(turnTarget(undefined, undefined, defaultPreferences).provider, defaultPreferences.provider);
});

test("the sheet records a pick only when the provider differs from the chat's", () => {
  assert.equal(afterSheet({ ...defaultPreferences, provider: "codex" }, "claude").pickedOn, "claude");
  assert.equal(afterSheet({ ...defaultPreferences, provider: "claude", pickedOn: "claude" }, "claude").pickedOn, undefined);
  assert.equal(afterSheet({ ...defaultPreferences, provider: "codex" }, undefined).pickedOn, undefined);
});
