# Settings › MCP, PR 1 (read only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings › MCP tab on desktop and phone that lists every MCP server each Claude and Codex account loads on a Mac, with live status (connected, failed, needs sign-in, disabled) and tool counts.

**Architecture:** A new `packages/core/src/mcp/` module checks one account at a time: Claude through an idle SDK session's `mcpServerStatus()`, Codex through an app-server's `config/read` plus `mcpServerStatus/list`. The runtime exposes `mcp:accounts` and `mcp:check`; the desktop and the phone call `mcp:check` for every account in parallel and group the results by server name with a shared helper in `@milagre/shared/mcp`.

**Tech Stack:** Node CommonJS (core, daemon), `@anthropic-ai/claude-agent-sdk` 0.3.288, Codex app-server JSON-RPC (`CodexRpc`), React + Tailwind (desktop renderer), Expo Router + React Native (phone), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-09-mcp-settings-design.md` (issue #376). PRs 2 (edit) and 3 (Everywhere and sign-in) get their own plans after this one merges.

## Global Constraints

- Desktop and phone ship together in this PR (AGENTS.md "Desktop and mobile stay in sync").
- JS only: no native dependency, config plugin or `app.json` change, so the phone gets it as an OTA update. Check the fingerprint before the PR (`apps/mobile/AGENTS.md`).
- Read only: nothing in this PR writes any provider config.
- Antigravity is not checked in this PR (it has no user MCP config; PR 3 adds its chips).
- 30 s cap per account check. A server still `pending` at the cap reads `failed` with error `Timed out after 30 s`.
- Before the PR: `npm run typecheck`, `npm run lint`, `npm test -- --unit`, `npm test -- --only test-mcp-settings`.
- PR screenshots go on the orphan `screenshots` branch, linked by SHA, never in the PR's commits.
- No Claude attribution in commits or the PR body.

## Review Focus

1. **A CLI that never answers** (hung Claude binary, Codex stuck on a server): that account's chips read "Timed out after 30 s" while every other account fills in. Test in Task 4.
2. **Signed-out account or missing CLI:** the account shows its problem text ("Not signed in", the CLI status problem) and no servers, never an exception. Test in Task 4.
3. **The same server under two providers with different scopes** (`linear` user-scope in Codex, plugin-scope in Claude): one row, editable because one chip is `user`. Test in Task 1.
4. **The demo computer's confined phone** calling `mcp:*`: refused with 403, and the phone shows "Not available on this computer" instead of a spinner forever. Tests in Tasks 5 and 7.
5. **A remote Mac that drops mid-check:** `mcp:check` rejects, and the desktop shows that account's error instead of a spinner. Test in Task 6.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/shared/src/mcp.ts` (new) | Types for checks, chips and rows; `groupMcpRows`, `mcpSummary`. Used by desktop and phone. |
| `packages/shared/src/mcp.test.ts` (new) | Grouping and summary tests. |
| `packages/core/src/mcp/claude.cjs` (new) | `checkClaude`: idle SDK session → `McpServerReport[]`. `claudeServer` maps one SDK status. |
| `packages/core/src/mcp/codex.cjs` (new) | `checkCodex`: app-server → `McpServerReport[]`. `codexServer` maps one status. |
| `packages/core/src/mcp/index.cjs` (new) | `createMcp`: the account list, one account's check with the cap, problems. |
| `packages/core/src/mcp/*.test.cjs` (new) | Unit tests next to each file. |
| `packages/core/src/runtime.cjs` | `mcp:accounts`, `mcp:check` commands. |
| `apps/daemon/src/mobile-bridge.cjs`, `apps/daemon/src/confine.cjs` | Allow both methods for phones; refuse them on the demo computer. |
| `apps/desktop/electron/preload.cjs`, `apps/desktop/app/src/electron.d.ts` | `mcp.accounts()`, `mcp.check()` on the bridge. |
| `apps/desktop/app/src/components/McpSettings.tsx` (new) | The desktop tab, for any bridge (this Mac or a paired one). |
| `apps/desktop/app/src/components/Settings.tsx` | The "MCP" section, and the block on a computer's page. |
| `scripts/test-mcp-settings.cjs` (new) | Electron check with screenshots. |
| `apps/mobile/src/mcp-section.tsx`, `apps/mobile/src/app/mcp.tsx` (new) | The phone screen. |
| `apps/mobile/src/app/settings.tsx` | The "MCP servers" row. |
| `GLOSSARY.md` | "MCP server". |

---

### Task 1: Shared types and grouping

**Files:**
- Create: `packages/shared/src/mcp.ts`
- Create: `packages/shared/src/mcp.test.ts`
- Modify: `packages/shared/package.json` (add `"src/mcp.ts"` to the list next to `"src/main-sync.ts"` around line 20, and `"./mcp": "./src/mcp.ts"` to `exports` next to `"./main-sync"` around line 154)

**Interfaces:**
- Produces (every later task uses these names):

```ts
export type McpChipState = "connected" | "failed" | "needs-sign-in" | "pending" | "disabled";
export type McpTransport = "command" | "url" | "connector";
export type McpScope = "user" | "project" | "local" | "plugin" | "claude.ai" | "built-in";
export type McpServerReport = { name: string; transport: McpTransport; scope: McpScope; state: McpChipState; tools: number; error: string | null };
export type McpAccount = { provider: "claude" | "codex"; accountId: string; label: string };
export type McpAccountCheck = McpAccount & { problem: string | null; servers: McpServerReport[] };
export type McpChip = McpAccount & { scope: McpScope; state: McpChipState; tools: number; error: string | null };
export type McpRow = { name: string; transport: McpTransport; editable: boolean; chips: McpChip[] };
export function groupMcpRows(checks: McpAccountCheck[]): { user: McpRow[]; other: McpRow[] };
export function mcpSummary(row: McpRow): string;
```

- [ ] **Step 1: Write the failing test**

`packages/shared/src/mcp.test.ts`:

```ts
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
  assert.deepEqual(user.map((row) => row.name), ["epidemic-sound", "linear", "pencil"]);
  assert.deepEqual(other.map((row) => row.name), ["claude.ai Gmail"]);
  const linear = user.find((row) => row.name === "linear")!;
  assert.deepEqual(linear.chips.map((chip) => `${chip.provider}:${chip.scope}:${chip.state}`), ["claude:plugin:needs-sign-in", "codex:user:connected"]);
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test packages/shared/src/mcp.test.ts`
Expected: FAIL, `Cannot find module './mcp.ts'`.

- [ ] **Step 3: Write the implementation**

`packages/shared/src/mcp.ts`:

