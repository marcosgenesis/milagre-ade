import assert from "node:assert/strict";
import test from "node:test";
import { groupMcpRows, mcpSummary, type McpAccountCheck } from "./mcp.ts";

const claude: McpAccountCheck = {
  provider: "claude",
  accountId: "default",
  label: "personal@example.test",
  problem: null,
  servers: [
    { name: "pencil", transport: "command", scope: "user", state: "connected", tools: 5, error: null },
    { name: "linear", transport: "url", scope: "plugin", state: "needs-sign-in", tools: 0, error: null },
    { name: "claude.ai Gmail", transport: "connector", scope: "claude.ai", state: "connected", tools: 30, error: null },
  ],
};
const codex: McpAccountCheck = {
  provider: "codex",
  accountId: "default",
  label: "Connected CLI account",
  problem: null,
  servers: [
    { name: "linear", transport: "url", scope: "user", state: "connected", tools: 76, error: null },
    { name: "epidemic-sound", transport: "url", scope: "user", state: "failed", tools: 0, error: "Environment variable EPIDEMIC_SOUND_API_KEY is not set" },
  ],
};

test("servers are grouped by name across providers, sorted by name", () => {
  const { user, other } = groupMcpRows([claude, codex]);
  assert.deepEqual(
    user.map((row) => row.name),
    ["epidemic-sound", "linear", "pencil"],
  );
  assert.deepEqual(
    other.map((row) => row.name),
    ["claude.ai Gmail"],
  );
  const linear = user.find((row) => row.name === "linear")!;
  assert.deepEqual(
    linear.chips.map((chip) => `${chip.provider}:${chip.scope}:${chip.state}`),
    ["claude:plugin:needs-sign-in", "codex:user:connected"],
  );
});

test("a row is editable when any chip is user scope", () => {
  const { user, other } = groupMcpRows([claude, codex]);
  assert.equal(user.find((row) => row.name === "linear")!.editable, true);
  assert.equal(other[0].editable, false);
});

test("an account with a problem adds no rows", () => {
  const { user, other } = groupMcpRows([{ ...codex, problem: "Not signed in", servers: [] }]);
  assert.deepEqual([user, other], [[], []]);
});

test("the summary counts connected chips", () => {
  const { user } = groupMcpRows([claude, codex]);
  assert.equal(mcpSummary(user.find((row) => row.name === "linear")!), "1 of 2 connected");
  assert.equal(mcpSummary(user.find((row) => row.name === "pencil")!), "Connected");
  assert.equal(mcpSummary(user.find((row) => row.name === "epidemic-sound")!), "Failed");
});
