const test = require("node:test");
const assert = require("node:assert/strict");
const { createMcp } = require("./index.cjs");

const snapshot = {
  providers: [
    {
      provider: "claude",
      accounts: [
        { id: "default", label: "Connected CLI account", email: "me@example.test", state: "ready" },
        { id: "work", label: "Work", state: "signed-out" },
      ],
    },
    { provider: "codex", accounts: [{ id: "default", label: "Connected CLI account", state: "ready" }] },
    { provider: "antigravity", accounts: [{ id: "default", label: "Default account", state: "ready" }] },
  ],
};
const accounts = { list: async () => snapshot };
const routing = { forAccount: async (provider, accountId) => ({ command: `/bin/${provider}`, env: { ACCOUNT: accountId }, accountId }) };
const report = { name: "pencil", transport: "command", scope: "user", state: "connected", tools: 5, error: null };

test("accounts lists Claude and Codex accounts, not Antigravity", async () => {
  const mcp = createMcp({ accounts, routing, cwd: "/home" });
  assert.deepEqual(await mcp.accounts(), [
    { provider: "claude", accountId: "default", label: "me@example.test" },
    { provider: "claude", accountId: "work", label: "Work" },
    { provider: "codex", accountId: "default", label: "Connected CLI account" },
  ]);
});

test("check runs the provider's checker with the account's command and environment", async () => {
  let seen = null;
  const mcp = createMcp({
    accounts,
    routing,
    cwd: "/home",
    checkers: {
      claude: async (options) => {
        seen = options;
        return [report];
      },
    },
  });
  assert.deepEqual(await mcp.check("claude", "default"), {
    provider: "claude",
    accountId: "default",
    label: "me@example.test",
    problem: null,
    servers: [report],
  });
  assert.equal(seen.command, "/bin/claude");
  assert.deepEqual(seen.env, { ACCOUNT: "default" });
  assert.equal(seen.cwd, "/home");
  assert.equal(seen.signal.aborted, false);
});

test("a signed-out account is not checked", async () => {
  let called = false;
  const mcp = createMcp({ accounts, routing, cwd: "/", checkers: { claude: async () => ((called = true), []) } });
  const result = await mcp.check("claude", "work");
  assert.equal(result.problem, "Not signed in. Sign in from Accounts.");
  assert.deepEqual(result.servers, []);
  assert.equal(called, false);
});

test("a missing CLI reports the CLI's problem", async () => {
  const mcp = createMcp({ accounts, routing: { forAccount: async () => ({ command: null, problem: "Install Codex first." }) }, cwd: "/" });
  assert.equal((await mcp.check("codex", "default")).problem, "Install Codex first.");
});

test("a checker that never answers is cut off at the cap and told to stop", async () => {
  let signal = null;
  const mcp = createMcp({
    accounts,
    routing,
    cwd: "/",
    timeoutMs: 20,
    checkers: {
      codex: (options) => {
        signal = options.signal;
        return new Promise(() => {});
      },
    },
  });
  const result = await mcp.check("codex", "default");
  assert.equal(result.problem, "Timed out after 30 s. Check the servers in a terminal.");
  assert.equal(signal.aborted, true);
});

test("a checker that throws reports its message", async () => {
  const mcp = createMcp({
    accounts,
    routing,
    cwd: "/",
    checkers: {
      codex: async () => {
        throw new Error("app-server exited");
      },
    },
  });
  assert.equal((await mcp.check("codex", "default")).problem, "app-server exited");
});

test("an unknown account or provider is a problem, not a throw", async () => {
  const mcp = createMcp({ accounts, routing, cwd: "/" });
  assert.equal((await mcp.check("codex", "nope")).problem, "Account not found. Refresh and try again.");
  assert.equal((await mcp.check("antigravity", "default")).problem, "Account not found. Refresh and try again.");
});

test("the checker gets a deadline 5 s inside the cap", async () => {
  let seen = null;
  const mcp = createMcp({
    accounts,
    routing,
    cwd: "/",
    checkers: {
      claude: async (options) => {
        seen = options;
        return [];
      },
    },
  });
  await mcp.check("claude", "default");
  assert.equal(seen.timeoutMs, 25_000);
});

test("a checker that answers just under the cap keeps its server list", async () => {
  const mcp = createMcp({
    accounts,
    routing,
    cwd: "/",
    timeoutMs: 100,
    checkers: { claude: () => new Promise((resolve) => setTimeout(() => resolve([report]), 50)) },
  });
  const result = await mcp.check("claude", "default");
  assert.equal(result.problem, null);
  assert.deepEqual(result.servers, [report]);
});