```ts
// MCP servers as Settings › MCP shows them, shared by desktop and phone (docs/superpowers/specs/2026-10-09-mcp-settings-design.md).

export type McpChipState = "connected" | "failed" | "needs-sign-in" | "pending" | "disabled";
export type McpTransport = "command" | "url" | "connector";
export type McpScope = "user" | "project" | "local" | "plugin" | "claude.ai" | "built-in";
/** One server as one account loads it. */
export type McpServerReport = { name: string; transport: McpTransport; scope: McpScope; state: McpChipState; tools: number; error: string | null };
export type McpAccount = { provider: "claude" | "codex"; accountId: string; label: string };
/** The answer to mcp:check. `problem` is set when the account could not be checked; `servers` is then empty. */
export type McpAccountCheck = McpAccount & { problem: string | null; servers: McpServerReport[] };
export type McpChip = McpAccount & { scope: McpScope; state: McpChipState; tools: number; error: string | null };
/** One server name, with a chip per account that loads it. Only user-scope servers can be edited (PR 2). */
export type McpRow = { name: string; transport: McpTransport; editable: boolean; chips: McpChip[] };

/** Rows by server name: `user` holds every row with a user-scope chip, `other` the project, plugin and claude.ai ones. */
export function groupMcpRows(checks: McpAccountCheck[]): { user: McpRow[]; other: McpRow[] } {
  const rows = new Map<string, McpRow>();
  for (const check of checks) {
    if (check.problem) continue;
    for (const server of check.servers) {
      const row = rows.get(server.name) ?? { name: server.name, transport: server.transport, editable: false, chips: [] };
      row.chips.push({
        provider: check.provider,
        accountId: check.accountId,
        label: check.label,
        scope: server.scope,
        state: server.state,
        tools: server.tools,
        error: server.error,
      });
      row.editable ||= server.scope === "user";
      rows.set(server.name, row);
    }
  }
  const sorted = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { user: sorted.filter((row) => row.editable), other: sorted.filter((row) => !row.editable) };
}

const STATE_COPY: Record<McpChipState, string> = {
  connected: "Connected",
  failed: "Failed",
  "needs-sign-in": "Needs sign-in",
  pending: "Checking",
  disabled: "Off",
};

/** "Connected" for a single chip, "1 of 2 connected" for several. */
export function mcpSummary(row: McpRow): string {
  if (row.chips.length === 1) return STATE_COPY[row.chips[0].state];
  const connected = row.chips.filter((chip) => chip.state === "connected").length;
  return `${connected} of ${row.chips.length} connected`;
}

export const mcpStateCopy = (state: McpChipState) => STATE_COPY[state];
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `node --test packages/shared/src/mcp.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/mcp.ts packages/shared/src/mcp.test.ts packages/shared/package.json
git commit -m "feat(mcp): shared MCP row types and grouping"
```

---

### Task 2: Claude check

**Files:**
- Create: `packages/core/src/mcp/claude.cjs`
- Create: `packages/core/src/mcp/claude.test.cjs`

**Interfaces:**
- Consumes: the `McpServerReport` shape from Task 1 (plain objects; core does not import TS).
- Produces: `checkClaude({ command, env, cwd, loadSdk?, timeoutMs?, pollMs?, sleep?, now? }) => Promise<McpServerReport[]>` and `claudeServer(status, { timedOut }) => McpServerReport | null`.

Facts from the live probe on 2026-10-09: `mcpServerStatus()` answers in about 0.8 s with servers still `pending` and settles in about 2.3 s. `scope` is `user`, `local`, `project`, `dynamic` (plugins) or `claudeai` (claude.ai connectors). `config.type` is `stdio`, `http`, `sse`, `ws`, `sdk` or `claudeai-proxy`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/mcp/claude.test.cjs`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkClaude, claudeServer } = require("./claude.cjs");

test("an SDK status maps to a report", () => {
  assert.deepEqual(claudeServer({ name: "pencil", status: "connected", scope: "user", tools: [{ name: "a" }, { name: "b" }], config: { type: "stdio" } }), {
    name: "pencil",
    transport: "command",
    scope: "user",
    state: "connected",
    tools: 2,
    error: null,
  });
  assert.deepEqual(claudeServer({ name: "resend", status: "needs-auth", scope: "user", config: { type: "http" } }), {
    name: "resend",
    transport: "url",
    scope: "user",
    state: "needs-sign-in",
    tools: 0,
    error: null,
  });
  assert.equal(claudeServer({ name: "atl", status: "failed", scope: "dynamic", error: "No URL", config: { type: "http" } }).scope, "plugin");
  assert.equal(claudeServer({ name: "claude.ai Gmail", status: "connected", scope: "claudeai", config: { type: "claudeai-proxy" } }).transport, "connector");
  assert.equal(claudeServer({ name: "x", status: "connected", scope: "local" }).transport, "command");
});

test("in-process SDK servers are left out", () => {
  assert.equal(claudeServer({ name: "milagre", status: "connected", config: { type: "sdk" } }), null);
});

test("a server still pending at the cap is failed with a timeout error", () => {
  assert.deepEqual(claudeServer({ name: "slow", status: "pending", scope: "user", config: { type: "stdio" } }, { timedOut: true }), {
    name: "slow",
    transport: "command",
    scope: "user",
    state: "failed",
    tools: 0,
    error: "Timed out after 30 s",
  });
});

function fakeSdk(answers) {
  const calls = { options: null, closed: false, polls: 0 };
  return {
    calls,
    loadSdk: async () => ({
      query: ({ options }) => {
        calls.options = options;
        return {
          mcpServerStatus: async () => answers[Math.min(calls.polls++, answers.length - 1)],
          close: () => {
            calls.closed = true;
          },
        };
      },
    }),
  };
}

test("checkClaude polls until nothing is pending, then closes the session", async () => {
  const sdk = fakeSdk([
    [{ name: "pencil", status: "pending", scope: "user", config: { type: "stdio" } }],
    [{ name: "pencil", status: "connected", scope: "user", tools: [{ name: "a" }], config: { type: "stdio" } }],
  ]);
  const servers = await checkClaude({ command: "/bin/claude", env: { CLAUDE_CONFIG_DIR: "/x" }, cwd: "/home", loadSdk: sdk.loadSdk, sleep: async () => {} });
  assert.deepEqual(servers.map((s) => `${s.name}:${s.state}:${s.tools}`), ["pencil:connected:1"]);
  assert.equal(sdk.calls.options.pathToClaudeCodeExecutable, "/bin/claude");
  assert.equal(sdk.calls.options.env.CLAUDE_CONFIG_DIR, "/x");
  assert.equal(sdk.calls.options.cwd, "/home");
  assert.equal(sdk.calls.closed, true);
});

