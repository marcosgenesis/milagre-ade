const test = require("node:test");
const assert = require("node:assert/strict");
const { advisorToolDefinitions } = require("./advisor-tools.cjs");
const { runTool } = require("./linked-tools.cjs");
test("advisor tools bind ownership and reject caller overrides", async () => {
  const calls = [];
  const manager = {
    providers: async (id) => ({ chat: id }),
    create: async (id, input) => {
      calls.push({ id, input });
      return { id: "advisor:1" };
    },
  };
  const defs = advisorToolDefinitions("owner", manager);
  assert.deepEqual(
    defs.map((t) => t.name),
    ["advisor_providers", "create_advisor", "advisor_followup", "advisor_read", "advisor_stop"],
  );
  const create = defs.find((t) => t.name === "create_advisor");
  for (const bad of [
    { title: "x", prompt: "y", chatId: "other" },
    { title: "x", prompt: "y", cwd: "/tmp" },
    { title: "", prompt: "y" },
    { title: "x", prompt: "x".repeat(40001) },
  ])
    assert.equal((await runTool(create, bad)).isError, true);
  assert.equal(calls.length, 0);
  assert.equal((await runTool(create, { title: "x", prompt: "y" })).isError, false);
  assert.equal(calls[0].id, "owner");
});

test("all advisor tools return provider-readable JSON with IDs, capabilities and saved output", async () => {
  const manager = {
    providers: async () => ({ codex: { available: true, models: [{ id: "xm", efforts: ["high"], recommended: true }] } }),
    create: async () => ({ id: "advisor:1", status: "initializing", provider: "codex" }),
    followup: async () => ({ advisorId: "advisor:1", accepted: true }),
    read: async () => ({ id: "advisor:1", status: "completed", output: "Saved recommendation", transcript: [{ text: "Saved recommendation" }] }),
    stop: async () => ({ id: "advisor:1", status: "cancelled", retryable: true }),
  };
  const defs = advisorToolDefinitions("owner", manager);
  const cases = [
    ["advisor_providers", {}, { codex: { available: true, models: [{ id: "xm", efforts: ["high"], recommended: true }] } }],
    ["create_advisor", { title: "Review", prompt: "Assess" }, { id: "advisor:1", status: "initializing", provider: "codex" }],
    ["advisor_followup", { advisorId: "advisor:1", prompt: "More" }, { advisorId: "advisor:1", accepted: true }],
    [
      "advisor_read",
      { advisorId: "advisor:1" },
      { id: "advisor:1", status: "completed", output: "Saved recommendation", transcript: [{ text: "Saved recommendation" }] },
    ],
    ["advisor_stop", { advisorId: "advisor:1" }, { id: "advisor:1", status: "cancelled", retryable: true }],
  ];
  for (const [name, args, expected] of cases) {
    const response = await runTool(
      defs.find((tool) => tool.name === name),
      args,
    );
    assert.equal(response.isError, false, name);
    assert.deepEqual(JSON.parse(response.text), expected, name);
  }
});
