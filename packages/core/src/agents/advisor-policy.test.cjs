const assert = require("node:assert/strict");
const test = require("node:test");
const { advisorPolicy, advisorCodexConfig, ANALYSIS_INSTRUCTIONS } = require("./advisor-policy.cjs");

test("Codex analysis never allows writes or escalation", () => {
  const policy = advisorPolicy("codex", []);
  assert.equal(policy.sandbox, "read-only");
  assert.equal(policy.approvalPolicy, "never");
  assert.deepEqual(policy.sandboxPolicy, { type: "readOnly", networkAccess: false });
});

test("Claude analysis removes built-in tools and inherited configuration", () => {
  const policy = advisorPolicy("claude", []);
  assert.deepEqual(policy.tools, []);
  assert.deepEqual(policy.settingSources, []);
  assert.equal(policy.strictMcpConfig, true);
  assert.equal(policy.permissionMode, "dontAsk");
  assert.equal(policy.canUseTool("Bash", { command: "touch file" }).behavior, "deny");
  assert.equal(policy.canUseTool("mcp__outside__delete", {}).behavior, "deny");
});

test("advisor tool policy rejects mutation tools and only allows the supplied host reads", () => {
  assert.throws(() => advisorPolicy("claude", [{ name: "delegate", readOnly: false }]), /read-only/);
  const policy = advisorPolicy("claude", [{ name: "advisor_read_file", readOnly: true }]);
  assert.equal(policy.canUseTool("mcp__milagre__advisor_read_file", {}).behavior, "allow");
  assert.equal(policy.canUseTool("mcp__milagre__create_advisor", {}).behavior, "deny");
  assert.match(ANALYSIS_INSTRUCTIONS, /analysis only/i);
});

test("Codex analysis disables inherited MCP and execution features before a thread starts", () => {
  const config = advisorCodexConfig(
    { mcp_servers: { personal: { command: "mutator" } }, features: { shell_tool: true, code_mode: true } },
    "http://127.0.0.1:1/mcp/token",
  );
  assert.equal(config.mcp_servers.personal.enabled, false);
  assert.equal(config.mcp_servers.milagre.url, "http://127.0.0.1:1/mcp/token");
  for (const name of ["shell_tool", "unified_exec", "multi_agent", "code_mode", "apps", "plugins", "hooks", "browser_use", "computer_use", "image_generation"])
    assert.equal(config.features[name], false, name);
  assert.equal(config.web_search, "disabled");
  assert.equal(config.agents.enabled, false);
});
