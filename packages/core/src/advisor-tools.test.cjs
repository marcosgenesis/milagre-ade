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
