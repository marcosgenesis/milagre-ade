const test = require("node:test");
const assert = require("node:assert/strict");
const { browserToolDefinitions } = require("./chat-browsers.cjs");
const { runTool } = require("./linked-tools.cjs");

const OTHER = "0b5c2e5e-1111-4222-8333-955555555555";
function fixture() {
  const calls = [];
  const api = {
    async list(request) {
      calls.push(["list", request]);
      return { supported: true, targets: [], others: [{ id: OTHER, browser: "Chrome 141", pages: 1, title: "Mine" }] };
    },
    async attach(request) {
      calls.push(["attach", request]);
      return {
        supported: true,
        targets: [{ id: `${OTHER}:${"C".repeat(32)}`, title: "Mine", url: "https://example.org/", browser: "Chrome 141", source: "attached" }],
        others: [],
      };
    },
    async detach(request) {
      calls.push(["detach", request]);
      return { supported: true, targets: [], others: [] };
    },
  };
  return { api, calls, tools: browserToolDefinitions("chat-a", api) };
}

test("agent tools bind to their own Chat even if another Chat is supplied", async () => {
  const f = fixture();
  const attach = f.tools.find((x) => x.name === "browser_attach");
  const result = await runTool(attach, { browserId: OTHER, chatId: "chat-b" });
  assert.equal(result.isError, false);
  assert.match(result.text, /attached to the current Chat/);
  assert.equal(
    (
      await runTool(
        f.tools.find((x) => x.name === "browser_detach"),
        { browserId: OTHER, chatId: "chat-b" },
      )
    ).isError,
    false,
  );
  assert.equal(
    (
      await runTool(
        f.tools.find((x) => x.name === "browser_list"),
        { chatId: "chat-b" },
      )
    ).isError,
    false,
  );
  assert.deepEqual(
    f.calls.map(([method, request]) => [method, request.chatId]),
    [
      ["attach", "chat-a"],
      ["detach", "chat-a"],
      ["list", "chat-a"],
    ],
  );
});

test("only browser_list is read-only and malformed ids never reach the service", async () => {
  const f = fixture();
  assert.deepEqual(
    f.tools.map((tool) => [tool.name, tool.readOnly]),
    [
      ["browser_list", true],
      ["browser_attach", false],
      ["browser_detach", false],
    ],
  );
  const result = await runTool(
    f.tools.find((x) => x.name === "browser_attach"),
    { browserId: "x" },
  );
  assert.equal(result.isError, true);
  assert.equal(f.calls.length, 0);
});