test("checkClaude stops polling at the cap", async () => {
  const sdk = fakeSdk([[{ name: "slow", status: "pending", scope: "user", config: { type: "stdio" } }]]);
  let clock = 0;
  const servers = await checkClaude({ command: "c", cwd: "/", loadSdk: sdk.loadSdk, timeoutMs: 1000, now: () => clock, sleep: async (ms) => void (clock += ms) });
  assert.equal(servers[0].error, "Timed out after 30 s");
  assert.equal(sdk.calls.closed, true);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test packages/core/src/mcp/claude.test.cjs`
Expected: FAIL, `Cannot find module './claude.cjs'`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/mcp/claude.cjs`:

```js
// One Claude account's MCP servers, from an idle SDK session's mcpServerStatus() (the listClaudeModels pattern in
// agents/models.cjs). The session sends no prompt, so it costs no tokens; it only starts the servers.

const SCOPES = { user: "user", local: "local", project: "project", dynamic: "plugin", claudeai: "claude.ai" };
const STATES = { connected: "connected", failed: "failed", "needs-auth": "needs-sign-in", disabled: "disabled", pending: "pending" };
const TIMEOUT_ERROR = "Timed out after 30 s";

function transportOf(type) {
  if (type === "http" || type === "sse" || type === "ws") return "url";
  if (type === "claudeai-proxy") return "connector";
  return "command";
}

/** One SDK McpServerStatus as a report; null for an in-process SDK server, which the user never configured. */
function claudeServer(status, { timedOut = false } = {}) {
  if (status.config?.type === "sdk") return null;
  const pending = status.status === "pending";
  return {
    name: status.name,
    transport: transportOf(status.config?.type),
    scope: SCOPES[status.scope] ?? "built-in",
    state: pending && timedOut ? "failed" : (STATES[status.status] ?? "failed"),
    tools: Array.isArray(status.tools) ? status.tools.length : 0,
    error: pending && timedOut ? TIMEOUT_ERROR : (status.error ?? null),
  };
}

async function checkClaude({
  command,
  env,
  cwd,
  loadSdk = () => import("@anthropic-ai/claude-agent-sdk"),
  timeoutMs = 30_000,
  pollMs = 250,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const { query } = await loadSdk();
  const idle = {
    // oxlint-disable-next-line require-yield -- never yields: the session stays idle and sends no prompt
    async *[Symbol.asyncIterator]() {
      await new Promise(() => {});
    },
  };
  const session = query({ prompt: idle, options: { pathToClaudeCodeExecutable: command, cwd, ...(env ? { env } : {}) } });
  try {
    const deadline = now() + timeoutMs;
    let list = await session.mcpServerStatus();
    while (list.some((status) => status.status === "pending") && now() < deadline) {
      await sleep(pollMs);
      list = await session.mcpServerStatus();
    }
    const timedOut = now() >= deadline;
    return list.map((status) => claudeServer(status, { timedOut })).filter(Boolean);
  } finally {
    session.close?.();
  }
}

module.exports = { checkClaude, claudeServer };
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `node --test packages/core/src/mcp/claude.test.cjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp/claude.cjs packages/core/src/mcp/claude.test.cjs
git commit -m "feat(mcp): check a Claude account's MCP servers through the SDK"
```

---

### Task 3: Codex check

**Files:**
- Create: `packages/core/src/mcp/codex.cjs`
- Create: `packages/core/src/mcp/codex.test.cjs`

**Interfaces:**
- Consumes: `CodexRpc` from `packages/core/src/agents/codex-rpc.cjs` (`start()`, `request(method, params)`, `notify(method)`, `close()`).
- Produces: `checkCodex({ command, env, cwd, clientVersion?, createRpc? }) => Promise<McpServerReport[]>` and `codexServer(status, configured) => McpServerReport`.

Facts from the live probe on 2026-10-09 (Codex app-server protocol, generated with `codex app-server generate-ts`):
- `config/read` → `{ config: { mcp_servers: { [name]: { command? | url?, enabled? } } } }`.
- `mcpServerStatus/list` with `{ detail: "toolsAndAuthOnly" }` and no `threadId` connects each server and returns `{ data: McpServerStatus[], nextCursor }`. Each status has `name`, `tools` (an object keyed by tool name), `toolsError` (string or null), `authStatus` (`unknown`, `unsupported`, `notLoggedIn`, `bearerToken`, `oAuth`), `pluginId`, `httpOrigin`. `runtimeStatus` is null without a thread, so it is not used.
- Built-in servers (`codex_apps`, `computer-use`) come back too; they are not in `config.mcp_servers` and have no `pluginId`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/mcp/codex.test.cjs`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkCodex, codexServer } = require("./codex.cjs");

test("a Codex status maps to a report", () => {
  assert.deepEqual(codexServer({ name: "linear", tools: { a: {}, b: {} }, toolsError: null, authStatus: "oAuth", pluginId: null, httpOrigin: "https://mcp.linear.app" }, { url: "https://mcp.linear.app/mcp" }), {
    name: "linear",
    transport: "url",
    scope: "user",
    state: "connected",
    tools: 2,
    error: null,
  });
  assert.deepEqual(
    codexServer({ name: "epidemic-sound", tools: {}, toolsError: "MCP startup failed: no key", authStatus: "bearerToken", pluginId: null, httpOrigin: null }, { url: "https://x" }),
    { name: "epidemic-sound", transport: "url", scope: "user", state: "failed", tools: 0, error: "MCP startup failed: no key" },
  );
  assert.equal(codexServer({ name: "m", tools: {}, toolsError: null, authStatus: "notLoggedIn", pluginId: null }, { url: "https://m" }).state, "needs-sign-in");
  assert.equal(codexServer({ name: "p", tools: {}, toolsError: null, authStatus: "unsupported", pluginId: null }, { command: "p", enabled: false }).state, "disabled");
  assert.equal(codexServer({ name: "pl", tools: {}, toolsError: null, authStatus: "unsupported", pluginId: "x@y" }, undefined).scope, "plugin");
  assert.equal(codexServer({ name: "codex_apps", tools: {}, toolsError: null, authStatus: "bearerToken", pluginId: null }, undefined).scope, "built-in");
  assert.equal(codexServer({ name: "argent", tools: { a: {} }, toolsError: null, authStatus: "unsupported", pluginId: null, httpOrigin: null }, { command: "argent" }).transport, "command");
});

function fakeRpc(pages) {
  const calls = [];
  let page = 0;
  const rpc = {
    calls,
    options: null,
    started: false,
    closed: false,
    start() {
      rpc.started = true;
    },
    notify(method) {
      calls.push(method);
    },
    async request(method, params) {
      calls.push(method);
      if (method === "initialize") return {};
      if (method === "config/read") return { config: { mcp_servers: { linear: { url: "https://mcp.linear.app/mcp" }, argent: { command: "argent" } } } };
      if (method === "mcpServerStatus/list") {
        assert.equal(params.detail, "toolsAndAuthOnly");
        return pages[page++];
      }
      throw new Error("unexpected " + method);
    },
    close() {
      rpc.closed = true;
    },
  };
  return rpc;
}

test("checkCodex reads every page and closes the app-server", async () => {
  const rpc = fakeRpc([
    { data: [{ name: "linear", tools: { a: {} }, toolsError: null, authStatus: "oAuth", pluginId: null }], nextCursor: "2" },
    { data: [{ name: "argent", tools: { a: {}, b: {} }, toolsError: null, authStatus: "unsupported", pluginId: null }], nextCursor: null },
  ]);
  const servers = await checkCodex({
    command: "codex",
    env: { CODEX_HOME: "/x" },
    cwd: "/home",
    createRpc: (options) => {
      rpc.options = options;
      return rpc;
    },
  });
  assert.deepEqual(servers.map((s) => `${s.name}:${s.transport}:${s.tools}`), ["linear:url:1", "argent:command:2"]);
  assert.deepEqual(rpc.calls, ["initialize", "initialized", "config/read", "mcpServerStatus/list", "mcpServerStatus/list"]);
  assert.equal(rpc.options.env.CODEX_HOME, "/x");
  assert.equal(rpc.closed, true);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test packages/core/src/mcp/codex.test.cjs`
Expected: FAIL, `Cannot find module './codex.cjs'`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/mcp/codex.cjs`:

```js
const { CodexRpc } = require("../agents/codex-rpc.cjs");

// One Codex account's MCP servers: config/read says how each is configured, mcpServerStatus/list connects them
// without a thread and says whether that worked (the listCodexModels pattern in agents/models.cjs).

function codexServer(status, configured) {
  const tools = Object.keys(status.tools ?? {}).length;
  const signIn = status.authStatus === "notLoggedIn";
  const state = configured?.enabled === false ? "disabled" : status.toolsError ? (signIn ? "needs-sign-in" : "failed") : signIn ? "needs-sign-in" : "connected";
  return {
    name: status.name,
    transport: configured?.url || status.httpOrigin ? "url" : "command",
    scope: status.pluginId ? "plugin" : configured ? "user" : "built-in",
    state,
    tools,
    error: status.toolsError ?? null,
  };
}

async function checkCodex({ command, env, cwd, clientVersion = "0.0.0", createRpc = (options) => new CodexRpc(options) }) {
  const rpc = createRpc({ command, cwd, ...(env ? { env } : {}) });
  rpc.start();
  try {
    await rpc.request("initialize", { clientInfo: { name: "milagre", title: "Milagre", version: clientVersion }, capabilities: null });
    rpc.notify("initialized");
    const configured = (await rpc.request("config/read", { cwd })).config?.mcp_servers ?? {};
    const servers = [];
    let cursor = null;
    do {
      const page = await rpc.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly", ...(cursor ? { cursor } : {}) });
      for (const status of page.data ?? []) servers.push(codexServer(status, configured[status.name]));
      cursor = page.nextCursor ?? null;
    } while (cursor);
    return servers;
  } finally {
    rpc.close();
  }
}

module.exports = { checkCodex, codexServer };
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `node --test packages/core/src/mcp/codex.test.cjs`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp/codex.cjs packages/core/src/mcp/codex.test.cjs
git commit -m "feat(mcp): check a Codex account's MCP servers through the app-server"
```

---

### Task 4: Accounts and the capped check

**Files:**
- Create: `packages/core/src/mcp/index.cjs`
- Create: `packages/core/src/mcp/index.test.cjs`

**Interfaces:**
- Consumes: `accounts.list(refresh)` from `packages/core/src/accounts.cjs` (returns `AccountsSnapshot`: `{ providers: [{ provider, accounts: [{ id, label, email?, state }] }] }`, where `state` is `ready`, `signed-out`, `error`, `signing-in` or `unknown`); `routing.forAccount(provider, accountId)` from `packages/core/src/account-routing.cjs` (returns `{ command, problem?, env, accountId }`); `checkClaude` (Task 2); `checkCodex` (Task 3).
- Produces: `createMcp({ accounts, routing, cwd, clientVersion?, checkers?, timeoutMs? })` returning `{ accounts(): Promise<McpAccount[]>, check(provider, accountId): Promise<McpAccountCheck> }`. `check` never rejects.

- [ ] **Step 1: Write the failing test**

`packages/core/src/mcp/index.test.cjs`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMcp } = require("./index.cjs");

const snapshot = {
  providers: [
    { provider: "claude", accounts: [{ id: "default", label: "Connected CLI account", email: "me@example.test", state: "ready" }, { id: "work", label: "Work", state: "signed-out" }] },
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
  assert.deepEqual(await mcp.check("claude", "default"), { provider: "claude", accountId: "default", label: "me@example.test", problem: null, servers: [report] });
  assert.equal(seen.command, "/bin/claude");
  assert.deepEqual(seen.env, { ACCOUNT: "default" });
  assert.equal(seen.cwd, "/home");
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

test("a checker that never answers is cut off at the cap", async () => {
  const mcp = createMcp({ accounts, routing, cwd: "/", timeoutMs: 20, checkers: { codex: () => new Promise(() => {}) } });
  const result = await mcp.check("codex", "default");
  assert.equal(result.problem, "Timed out after 30 s. Check the servers in a terminal.");
});

test("a checker that throws reports its message", async () => {
  const mcp = createMcp({ accounts, routing, cwd: "/", checkers: { codex: async () => { throw new Error("app-server exited"); } } });
  assert.equal((await mcp.check("codex", "default")).problem, "app-server exited");
});

test("an unknown account or provider is a problem, not a throw", async () => {
  const mcp = createMcp({ accounts, routing, cwd: "/" });
  assert.equal((await mcp.check("codex", "nope")).problem, "Account not found. Refresh and try again.");
  assert.equal((await mcp.check("antigravity", "default")).problem, "Account not found. Refresh and try again.");
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test packages/core/src/mcp/index.test.cjs`
Expected: FAIL, `Cannot find module './index.cjs'`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/mcp/index.cjs`:

```js
const { checkClaude } = require("./claude.cjs");
const { checkCodex } = require("./codex.cjs");

// Settings › MCP: which accounts to check, and one account's check, capped so a hung CLI or server never leaves the
// tab spinning. The tab checks every account in parallel and groups the answers itself (@milagre/shared/mcp).

const PROVIDERS = ["claude", "codex"];
const TIMEOUT_PROBLEM = "Timed out after 30 s. Check the servers in a terminal.";

function createMcp({ accounts, routing, cwd, clientVersion, checkers = {}, timeoutMs = 30_000 }) {
  const run = { claude: checkers.claude ?? checkClaude, codex: checkers.codex ?? checkCodex };

  async function listed() {
    const snapshot = await accounts.list(false);
    return snapshot.providers
      .filter((group) => PROVIDERS.includes(group.provider))
      .flatMap((group) => group.accounts.map((account) => ({ group, account })));
  }

  async function list() {
    return (await listed()).map(({ group, account }) => ({ provider: group.provider, accountId: account.id, label: account.email || account.label }));
  }

  async function check(provider, accountId) {
    const found = (await listed()).find(({ group, account }) => group.provider === provider && account.id === accountId);
    const base = { provider, accountId, label: found ? found.account.email || found.account.label : accountId };
    const answer = (problem, servers = []) => ({ ...base, problem, servers });
    if (!found) return answer("Account not found. Refresh and try again.");
    if (found.account.state === "signed-out") return answer("Not signed in. Sign in from Accounts.");
    const cli = await routing.forAccount(provider, accountId);
    if (cli.problem || !cli.command) return answer(cli.problem || "Install the provider CLI first.");
    let timer;
    const cap = new Promise((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT_PROBLEM), timeoutMs);
    });
    try {
      const result = await Promise.race([run[provider]({ command: cli.command, env: cli.env, cwd, clientVersion }), cap]);
      return result === TIMEOUT_PROBLEM ? answer(TIMEOUT_PROBLEM) : answer(null, result);
    } catch (error) {
      return answer(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  return { accounts: list, check };
}

module.exports = { createMcp };
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `node --test packages/core/src/mcp/index.test.cjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp/index.cjs packages/core/src/mcp/index.test.cjs
git commit -m "feat(mcp): list accounts and check one with a 30 s cap"
```

---

### Task 5: Runtime commands and the phone allowlist

**Files:**
- Modify: `packages/core/src/runtime.cjs` (after the `accounts:*` handlers, around line 956)
- Modify: `apps/daemon/src/mobile-bridge.cjs` (`METHODS`, next to `"accounts:list"` at line 93)
- Modify: `apps/daemon/src/confine.cjs` (`PATHS`, next to `"accounts:list": none` at line 124, and `checkCall` around line 196)
- Test: `apps/daemon/src/confine.test.cjs`

`confine.test.cjs:170` asserts that `METHODS` and the keys of `PATHS` are the same set, so every phone method is also listed in the demo computer's confinement table.

**Interfaces:**
- Consumes: `createMcp` (Task 4); `accounts` and `routing`, already built in `runtime.cjs` (lines 935-946); `version`.
- Produces: commands `mcp:accounts` → `McpAccount[]` and `mcp:check(provider, accountId)` → `McpAccountCheck`. On the confined demo phone both throw a 403 with `MCP_REFUSED`.

- [ ] **Step 1: Write the failing confinement test**

Append to `apps/daemon/src/confine.test.cjs`:

```js
test("the demo computer's phone cannot list or check MCP servers", async () => {
  const confine = createConfinement({ allowedRoot: os.tmpdir() });
  for (const [method, args] of [
    ["mcp:accounts", []],
    ["mcp:check", ["claude", "default"]],
  ]) {
    assert.ok(METHODS.has(method), method);
    await assert.rejects(confine.checkCall(method, args), (error) => error.status === 403 && error.message === MCP_REFUSED);
  }
});
```

and add `MCP_REFUSED` to the `require("./confine.cjs")` destructuring at the top of the file.

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test apps/daemon/src/confine.test.cjs`
Expected: FAIL (`METHODS.has("mcp:accounts")` is false).

- [ ] **Step 3: Add the commands and the phone methods**

In `packages/core/src/runtime.cjs`, add with the other requires:

```js
const { createMcp } = require("./mcp/index.cjs");
```

After the `accounts:${method}` loop (around line 956):

```js
  // Settings › MCP (docs/superpowers/specs/2026-10-09-mcp-settings-design.md): each account's servers and their status.
  // Read only; the tab checks every account in parallel.
  const mcp = createMcp({ accounts, routing, cwd: os.homedir(), clientVersion: version });
  commands.handle("mcp:accounts", () => mcp.accounts());
  commands.handle("mcp:check", (_event, provider, accountId) => mcp.check(String(provider), String(accountId)));
```

If `runtime.cjs` does not require `node:os` yet, add `const os = require("node:os");`.

In `apps/daemon/src/mobile-bridge.cjs` `METHODS`, after `"accounts:list",`:

```js
  "mcp:accounts",
  "mcp:check",
```

In `apps/daemon/src/confine.cjs`:

1. Next to the other message constants at the top: `const MCP_REFUSED = "MCP servers are not shown on this demo computer.";` and add `MCP_REFUSED` to `module.exports`.
2. In `PATHS`, after `"accounts:remove": none,`: `"mcp:accounts": none,` and `"mcp:check": none,`.
3. In `checkCall`, after the `accounts:` lines: `if (method.startsWith("mcp:")) throw failure(403, MCP_REFUSED);`

`peer-policy.cjs` needs no change: it only denies listed prefixes, so a paired desktop can call both.

- [ ] **Step 4: Run the daemon and core tests**

Run: `npm test -- --unit`
Expected: PASS, including the new confinement test and the `METHODS`/`PATHS` equality at `confine.test.cjs:170`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/runtime.cjs apps/daemon/src/mobile-bridge.cjs apps/daemon/src/confine.cjs apps/daemon/src/confine.test.cjs
git commit -m "feat(mcp): mcp:accounts and mcp:check for desktop, phones and paired Macs"
```

---

### Task 6: Desktop tab

**Files:**
- Modify: `apps/desktop/electron/preload.cjs` (next to the Linear methods, around line 123)
- Modify: `apps/desktop/app/src/electron.d.ts` (next to `readLinearStatus`, around line 249)
- Create: `apps/desktop/app/src/components/McpSettings.tsx`
- Modify: `apps/desktop/app/src/components/Settings.tsx` (`SettingsSection` at line 73, `SECTIONS` at line 85, the content switch around line 1743, `ComputerSettings` at line 206)
- Create: `scripts/test-mcp-settings.cjs`

**Interfaces:**
- Consumes: `mcp:accounts`, `mcp:check` (Task 5); `groupMcpRows`, `mcpSummary`, `mcpStateCopy` and the types from `@milagre/shared/mcp` (Task 1); `bridgeFor(computerId)` from `apps/desktop/app/src/lib/computer-bridge.ts`; `ProviderLogo` and `providerName`.
- Produces: `McpSettings({ bridge }: { bridge?: MilagreBridge })`.

- [ ] **Step 1: Expose the commands**

`apps/desktop/electron/preload.cjs`, after `saveLinearMoveToStarted`:

```js
    mcp: {
      accounts: () => invoke("mcp:accounts"),
      check: (provider, accountId) => invoke("mcp:check", provider, accountId),
    },
```

Do not add `mcp:` to `LOCAL_ONLY`: a paired Mac's tab calls the same methods on that Mac.

`apps/desktop/app/src/electron.d.ts`, in the bridge type after `onLinearStatusChanged`:

```ts
  mcp: {
    accounts: () => Promise<McpAccount[]>;
    check: (provider: McpAccount["provider"], accountId: string) => Promise<McpAccountCheck>;
  };
```

and add `import type { McpAccount, McpAccountCheck } from "@milagre/shared/mcp";` with the other imports.

- [ ] **Step 2: Write the Electron check (it fails until the tab exists)**

`scripts/test-mcp-settings.cjs`: copy `scripts/test-accounts.cjs` lines 81-159 (the `main()` Vite server and Electron spawn) unchanged except for the names: `accounts-fixture` → `mcp-fixture`, `/__accounts.tsx` → `/__mcp.tsx`, `/__accounts__` → `/__mcp__`, the temp dir prefix `milagre-accounts-ui-` → `milagre-mcp-ui-`. Then use this fixture and `browserChecks` body:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsPanel, SettingsNav } from '/src/components/Settings';
import '/src/styles.css';
const accounts = [
  { provider: 'claude', accountId: 'default', label: 'personal@example.test' },
  { provider: 'claude', accountId: 'work', label: 'Work' },
  { provider: 'codex', accountId: 'default', label: 'Connected CLI account' },
];
const answers = {
  'claude:default': { problem: null, servers: [
    { name: 'pencil', transport: 'command', scope: 'user', state: 'connected', tools: 5, error: null },
    { name: 'linear', transport: 'url', scope: 'plugin', state: 'needs-sign-in', tools: 0, error: null },
    { name: 'claude.ai Gmail', transport: 'connector', scope: 'claude.ai', state: 'connected', tools: 30, error: null },
  ] },
  'claude:work': { problem: 'Not signed in. Sign in from Accounts.', servers: [] },
  'codex:default': { problem: null, servers: [
    { name: 'linear', transport: 'url', scope: 'user', state: 'connected', tools: 76, error: null },
    { name: 'epidemic-sound', transport: 'url', scope: 'user', state: 'failed', tools: 0, error: 'Environment variable EPIDEMIC_SOUND_API_KEY is not set' },
  ] },
};
window.checks = 0;
window.release = null;
window.milagre = {
  listAccounts: async () => ({ providers: [] }),
  listRecentProjects: async () => [],
  onAccountsChanged: () => () => {},
  mcp: {
    accounts: async () => accounts,
    check: async (provider, accountId) => {
      window.checks++;
      const key = provider + ':' + accountId;
      // Codex answers only when the test says so, to show a spinner chip next to finished ones; a reject shows its error.
      if (key === 'codex:default' && !window.codexReleased) await new Promise((resolve) => { window.release = resolve; });
      if (window.failNext) { window.failNext = false; throw new Error('Mac unreachable'); }
      return { provider, accountId, label: accounts.find(a => a.provider === provider && a.accountId === accountId).label, ...answers[key] };
    },
  },
};
document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')).render(<div style={{display:'flex',height:'100vh',padding:16,gap:16}}><SettingsNav section="mcp" onSelect={()=>{}} onBack={()=>{}} /><main style={{flex:1}}><SettingsPanel section="mcp" models={[]} /></main></div>);
`;
async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", fs.mkdtempSync(path.join(require("node:os").tmpdir(), "milagre-mcp-ui-")));
  await app.whenReady();
  const win = new BrowserWindow({ width: 1120, height: 850, show: false, webPreferences: { backgroundThrottling: false } });
  const evaluate = (source) => win.webContents.executeJavaScript(source);
  const waitFor = async (source) => {
    for (let i = 0; i < 160; i++) {
      if (await evaluate(source)) return;
      await delay(50);
    }
    throw new Error("Timed out: " + source);
  };
  const text = () => evaluate("document.body.textContent");
  const shot = async (name) => {
    const dir = process.env.MILAGRE_SCREENSHOT_DIR;
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      await delay(250);
      fs.writeFileSync(path.join(dir, name + ".png"), (await win.webContents.capturePage()).toPNG());
    }
  };
  try {
    await win.loadURL(process.argv[2]);
    // Claude answered, Codex is still checking: finished chips and a spinner chip side by side.
    await waitFor(`document.body.textContent.includes('pencil')`);
    await waitFor(`!!document.querySelector('[data-mcp-chip="codex:default"][data-state="pending"]')`);
    await shot("mcp-checking");
    await evaluate("window.codexReleased = true; window.release()");
    await waitFor(`!!document.querySelector('[data-mcp-row="epidemic-sound"]')`);
    // One row per name; linear has a Claude plugin chip and a Codex user chip.
    assert.equal(await evaluate(`document.querySelectorAll('[data-mcp-row="linear"] [data-mcp-chip]').length`), 2);
    assert.match(await text(), /1 of 2 connected/);
    assert.match(await text(), /EPIDEMIC_SOUND_API_KEY/);
    // The signed-out account says so instead of listing servers.
    assert.match(await text(), /Work.*Not signed in/);
    // claude.ai and plugin-only servers sit under "From projects and plugins".
    assert.ok(await evaluate(`!!document.querySelector('[data-mcp-other] [data-mcp-row="claude.ai Gmail"]')`));
    await shot("mcp-list");
    // Refresh checks every account again; a check that rejects shows its error on that account.
    const before = await evaluate("window.checks");
    await evaluate("window.failNext = true");
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Refresh').click()`);
    await waitFor(`window.checks >= ${before + 3}`);
    await waitFor(`document.body.textContent.includes('Mac unreachable')`);
    await shot("mcp-error");
  } finally {
    app.quit();
  }
}
```

Run: `npm test -- --only test-mcp-settings`
Expected: FAIL (`Timed out: document.body.textContent.includes('pencil')`), because the section does not exist yet.

- [ ] **Step 3: Write the tab**

`apps/desktop/app/src/components/McpSettings.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import { groupMcpRows, mcpStateCopy, mcpSummary, type McpAccount, type McpAccountCheck, type McpChip, type McpRow } from "@milagre/shared/mcp";
import { providerName } from "@milagre/shared/providers";
import type { MilagreBridge } from "../electron";
import { ProviderLogo } from "./ProviderLogo";

const button =
  "inline-flex items-center gap-1.5 rounded-lg border border-line cursor-pointer disabled:cursor-default px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover disabled:opacity-40";
const keyOf = (account: McpAccount) => `${account.provider}:${account.accountId}`;
const DOT: Record<McpChip["state"], string> = {
  connected: "bg-green-500",
  failed: "bg-red-500",
  "needs-sign-in": "bg-amber-500",
  pending: "bg-ink-4 animate-pulse",
  disabled: "bg-ink-4",
};

type Entry = { account: McpAccount; check: McpAccountCheck | null };

/** Settings › MCP for one Mac: this one by default, or a paired Mac's bridge on its computer page. */
export function McpSettings({ bridge = window.milagre }: { bridge?: MilagreBridge }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const run = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++run.current;
    setError("");
    let accounts: McpAccount[];
    try {
      accounts = await bridge.mcp.accounts();
    } catch (cause) {
      if (id === run.current) setError(cause instanceof Error ? cause.message : "Could not read this Mac's accounts.");
      return;
    }
    if (id !== run.current) return;
    setEntries(accounts.map((account) => ({ account, check: null })));
    // Every account at once; each fills in as it answers, so one slow account never holds the others.
    await Promise.all(
      accounts.map(async (account) => {
        const check = await bridge.mcp
          .check(account.provider, account.accountId)
          .catch((cause): McpAccountCheck => ({ ...account, problem: cause instanceof Error ? cause.message : String(cause), servers: [] }));
        if (id !== run.current) return;
        setEntries((current) => current?.map((entry) => (keyOf(entry.account) === keyOf(account) ? { ...entry, check } : entry)) ?? null);
      }),
    );
  }, [bridge]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const checks = (entries ?? []).flatMap((entry) => (entry.check ? [entry.check] : []));
  const { user, other } = groupMcpRows(checks);
  const pending = (entries ?? []).filter((entry) => !entry.check).map((entry) => entry.account);
  const problems = checks.filter((check) => check.problem);
  const checking = pending.length > 0;

  return (
    <div className="mt-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[13px] text-ink-3">The MCP servers each account loads in its Chats, checked now.</p>
        <button className={button} disabled={checking} onClick={() => void refresh()}>
          <HugeiconsIcon icon={RefreshIcon} size={14} strokeWidth={1.8} color="currentColor" />
          Refresh
        </button>
      </div>
      {error && <p className="text-[13px] text-red-500">{error}</p>}
      {problems.length > 0 && (
        <ul className="space-y-1 text-[12px] text-ink-3">
          {problems.map((check) => (
            <li key={keyOf(check)} data-mcp-problem={keyOf(check)}>
              {providerName(check.provider)} · {check.label}: {check.problem}
            </li>
          ))}
        </ul>
      )}
      <Rows rows={user} pending={pending} />
      {other.length > 0 && (
        <details data-mcp-other className="group">
          <summary className="cursor-pointer text-[13px] font-medium text-ink-2">From projects and plugins ({other.length})</summary>
          <p className="mt-1 text-[12px] text-ink-3">Set up in a project, a plugin or claude.ai. Change them there.</p>
          <div className="mt-3">
            <Rows rows={other} pending={[]} />
          </div>
        </details>
      )}
      {entries && !checking && user.length === 0 && other.length === 0 && problems.length === 0 && (
        <p className="text-[13px] text-ink-3">No MCP servers yet. Add one with the Claude or Codex CLI on this Mac.</p>
      )}
    </div>
  );
}

function Rows({ rows, pending }: { rows: McpRow[]; pending: McpAccount[] }) {
  if (!rows.length && !pending.length) return null;
  return (
    <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
      {rows.map((row) => (
        <div key={row.name} data-mcp-row={row.name} className="space-y-2 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium text-ink">{row.name}</span>
            <span className="text-[12px] text-ink-3">
              {row.transport === "command" ? "Command" : row.transport === "url" ? "URL" : "claude.ai"} · {mcpSummary(row)}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {row.chips.map((chip) => (
              <Chip key={keyOf(chip)} chip={chip} />
            ))}
            {pending.map((account) => (
              <Chip key={keyOf(account)} chip={{ ...account, scope: "user", state: "pending", tools: 0, error: null }} />
            ))}
          </div>
        </div>
      ))}
      {!rows.length && (
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {pending.map((account) => (
            <Chip key={keyOf(account)} chip={{ ...account, scope: "user", state: "pending", tools: 0, error: null }} />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ chip }: { chip: McpChip }) {
  const detail = chip.error ?? (chip.state === "connected" ? `${chip.tools} tools` : mcpStateCopy(chip.state));
  return (
    <span
      data-mcp-chip={keyOf(chip)}
      data-state={chip.state}
      title={detail}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2"
    >
      <ProviderLogo provider={chip.provider} size={12} />
      <span className="truncate">{chip.label}</span>
      <span className={`size-1.5 shrink-0 rounded-full ${DOT[chip.state]}`} />
      {chip.state !== "connected" && <span className="truncate text-ink-3">{chip.error ?? mcpStateCopy(chip.state)}</span>}
    </span>
  );
}
```

Pending chips are drawn on every row while an account is still checking, so the user sees which accounts have not answered. Check `ProviderLogo`'s props in `ProviderLogo.tsx` and match them if `size` is named differently.

- [ ] **Step 4: Add the section**

In `apps/desktop/app/src/components/Settings.tsx`:

1. Add `| "mcp"` to `SettingsSection` after `"skills"`.
2. Add to `SECTIONS` after Skills: `{ key: "mcp", label: "MCP", icon: PlugSocketIcon },` and import `PlugSocketIcon` from `@hugeicons/core-free-icons` (if that name is missing in the installed version, use `Plug01Icon`).
3. Import `McpSettings` and add after the Skills block in the content switch: `{section === "mcp" && <McpSettings />}`.
4. In `ComputerSettings`, below the existing blocks, add a block shown while the computer is online:

```tsx
{computer.state === "online" && (
  <section className="mt-8">
    <h2 className="text-[13px] font-semibold text-ink">MCP servers</h2>
    <McpSettings key={id} bridge={bridgeFor(id)} />
  </section>
)}
```

and import `bridgeFor` from `../lib/computer-bridge`.

- [ ] **Step 5: Run the Electron check and look at the screenshots**

Run: `MILAGRE_SCREENSHOT_DIR=$TMPDIR/mcp-settings npm test -- --only test-mcp-settings`
Expected: PASS. Open `$TMPDIR/mcp-settings/mcp-checking.png`, `mcp-list.png` and `mcp-error.png`: Codex chips pulse while it checks, the list has `epidemic-sound`, `linear`, `pencil` with chips, the Work account says it is not signed in, and the error screenshot shows "Mac unreachable".

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/electron/preload.cjs apps/desktop/app/src/electron.d.ts apps/desktop/app/src/components/McpSettings.tsx apps/desktop/app/src/components/Settings.tsx scripts/test-mcp-settings.cjs
git commit -m "feat(mcp): Settings › MCP on desktop, for this Mac and paired Macs"
```

---

### Task 7: Phone screen

**Files:**
- Create: `apps/mobile/src/mcp-section.tsx`
- Create: `apps/mobile/src/app/mcp.tsx`
- Modify: `apps/mobile/src/app/settings.tsx` (`SettingsPage` at line 22, the rows at lines 93-115)

**Interfaces:**
- Consumes: `mcp:accounts`, `mcp:check` through `session.client.call` (Task 5); `groupMcpRows`, `mcpSummary`, `mcpStateCopy` and types from `@milagre/shared/mcp` (Task 1); `useSession`, `useStyles`, `useTheme`, `ProviderLogo`, `Icon`, `ErrorNotice`, `PageScroll` as `accounts-section.tsx` uses them.
- Produces: `McpSection()`.

- [ ] **Step 1: Write the screen**

`apps/mobile/src/app/mcp.tsx`:

```tsx
import { Stack } from "expo-router";
import { PageScroll } from "../ui";
import { McpSection } from "../mcp-section";

export default function McpScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "MCP servers" }} />
      <PageScroll>
        <McpSection />
      </PageScroll>
    </>
  );
}
```

`apps/mobile/src/mcp-section.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import { groupMcpRows, mcpStateCopy, mcpSummary, type McpAccount, type McpAccountCheck, type McpChip, type McpRow } from "@milagre/shared/mcp";
import { providerName } from "@milagre/shared/providers";
import { useSession } from "./session";
import { Icon, ProviderLogo } from "./icons";
import { useStyles } from "./ui";
import { useTheme } from "./theme";

const keyOf = (account: McpAccount) => `${account.provider}:${account.accountId}`;
type Entry = { account: McpAccount; check: McpAccountCheck | null };

export function McpSection() {
  const session = useSession();
  return <McpForComputer key={session.client?.url || "disconnected"} />;
}

function McpForComputer() {
  const styles = useStyles();
  const { colors } = useTheme();
  const client = useSession().client;
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const run = useRef(0);
  const refresh = useCallback(async () => {
    if (!client) return;
    const id = ++run.current;
    setError("");
    let accounts: McpAccount[];
    try {
      accounts = await client.call<McpAccount[]>("mcp:accounts", []);
    } catch (cause) {
      // An older Mac, or the demo computer, refuses the method.
      if (id === run.current) setError("Not available on this computer. Update Milagre on the Mac, then refresh.");
      return;
    }
    if (id !== run.current) return;
    setEntries(accounts.map((account) => ({ account, check: null })));
    await Promise.all(
      accounts.map(async (account) => {
        const check = await client
          .call<McpAccountCheck>("mcp:check", [account.provider, account.accountId])
          .catch((): McpAccountCheck => ({ ...account, problem: "Could not check. Check the computer connection, then refresh.", servers: [] }));
        if (id !== run.current) return;
        setEntries((current) => current?.map((entry) => (keyOf(entry.account) === keyOf(account) ? { ...entry, check } : entry)) ?? null);
      }),
    );
  }, [client]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const checks = (entries ?? []).flatMap((entry) => (entry.check ? [entry.check] : []));
  const { user, other } = groupMcpRows(checks);
  const waiting = (entries ?? []).filter((entry) => !entry.check).length;
  const problems = checks.filter((check) => check.problem);
  const card = { backgroundColor: colors.surface, borderRadius: 14, borderCurve: "continuous" as const, overflow: "hidden" as const, borderWidth: 1, borderColor: colors.line };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 }}>
        <Text style={styles.muted}>{waiting ? `Checking ${waiting} account${waiting === 1 ? "" : "s"}...` : "Checked now"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh" disabled={waiting > 0} onPress={() => void refresh()} hitSlop={10}>
          <Icon icon={RefreshIcon} tone={waiting ? "muted" : "ink"} size={20} />
        </Pressable>
      </View>
      {error ? (
        <Text accessibilityRole="alert" selectable style={styles.text}>
          {error}
        </Text>
      ) : null}
      {problems.map((check) => (
        <Text key={keyOf(check)} style={styles.muted}>
          {providerName(check.provider)} · {check.label}: {check.problem}
        </Text>
      ))}
      {user.length ? <View style={card}>{user.map((row, index) => <RowView key={row.name} row={row} first={index === 0} />)}</View> : null}
      {other.length ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={[styles.text, { fontWeight: "600", paddingHorizontal: 4 }]}>
            From projects and plugins
          </Text>
          <View style={card}>{other.map((row, index) => <RowView key={row.name} row={row} first={index === 0} />)}</View>
        </View>
      ) : null}
      {entries && !waiting && !user.length && !other.length && !problems.length ? (
        <Text style={styles.muted}>No MCP servers yet. Add one with the Claude or Codex CLI on the Mac.</Text>
      ) : null}
    </View>
  );
}

function RowView({ row, first }: { row: McpRow; first: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderColor: colors.line, padding: 14, gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <Text style={[styles.text, { fontWeight: "600", flexShrink: 1 }]} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={styles.muted}>{mcpSummary(row)}</Text>
      </View>
      {row.chips.map((chip) => (
        <ChipView key={keyOf(chip)} chip={chip} />
      ))}
    </View>
  );
}

function ChipView({ chip }: { chip: McpChip }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const dot = chip.state === "connected" ? colors.success : chip.state === "failed" ? colors.danger : chip.state === "needs-sign-in" ? colors.warning : colors.ink3;
  const detail = chip.state === "connected" ? `${chip.tools} tools` : (chip.error ?? mcpStateCopy(chip.state));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <ProviderLogo provider={chip.provider} size={14} />
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} />
      <Text style={[styles.muted, { flexShrink: 1 }]} numberOfLines={2} selectable>
        {chip.label} · {detail}
      </Text>
    </View>
  );
}
```

Check the color names in `apps/mobile/src/theme` (`success`, `danger`, `warning`, `ink3`) and the `Icon` tones in `icons.tsx`, and use the names they define if these differ.

- [ ] **Step 2: Add the Settings row**

In `apps/mobile/src/app/settings.tsx`, add `| "mcp"` to `SettingsPage`, and after the Skills row:

```tsx
        <ListRow compact title="MCP servers" leading={<Icon icon={PlugSocketIcon} tone="ink" size={20} />} onPress={() => onOpen("mcp")} />
```

with `PlugSocketIcon` imported from `@hugeicons/core-free-icons` (same fallback as desktop: `Plug01Icon`). Use the same icon on both platforms.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Verify on the simulator**

Use the Designs QA simulator with a local dev build (Expo Go is broken for this app; see the in-place-handoff memory note). Pair it with this branch's daemon, open Settings › MCP servers, wait for the list, and screenshot it. Then connect to a Mac running a build without `mcp:*` (or the demo computer's confined route) and screenshot "Not available on this computer". Save both to `$TMPDIR/mcp-settings/phone-*.png`.

- [ ] **Step 5: Check the fingerprint**

Follow `apps/mobile/AGENTS.md` to compare the runtime fingerprint with the TestFlight build. Expected: unchanged (JS only). If it changed, stop and ask before going further.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/mcp-section.tsx apps/mobile/src/app/mcp.tsx apps/mobile/src/app/settings.tsx
git commit -m "feat(mcp): MCP servers on the phone"
```

---

### Task 8: Docs, checks and PR

**Files:**
- Modify: `GLOSSARY.md` (next to Account, around line 9)
- Modify: `docs/superpowers/specs/2026-10-09-mcp-settings-design.md` (Status line)

- [ ] **Step 1: Glossary**

Add to `GLOSSARY.md`:

```markdown
- **MCP server**: a tool server a provider loads into a Chat. A command server is a process on the Mac; a URL server is
  remote. Settings › MCP lists each account's servers and their status. Not to be confused with Milagre's own
  `milagre` server, which every Chat gets and which Settings › MCP does not list.
```

- [ ] **Step 2: Run every check**

Run: `npm run typecheck && npm run lint && npm test -- --unit && npm test -- --only test-mcp-settings`
Expected: all pass. Paste failures with their output if any remain.

- [ ] **Step 3: Live check on this Mac**

Run the dev app, open Settings › MCP, and confirm the list matches `claude mcp list` and `codex mcp list` for the default accounts. Note any server whose state differs and why.

- [ ] **Step 4: Screenshots on the `screenshots` branch**

In a temporary worktree of `origin/screenshots`, copy `$TMPDIR/mcp-settings/*.png` into `mcp-settings/`, commit and push. Link each image in the PR body by that commit's SHA: `https://raw.githubusercontent.com/the-ptf/milagre-ade/<sha>/mcp-settings/<name>.png`.

- [ ] **Step 5: Open the PR**

Title: `feat: Settings › MCP lists each account's MCP servers and their status (read only)`. Body: what it shows, the two probes' numbers, the phone screenshots, "Part of #376; PR 2 adds editing", and the OTA note. No attribution footer.

---

## Self-review

- Spec coverage for PR 1: the read-only tab on desktop (Task 6) and phone (Task 7), live status per account (Tasks 2-4), the computer page for paired Macs (Task 6 step 4), phone and peer access (Task 5), the glossary (Task 8). Editing, the off list, the #375 deletion fix, Everywhere, Antigravity chips and sign-in belong to PRs 2 and 3.
- Names used across tasks: `McpAccount`, `McpAccountCheck`, `McpServerReport`, `McpChip`, `McpRow`, `groupMcpRows`, `mcpSummary`, `mcpStateCopy`, `checkClaude`, `checkCodex`, `createMcp`, `mcp:accounts`, `mcp:check`, `bridge.mcp.accounts`, `bridge.mcp.check`.
- Review Focus tests: hang and timeout (Task 4), signed out and missing CLI (Task 4), cross-provider grouping (Task 1), confined phone (Task 5 and Task 7 step 4), remote drop (Task 6 Electron check).
