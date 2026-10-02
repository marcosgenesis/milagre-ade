# Usage Status Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a thin status bar under the chat that shows live Claude and Codex usage, with a hover/focus card listing every window and its reset time.

**Architecture:**
- A new main-process module, `electron/usage.cjs`, reads Claude usage from Anthropic's OAuth usage endpoint, using the token Claude Code already stores. It reads Codex usage from a short-lived `codex app-server` JSON-RPC session.
- It returns plain `ProviderUsage` objects over one IPC call, `usage:read`. The token never leaves the main process.
- The renderer polls through a `useUsage()` hook and renders `UsageStatusBar`, plus a portaled `UsageCard`.

**Tech Stack:** Electron 44 (CommonJS main process, global `fetch`), React 19 + Tailwind 4 tokens, `@hugeicons/react`, `node:test` (Node 24, including built-in TypeScript type stripping for renderer helper tests).

**Spec:** `docs/specs/002-usage-status-bar.md`

**Spec deltas** (decided while planning; everything else follows the spec):
1. The module exports `createUsageReader(deps)`, which returns `readUsage()`, instead of a bare `readUsage(deps)`. The shared in-flight promise needs a closure to live in.
2. Provider marks use Hugeicons' existing `ClaudeIcon` and `ChatGptIcon` instead of hand-drawn SVGs.
3. Codex sign-in is detected with `account/read` (where `account: null` means not signed in) before `account/rateLimits/read`.
4. Renderer helpers get unit tests through `npm run test:ui` (Node type stripping). `*.test.ts` files are excluded from `tsc`.
5. Clicking a segment (or Enter/Space on it) also opens its card, so mouse and keyboard behave the same.

## Global Constraints

- No new npm dependencies.
- **Claude credentials:**
  - macOS: `/usr/bin/security find-generic-password -s "Claude Code-credentials" -w`.
  - Fallback: `~/.claude/.credentials.json`.
  - Both hold `{ claudeAiOauth: { accessToken, expiresAt } }`.
  - Never refresh or write credentials.
- **Claude endpoint:** `GET https://api.anthropic.com/api/oauth/usage` with headers `Authorization: Bearer <accessToken>` and `anthropic-beta: oauth-2025-04-20`.
- **Codex source:** spawn `codex app-server` and send newline-delimited JSON-RPC: `initialize` → `initialized` (notification) → `account/read` → `account/rateLimits/read`. The child is always killed.
- **Token handling:** the access token never appears in a return value, an IPC payload, a log line or an error message.
- **Timeouts:** 10 s per provider (`PROVIDER_TIMEOUT_MS = 10_000`).
- **Refresh triggers:**
  - on mount
  - every 5 min (`POLL_MS = 300_000`)
  - after every agent run settles (success, error or cancel)
  - `refreshIfStale(60_000)` when a card opens
- **Bar:**
  - `h-7` (28 px) row inside `<main>`, under the chat, right-aligned, `text-[12px] text-ink-2 tabular-nums`.
  - Shows the first two windows per provider; mini bars are `h-1 w-9` (4×36 px).
  - Providers with status `unavailable` are hidden; if none are left, the bar renders nothing.
- **Card:** 288 px wide, `bg-surface shadow-overlay rounded-[14px]`, `pop-in 180ms cubic-bezier(0.23,1,0.32,1)`, `h-1.5` bars.
- **Tones** (from the rounded percent): fill `bg-ink-2` below 80, `bg-orange` from 80, `bg-red` from 95. Track `bg-line-strong`.
- **Timing:** open after 120 ms of hover, or immediately on keyboard focus or click. Close 150 ms after the pointer leaves. Escape on a focused segment closes the card and must not reach App's window-level Escape handler, which cancels the running agent.
- **Copy strings (exact):**
  - "Not signed in to Claude Code."
  - "Claude sign-in expired. Running any Claude agent refreshes it."
  - "Claude is rate limiting usage checks. Try again in a minute."
  - "Claude usage failed (HTTP <status>)."
  - "Claude returned an unreadable usage response."
  - "Claude returned no usage windows."
  - "Couldn't reach Claude."
  - "Claude usage timed out."
  - "Not signed in to Codex."
  - "Codex CLI not found."
  - "Couldn't start Codex."
  - "Codex usage timed out."
  - "Codex exited before reporting usage."
  - "Codex couldn't read usage."
  - "Codex returned no usage windows."
  - "Couldn't read usage."
- **Commits:** conventional-commit style (`feat: …`, `test: …`, `docs: …`), on this branch only, never pushed by the plan.

## Review Focus

1. **Claude reorders `limits` or adds a kind Milagre doesn't know.** The bar still shows Session then Weekly, and unknown kinds are skipped rather than shown as blank rows. Pinned in Task 1, Step 2.
2. **Codex stdout splits one JSON reply across chunks and mixes in notifications.** Usage is still parsed. Pinned in Task 2, Step 1.
3. **A refresh fails right after a good read** (429, offline, expired token). The card keeps the last numbers, "Updated Xm ago" stays truthful, and the reason is shown. Repeated failures keep the numbers too. Pinned in Task 4, Step 1.
4. **A reset time has already passed, or `updatedAt` is ahead of the renderer clock.** Show "Resetting…" and "Updated just now", never negative durations. Pinned in Task 4, Step 1.
5. **Escape on an open card while an agent is running.** Only the card closes; the run keeps going. Pinned in Task 5, Step 9 (live check: there is no React test harness in this repo).

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `electron/usage.cjs` | Create | Read Claude + Codex usage, normalise to `ProviderUsage`, share in-flight reads |
| `electron/usage.test.cjs` | Create | `node:test` coverage for the module with injected fakes |
| `electron/main.cjs` | Modify | Register the `usage:read` IPC handler |
| `electron/preload.cjs` | Modify | Expose `readUsage()` |
| `app/src/model.ts` | Modify | `UsageWindow`, `ProviderUsage`, `UsageSnapshot` types |
| `app/src/electron.d.ts` | Modify | Type `window.milagre.readUsage` |
| `app/src/components/usage/format.ts` | Create | Pure helpers: tones, percent / reset / updated copy, merge, visibility, aria label |
| `app/src/components/usage/format.test.ts` | Create | `node:test` coverage for `format.ts` |
| `app/src/components/usage/useUsage.ts` | Create | Polling hook with `refresh` / `refreshIfStale` |
| `app/src/components/usage/ProviderMark.tsx` | Create | Provider icon |
| `app/src/components/usage/UsageBar.tsx` | Create | Toned progress bar used by the row and the card |
| `app/src/components/usage/UsageCard.tsx` | Create | Portaled details card |
| `app/src/components/usage/UsageStatusBar.tsx` | Create | The row, hover/focus/Escape behaviour, card placement |
| `app/src/App.tsx` | Modify | Mount the hook and the bar; refresh after each run |
| `package.json` | Modify | `test:ui` script |
| `tsconfig.json` | Modify | Exclude `app/src/**/*.test.ts` |

---

### Task 1: Claude usage reader

**Files:**
- Create: `electron/usage.cjs`
- Test: `electron/usage.test.cjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `readClaudeUsage(deps?) → Promise<ProviderUsage>`. It never rejects. `deps` is `{ platform?, execFileImpl?, readFile?, home?, fetchImpl?, now?, timeoutMs? }`.
  - Module-internal helpers reused by Task 2: `providerResult(provider, now, status, windows?, message?)`, `percentOrNull(value)`, `SESSION`, `WEEKLY`, `PROVIDER_TIMEOUT_MS`.
  - `ProviderUsage = { provider: "claude" | "codex", status: "ok" | "unavailable" | "error", windows: UsageWindow[], updatedAt: string, message?: string }`
  - `UsageWindow = { id, label, shortLabel, usedPercent, resetsAt: string | null }`

- [ ] **Step 1: Install dependencies and commit the spec and plan**

The worktree has no `node_modules`.

```bash
npm ci
git add docs/specs/002-usage-status-bar.md docs/superpowers/plans/2026-10-01-usage-status-bar.md
git commit -m "docs: spec and plan for the usage status bar"
```

Expected: `npm ci` finishes without errors; the commit contains two files.

- [ ] **Step 2: Write the failing tests**

Create `electron/usage.test.cjs`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { readClaudeUsage } = require("./usage.cjs");

const TOKEN = "sk-ant-oat01-SECRET-TOKEN";
const NOW = Date.parse("2026-10-01T19:30:00Z");
const CREDENTIALS = JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: NOW + 60 * 60_000, subscriptionType: "max" } });
const CREDENTIALS_FILE = "/Users/test/.claude/.credentials.json";

const USAGE_BODY = {
  five_hour: { utilization: 73, resets_at: "2026-10-01T20:49:59Z" },
  seven_day: { utilization: 61, resets_at: "2026-10-06T19:59:59Z" },
  limits: [
    { kind: "session", group: "session", percent: 73, resets_at: "2026-10-01T20:49:59Z", scope: null },
    { kind: "weekly_all", group: "weekly", percent: 61, resets_at: "2026-10-06T19:59:59Z", scope: null },
    { kind: "weekly_scoped", group: "weekly", percent: 66, resets_at: "2026-10-06T19:59:59Z", scope: { model: { id: null, display_name: "Fable" }, surface: null } },
  ],
};

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function setup({ platform = "darwin", keychainOutput = CREDENTIALS, fileContents = {}, response = json(200, USAGE_BODY) } = {}) {
  const execCalls = [];
  const fetchCalls = [];
  const deps = {
    platform,
    home: "/Users/test",
    now: () => NOW,
    execFileImpl: (command, args, _options, callback) => {
      execCalls.push({ command, args });
      if (keychainOutput instanceof Error) callback(keychainOutput, "", "");
      else callback(null, keychainOutput, "");
    },
    readFile: async (file) => {
      if (Object.hasOwn(fileContents, file)) return fileContents[file];
      throw Object.assign(new Error(`ENOENT: no such file, open '${file}'`), { code: "ENOENT" });
    },
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      if (response instanceof Error) throw response;
      return response;
    },
  };
  return { deps, execCalls, fetchCalls };
}

test("reads Claude usage with the Claude Code token and maps every limit", async () => {
  const { deps, execCalls, fetchCalls } = setup();
  const result = await readClaudeUsage(deps);
  assert.deepEqual(execCalls, [{ command: "/usr/bin/security", args: ["find-generic-password", "-s", "Claude Code-credentials", "-w"] }]);
  assert.equal(fetchCalls[0].url, "https://api.anthropic.com/api/oauth/usage");
  assert.equal(fetchCalls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(fetchCalls[0].init.headers["anthropic-beta"], "oauth-2025-04-20");
  assert.deepEqual(result, {
    provider: "claude",
    status: "ok",
    updatedAt: new Date(NOW).toISOString(),
    windows: [
      { id: "session", label: "Session", shortLabel: "5h", usedPercent: 73, resetsAt: "2026-10-01T20:49:59Z" },
      { id: "weekly", label: "Weekly", shortLabel: "wk", usedPercent: 61, resetsAt: "2026-10-06T19:59:59Z" },
      { id: "weekly:fable", label: "Fable", shortLabel: "wk", usedPercent: 66, resetsAt: "2026-10-06T19:59:59Z" },
    ],
  });
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

test("puts Session and Weekly first and skips limits it does not understand", async () => {
  const [session, weekly, fable] = USAGE_BODY.limits;
  const { deps } = setup({ response: json(200, { limits: [fable, { kind: "monthly_mystery", percent: 10, resets_at: null }, weekly, session] }) });
  const result = await readClaudeUsage(deps);
  assert.deepEqual(result.windows.map((item) => item.id), ["session", "weekly", "weekly:fable"]);
});

test("falls back to five_hour and seven_day when limits is missing", async () => {
  const { deps } = setup({ response: json(200, { five_hour: USAGE_BODY.five_hour, seven_day: USAGE_BODY.seven_day }) });
  const result = await readClaudeUsage(deps);
  assert.deepEqual(result.windows.map((item) => [item.id, item.usedPercent]), [["session", 73], ["weekly", 61]]);
});

test("clamps out-of-range percentages and skips missing ones", async () => {
  const { deps } = setup({ response: json(200, { limits: [
    { kind: "session", percent: 130, resets_at: null },
    { kind: "weekly_all", percent: null, resets_at: null },
  ] }) });
  const result = await readClaudeUsage(deps);
  assert.deepEqual(result.windows, [{ id: "session", label: "Session", shortLabel: "5h", usedPercent: 100, resetsAt: null }]);
});

test("uses the credentials file when the Keychain has no Claude item", async () => {
  const { deps, fetchCalls } = setup({
    keychainOutput: new Error("The specified item could not be found in the keychain."),
    fileContents: { [CREDENTIALS_FILE]: CREDENTIALS },
  });
  const result = await readClaudeUsage(deps);
  assert.equal(result.status, "ok");
  assert.equal(fetchCalls.length, 1);
});

test("skips the Keychain outside macOS", async () => {
  const { deps, execCalls } = setup({ platform: "linux", fileContents: { [CREDENTIALS_FILE]: CREDENTIALS } });
  const result = await readClaudeUsage(deps);
  assert.equal(result.status, "ok");
  assert.equal(execCalls.length, 0);
});

test("reports unavailable without calling the API when there are no credentials", async () => {
  const { deps, fetchCalls } = setup({ keychainOutput: new Error("not found") });
  const result = await readClaudeUsage(deps);
  assert.deepEqual([result.status, result.windows, result.message], ["unavailable", [], "Not signed in to Claude Code."]);
  assert.equal(fetchCalls.length, 0);
});

test("ignores malformed credentials without echoing them", async () => {
  const { deps } = setup({ keychainOutput: `{"claudeAiOauth":{"accessToken":"${TOKEN}"` });
  const result = await readClaudeUsage(deps);
  assert.equal(result.status, "unavailable");
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

test("reports an expired sign-in without calling the API", async () => {
  const { deps, fetchCalls } = setup({ keychainOutput: JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: NOW - 1 } }) });
  const result = await readClaudeUsage(deps);
  assert.deepEqual([result.status, result.message], ["error", "Claude sign-in expired. Running any Claude agent refreshes it."]);
  assert.equal(fetchCalls.length, 0);
});

const FAILURES = [
  ["HTTP 401", json(401, { error: "unauthorized" }), "Claude sign-in expired. Running any Claude agent refreshes it."],
  ["HTTP 429", json(429, {}), "Claude is rate limiting usage checks. Try again in a minute."],
  ["HTTP 500", json(500, {}), "Claude usage failed (HTTP 500)."],
  ["unreadable JSON", { ok: true, status: 200, json: async () => { throw new SyntaxError(`Unexpected token near ${TOKEN}`); } }, "Claude returned an unreadable usage response."],
  ["no windows", json(200, { limits: [] }), "Claude returned no usage windows."],
  ["a network failure", new TypeError(`fetch failed for ${TOKEN}`), "Couldn't reach Claude."],
  ["a timeout", Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "Claude usage timed out."],
];

for (const [name, response, message] of FAILURES) {
  test(`reports ${name} as an error without leaking the token`, async () => {
    const { deps } = setup({ response });
    const result = await readClaudeUsage(deps);
    assert.deepEqual([result.status, result.windows, result.message], ["error", [], message]);
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  });
}
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `node --test electron/usage.test.cjs`
Expected: FAIL with `Cannot find module './usage.cjs'`.

- [ ] **Step 4: Implement the Claude reader**

Create `electron/usage.cjs`:

```js
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const PROVIDER_TIMEOUT_MS = 10_000;
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_EXPIRED = "Claude sign-in expired. Running any Claude agent refreshes it.";
const SESSION = { id: "session", label: "Session", shortLabel: "5h" };
const WEEKLY = { id: "weekly", label: "Weekly", shortLabel: "wk" };
const CLAUDE_RANK = { session: 0, weekly: 1 };

function providerResult(provider, now, status, windows = [], message) {
  return { provider, status, windows, updatedAt: new Date(now()).toISOString(), ...(message ? { message } : {}) };
}

function percentOrNull(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

// Never surface JSON.parse errors: V8 quotes the input, which here is a credential.
function parseOauth(raw) {
  try {
    const oauth = JSON.parse(raw)?.claudeAiOauth;
    return typeof oauth?.accessToken === "string" && oauth.accessToken ? oauth : null;
  } catch {
    return null;
  }
}

function readKeychain(execFileImpl, timeoutMs) {
  return new Promise((resolve) => {
    execFileImpl(
      "/usr/bin/security",
      ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE, "-w"],
      { encoding: "utf8", timeout: timeoutMs },
      (error, stdout) => resolve(error ? null : parseOauth(stdout)),
    );
  });
}

async function readClaudeCredentials({ platform, execFileImpl, readFile, home, timeoutMs }) {
  if (platform === "darwin") {
    const oauth = await readKeychain(execFileImpl, timeoutMs);
    if (oauth) return oauth;
  }
  try {
    return parseOauth(await readFile(path.join(home, ".claude", ".credentials.json"), "utf8"));
  } catch {
    return null;
  }
}

function claudeWindow(meta, percent, resetsAt) {
  const usedPercent = percentOrNull(percent);
  if (usedPercent === null) return null;
  return { ...meta, usedPercent, resetsAt: typeof resetsAt === "string" ? resetsAt : null };
}

function claudeWindows(body) {
  if (!Array.isArray(body?.limits)) {
    return [
      claudeWindow(SESSION, body?.five_hour?.utilization, body?.five_hour?.resets_at),
      claudeWindow(WEEKLY, body?.seven_day?.utilization, body?.seven_day?.resets_at),
    ].filter(Boolean);
  }
  return body.limits
    .map((limit) => {
      if (limit?.kind === "session") return claudeWindow(SESSION, limit.percent, limit.resets_at);
      if (limit?.kind === "weekly_all") return claudeWindow(WEEKLY, limit.percent, limit.resets_at);
      const model = limit?.kind === "weekly_scoped" ? limit.scope?.model?.display_name : null;
      if (typeof model !== "string" || !model) return null;
      return claudeWindow({ id: `weekly:${model.toLowerCase()}`, label: model, shortLabel: "wk" }, limit.percent, limit.resets_at);
    })
    .filter(Boolean)
    .sort((a, b) => (CLAUDE_RANK[a.id] ?? 2) - (CLAUDE_RANK[b.id] ?? 2));
}

async function readClaudeUsage(deps = {}) {
  const {
    platform = process.platform,
    execFileImpl = execFile,
    readFile = fs.readFile,
    home = os.homedir(),
    fetchImpl = globalThis.fetch,
    now = Date.now,
    timeoutMs = PROVIDER_TIMEOUT_MS,
  } = deps;
  const done = (status, windows, message) => providerResult("claude", now, status, windows, message);

  const oauth = await readClaudeCredentials({ platform, execFileImpl, readFile, home, timeoutMs });
  if (!oauth) return done("unavailable", [], "Not signed in to Claude Code.");
  if (typeof oauth.expiresAt === "number" && oauth.expiresAt <= now()) return done("error", [], CLAUDE_EXPIRED);

  let response;
  try {
    response = await fetchImpl(CLAUDE_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${oauth.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return done("error", [], error?.name === "TimeoutError" ? "Claude usage timed out." : "Couldn't reach Claude.");
  }
  if (response.status === 401) return done("error", [], CLAUDE_EXPIRED);
  if (response.status === 429) return done("error", [], "Claude is rate limiting usage checks. Try again in a minute.");
  if (!response.ok) return done("error", [], `Claude usage failed (HTTP ${response.status}).`);

  let body;
  try {
    body = await response.json();
  } catch {
    return done("error", [], "Claude returned an unreadable usage response.");
  }
  const windows = claudeWindows(body);
  return windows.length ? done("ok", windows) : done("error", [], "Claude returned no usage windows.");
}

module.exports = { readClaudeUsage };
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `node --test electron/usage.test.cjs`
Expected: PASS, 16 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add electron/usage.cjs electron/usage.test.cjs
git commit -m "feat: read Claude plan usage from the Claude Code sign-in"
```

---

### Task 2: Codex usage reader

**Files:**
- Modify: `electron/usage.cjs` (add the Codex reader, extend `module.exports`)
- Test: `electron/usage.test.cjs` (append)

**Interfaces:**
- Consumes (from Task 1, same file): `providerResult`, `percentOrNull`, `SESSION`, `WEEKLY`, `PROVIDER_TIMEOUT_MS`.
- Produces: `readCodexUsage(deps?) → Promise<ProviderUsage>`. It never rejects. `deps` is `{ spawnImpl?, now?, timeoutMs? }`.

- [ ] **Step 1: Write the failing tests**

In `electron/usage.test.cjs`, change the import line at the top to:

```js
const { EventEmitter } = require("node:events");
const { readClaudeUsage, readCodexUsage } = require("./usage.cjs");
```

Append to the end of the file:

```js
const RESETS_AT = 1791070247;
const WEEKLY_ONLY = { primary: { usedPercent: 88, windowDurationMins: 10080, resetsAt: RESETS_AT }, secondary: null };

function fakeCodex({ account = { type: "chatgpt", planType: "pro" }, rateLimits, chunked = false, reply = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdin = new EventEmitter();
  child.sent = [];
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  const emit = (message) => {
    const text = `${JSON.stringify(message)}\n`;
    if (!chunked) {
      setImmediate(() => child.stdout.emit("data", Buffer.from(text)));
      return;
    }
    const middle = Math.floor(text.length / 2);
    const notification = `${JSON.stringify({ method: "account/updated", params: { authMode: "chatgpt" } })}\n`;
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from(notification + text.slice(0, middle)));
      setImmediate(() => child.stdout.emit("data", Buffer.from(text.slice(middle))));
    });
  };
  child.stdin.write = (text) => {
    for (const line of String(text).split("\n").filter(Boolean)) {
      const message = JSON.parse(line);
      child.sent.push(message.method);
      if (!reply || message.id === undefined) continue;
      if (message.method === "initialize") emit({ id: message.id, result: { userAgent: "codex" } });
      if (message.method === "account/read") emit({ id: message.id, result: { account, requiresOpenaiAuth: true } });
      if (message.method === "account/rateLimits/read") emit({ id: message.id, result: { rateLimits } });
    }
    return true;
  };
  return child;
}

function codexDeps(child, overrides = {}) {
  const spawnCalls = [];
  const deps = {
    now: () => NOW,
    timeoutMs: 200,
    spawnImpl: (command, args) => {
      spawnCalls.push({ command, args });
      return child;
    },
    ...overrides,
  };
  return { deps, spawnCalls };
}

test("reads Codex usage from the app server and stops it", async () => {
  const child = fakeCodex({ rateLimits: WEEKLY_ONLY });
  const { deps, spawnCalls } = codexDeps(child);
  const result = await readCodexUsage(deps);
  assert.deepEqual(spawnCalls, [{ command: "codex", args: ["app-server"] }]);
  assert.deepEqual(child.sent, ["initialize", "initialized", "account/read", "account/rateLimits/read"]);
  assert.deepEqual(result, {
    provider: "codex",
    status: "ok",
    updatedAt: new Date(NOW).toISOString(),
    windows: [{ id: "weekly", label: "Weekly", shortLabel: "wk", usedPercent: 88, resetsAt: new Date(RESETS_AT * 1000).toISOString() }],
  });
  assert.equal(child.killed, true);
});

test("orders Codex windows shortest first and labels other durations", async () => {
  const both = fakeCodex({ rateLimits: {
    primary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: RESETS_AT },
    secondary: { usedPercent: 12, windowDurationMins: 300, resetsAt: null },
  } });
  const result = await readCodexUsage(codexDeps(both).deps);
  assert.deepEqual(result.windows.map((item) => [item.id, item.label, item.shortLabel]), [["session", "Session", "5h"], ["weekly", "Weekly", "wk"]]);

  const odd = fakeCodex({ rateLimits: {
    primary: { usedPercent: 5, windowDurationMins: 1440, resetsAt: null },
    secondary: { usedPercent: 6, windowDurationMins: 90, resetsAt: null },
  } });
  const oddResult = await readCodexUsage(codexDeps(odd).deps);
  assert.deepEqual(oddResult.windows.map((item) => [item.id, item.label, item.shortLabel]), [["window:90", "90m window", "90m"], ["window:1440", "1d window", "1d"]]);
});

test("parses replies split across chunks and mixed with notifications", async () => {
  const child = fakeCodex({ rateLimits: WEEKLY_ONLY, chunked: true });
  const result = await readCodexUsage(codexDeps(child).deps);
  assert.equal(result.status, "ok");
  assert.equal(result.windows[0].usedPercent, 88);
});

test("reports unavailable when Codex is not signed in", async () => {
  const child = fakeCodex({ account: null, rateLimits: WEEKLY_ONLY });
  const result = await readCodexUsage(codexDeps(child).deps);
  assert.deepEqual([result.status, result.message], ["unavailable", "Not signed in to Codex."]);
  assert.ok(!child.sent.includes("account/rateLimits/read"));
  assert.equal(child.killed, true);
});

test("reports unavailable when the Codex CLI is not installed", async () => {
  const child = fakeCodex({ reply: false });
  setImmediate(() => child.emit("error", Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })));
  const result = await readCodexUsage(codexDeps(child).deps);
  assert.deepEqual([result.status, result.message], ["unavailable", "Codex CLI not found."]);
});

test("times out, kills Codex and reports an error", async () => {
  const child = fakeCodex({ reply: false });
  const result = await readCodexUsage(codexDeps(child, { timeoutMs: 20 }).deps);
  assert.deepEqual([result.status, result.message], ["error", "Codex usage timed out."]);
  assert.equal(child.killed, true);
});

test("reports an error when Codex exits early or returns no windows", async () => {
  const exited = fakeCodex({ reply: false });
  setImmediate(() => exited.emit("close", 1, null));
  const early = await readCodexUsage(codexDeps(exited).deps);
  assert.deepEqual([early.status, early.message], ["error", "Codex exited before reporting usage."]);

  const empty = fakeCodex({ rateLimits: { primary: null, secondary: null } });
  const none = await readCodexUsage(codexDeps(empty).deps);
  assert.deepEqual([none.status, none.message], ["error", "Codex returned no usage windows."]);
});
```

- [ ] **Step 2: Run the tests to confirm the new ones fail**

Run: `node --test electron/usage.test.cjs`
Expected: the 16 Claude tests pass. The 7 new tests fail with `TypeError: readCodexUsage is not a function`.

- [ ] **Step 3: Implement the Codex reader**

In `electron/usage.cjs`, change the first line to:

```js
const { execFile, spawn } = require("node:child_process");
```

Add after `readClaudeUsage` (before `module.exports`):

```js
const APP_SERVER_CLIENT = { name: "milagre", title: "Milagre", version: "0.1.0" };

function codexWindowMeta(minutes) {
  if (minutes === 300) return SESSION;
  if (minutes === 10080) return WEEKLY;
  const short = minutes % 1440 === 0 ? `${minutes / 1440}d` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
  return { id: `window:${minutes}`, label: `${short} window`, shortLabel: short };
}

function codexWindows(rateLimits) {
  return [rateLimits?.primary, rateLimits?.secondary]
    .filter((item) => percentOrNull(item?.usedPercent) !== null && Number.isInteger(item.windowDurationMins) && item.windowDurationMins > 0)
    .sort((a, b) => a.windowDurationMins - b.windowDurationMins)
    .map((item) => ({
      ...codexWindowMeta(item.windowDurationMins),
      usedPercent: percentOrNull(item.usedPercent),
      resetsAt: typeof item.resetsAt === "number" ? new Date(item.resetsAt * 1000).toISOString() : null,
    }));
}

function readCodexUsage(deps = {}) {
  const { spawnImpl = spawn, now = Date.now, timeoutMs = PROVIDER_TIMEOUT_MS } = deps;
  const done = (status, windows, message) => providerResult("codex", now, status, windows, message);

  return new Promise((resolve) => {
    const child = spawnImpl("codex", ["app-server"], { stdio: ["pipe", "pipe", "ignore"], env: process.env, windowsHide: true });
    let settled = false;
    let buffer = "";
    const timer = setTimeout(() => finish(done("error", [], "Codex usage timed out.")), timeoutMs);

    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      resolve(value);
    }

    function send(message) {
      if (!settled) child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    function handle(message) {
      if (message.error && [1, 2, 3].includes(message.id)) return finish(done("error", [], "Codex couldn't read usage."));
      if (message.id === 1) {
        send({ method: "initialized" });
        send({ id: 2, method: "account/read", params: {} });
      } else if (message.id === 2) {
        if (!message.result?.account) return finish(done("unavailable", [], "Not signed in to Codex."));
        send({ id: 3, method: "account/rateLimits/read" });
      } else if (message.id === 3) {
        const windows = codexWindows(message.result?.rateLimits);
        finish(windows.length ? done("ok", windows) : done("error", [], "Codex returned no usage windows."));
      }
    }

    child.on("error", (error) => finish(error?.code === "ENOENT"
      ? done("unavailable", [], "Codex CLI not found.")
      : done("error", [], "Couldn't start Codex.")));
    child.on("close", () => finish(done("error", [], "Codex exited before reporting usage.")));
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        handle(message);
      }
    });

    send({ id: 1, method: "initialize", params: { clientInfo: APP_SERVER_CLIENT } });
  });
}
```

Change `module.exports` to:

```js
module.exports = { readClaudeUsage, readCodexUsage };
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `node --test electron/usage.test.cjs`
Expected: PASS, 23 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add electron/usage.cjs electron/usage.test.cjs
git commit -m "feat: read Codex plan usage from the local app server"
```

---

### Task 3: Usage IPC and shared types

**Files:**
- Modify: `electron/usage.cjs` (add `createUsageReader`)
- Modify: `electron/usage.test.cjs` (append)
- Modify: `electron/main.cjs` (require + handler)
- Modify: `electron/preload.cjs` (expose `readUsage`)
- Modify: `app/src/model.ts` (types)
- Modify: `app/src/electron.d.ts` (method type)

**Interfaces:**
- Consumes: `readClaudeUsage`, `readCodexUsage`, `providerResult` (Tasks 1–2).
- Produces:
  - `createUsageReader({ readClaude?, readCodex?, now? }) → readUsage(): Promise<UsageSnapshot>`, where `UsageSnapshot = { providers: [claude, codex] }`.
  - IPC channel `usage:read`.
  - `window.milagre.readUsage(): Promise<UsageSnapshot>`.
  - TS types `UsageWindow`, `ProviderUsage`, `UsageSnapshot`, exported from `app/src/model.ts`.

- [ ] **Step 1: Write the failing tests**

In `electron/usage.test.cjs`, change the import to:

```js
const { createUsageReader, readClaudeUsage, readCodexUsage } = require("./usage.cjs");
```

Append:

```js
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("shares one in-flight read between concurrent callers", async () => {
  let claudeReads = 0;
  let codexReads = 0;
  const claude = deferred();
  const updatedAt = new Date(NOW).toISOString();
  const readUsage = createUsageReader({
    now: () => NOW,
    readClaude: () => {
      claudeReads += 1;
      return claude.promise;
    },
    readCodex: async () => {
      codexReads += 1;
      return { provider: "codex", status: "unavailable", windows: [], updatedAt, message: "Codex CLI not found." };
    },
  });

  const first = readUsage();
  const second = readUsage();
  assert.equal(first, second);
  claude.resolve({ provider: "claude", status: "ok", windows: [], updatedAt });
  const snapshot = await first;
  assert.deepEqual(snapshot.providers.map((item) => item.provider), ["claude", "codex"]);
  assert.deepEqual([claudeReads, codexReads], [1, 1]);

  await readUsage();
  assert.deepEqual([claudeReads, codexReads], [2, 2]);
});

test("turns a reader crash into an error for that provider only", async () => {
  const updatedAt = new Date(NOW).toISOString();
  const readUsage = createUsageReader({
    now: () => NOW,
    readClaude: () => {
      throw new Error(`boom ${TOKEN}`);
    },
    readCodex: async () => ({ provider: "codex", status: "ok", windows: [], updatedAt }),
  });
  const { providers } = await readUsage();
  assert.deepEqual(providers[0], { provider: "claude", status: "error", windows: [], updatedAt, message: "Couldn't read usage." });
  assert.equal(providers[1].status, "ok");
  assert.ok(!JSON.stringify(providers).includes(TOKEN));
});
```

- [ ] **Step 2: Run the tests to confirm the new ones fail**

Run: `node --test electron/usage.test.cjs`
Expected: 23 pass. The 2 new tests fail with `TypeError: createUsageReader is not a function`.

- [ ] **Step 3: Implement `createUsageReader`**

In `electron/usage.cjs`, add before `module.exports`:

```js
function createUsageReader(deps = {}) {
  const { readClaude = readClaudeUsage, readCodex = readCodexUsage, now = Date.now } = deps;
  const safely = (provider, read) => Promise.resolve()
    .then(() => read())
    .catch(() => providerResult(provider, now, "error", [], "Couldn't read usage."));
  let inFlight = null;
  return function readUsage() {
    inFlight ??= Promise.all([safely("claude", readClaude), safely("codex", readCodex)])
      .then((providers) => ({ providers }))
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
```

Change `module.exports` to:

```js
module.exports = { createUsageReader, readClaudeUsage, readCodexUsage };
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm run test:agent`
Expected: PASS for every `electron/*.test.cjs` file, including 25 usage tests.

- [ ] **Step 5: Wire the IPC handler and preload**

In `electron/main.cjs`, add after `const { discoverSkills, expandSkillPrompt } = require("./skills.cjs");`:

```js
const { createUsageReader } = require("./usage.cjs");
```

Add after `let activeAgentProcess = null;`:

```js
const readUsage = createUsageReader();
```

Add after `ipcMain.handle("skills:list", (_event, projectPath) => discoverSkills(projectPath));`:

```js
ipcMain.handle("usage:read", () => readUsage());
```

In `electron/preload.cjs`, add after the `cancelAgent` line:

```js
  readUsage: () => ipcRenderer.invoke("usage:read"),
```

- [ ] **Step 6: Add the shared types**

In `app/src/model.ts`, append after the `SkillCatalog` interface:

```ts
export interface UsageWindow {
  id: string;
  label: string;
  shortLabel: string;
  usedPercent: number;
  resetsAt: string | null;
}

export interface ProviderUsage {
  provider: ModelProvider;
  status: "ok" | "unavailable" | "error";
  windows: UsageWindow[];
  updatedAt: string;
  message?: string;
}

export interface UsageSnapshot {
  providers: ProviderUsage[];
}
```

In `app/src/electron.d.ts`, change the import to:

```ts
import type { AgentRequest, CoordinatorState, OpenProject, SkillCatalog, UsageSnapshot } from "./model";
```

Add after `cancelAgent: () => Promise<boolean>;`:

```ts
      readUsage: () => Promise<UsageSnapshot>;
```

- [ ] **Step 7: Typecheck and smoke-test against the real sources**

Run: `npm run typecheck`
Expected: no output, exit 0.

Run: `node -e 'require("./electron/usage.cjs").createUsageReader()().then((s) => console.log(JSON.stringify(s, null, 2)))'`

Expected:
- Claude has `"status": "ok"` with Session, Weekly and one or more model rows (for example Fable).
- Codex has `"status": "ok"` with a Weekly row.
- No `sk-ant` string anywhere in the output.

- [ ] **Step 8: Commit**

```bash
git add electron/usage.cjs electron/usage.test.cjs electron/main.cjs electron/preload.cjs app/src/model.ts app/src/electron.d.ts
git commit -m "feat: expose plan usage to the renderer over IPC"
```

---

### Task 4: Renderer usage helpers and polling hook

**Files:**
- Create: `app/src/components/usage/format.ts`
- Create: `app/src/components/usage/format.test.ts`
- Create: `app/src/components/usage/useUsage.ts`
- Modify: `package.json` (add `test:ui`)
- Modify: `tsconfig.json` (exclude test files)

**Interfaces:**
- Consumes: `ProviderUsage`, `UsageSnapshot`, `ModelProvider` from `app/src/model.ts`, and `window.milagre.readUsage()` (Task 3).
- Produces:
  - `PROVIDER_NAMES: Record<ModelProvider, string>`
  - `usageTone(usedPercent: number): "normal" | "warning" | "critical"`
  - `formatPercent(usedPercent: number): string`
  - `formatResetsIn(resetsAt: string | null, now: number): string | null`
  - `formatUpdatedAgo(updatedAt: string, now: number): string`
  - `visibleProviders(snapshot: UsageSnapshot): ProviderUsage[]`
  - `usageLabel(usage: ProviderUsage): string`
  - `mergeSnapshot(previous: UsageSnapshot | null, next: UsageSnapshot): UsageSnapshot`
  - `useUsage(): UsageState`, where `UsageState = { snapshot: UsageSnapshot | null; loading: boolean; refresh: () => Promise<void>; refreshIfStale: (maxAgeMs: number) => void }`

- [ ] **Step 1: Write the failing tests**

Create `app/src/components/usage/format.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderUsage, UsageSnapshot } from "../../model";
import { formatResetsIn, formatUpdatedAgo, mergeSnapshot, usageLabel, usageTone, visibleProviders } from "./format.ts";

const NOW = Date.parse("2026-10-01T19:30:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function claude(overrides: Partial<ProviderUsage> = {}): ProviderUsage {
  return {
    provider: "claude",
    status: "ok",
    updatedAt: at(0),
    windows: [
      { id: "session", label: "Session", shortLabel: "5h", usedPercent: 73, resetsAt: at(77 * MINUTE) },
      { id: "weekly", label: "Weekly", shortLabel: "wk", usedPercent: 61, resetsAt: at(5 * DAY) },
      { id: "weekly:fable", label: "Fable", shortLabel: "wk", usedPercent: 66, resetsAt: at(5 * DAY) },
    ],
    ...overrides,
  };
}

test("formats reset countdowns and never shows a negative one", () => {
  assert.equal(formatResetsIn(null, NOW), null);
  assert.equal(formatResetsIn("not a date", NOW), null);
  assert.equal(formatResetsIn(at(-1_000), NOW), "Resetting…");
  assert.equal(formatResetsIn(at(0), NOW), "Resetting…");
  assert.equal(formatResetsIn(at(30_000), NOW), "Resets in 1m");
  assert.equal(formatResetsIn(at(45 * MINUTE), NOW), "Resets in 45m");
  assert.equal(formatResetsIn(at(77 * MINUTE), NOW), "Resets in 1h 17m");
  assert.equal(formatResetsIn(at(39 * HOUR + 59 * MINUTE), NOW), "Resets in 1d 15h");
  assert.equal(formatResetsIn(at(5 * DAY), NOW), "Resets in 5d 0h");
});

test("formats how long ago usage was read, tolerating clock skew", () => {
  assert.equal(formatUpdatedAgo(at(-10_000), NOW), "Updated just now");
  assert.equal(formatUpdatedAgo(at(MINUTE), NOW), "Updated just now");
  assert.equal(formatUpdatedAgo(at(-3 * MINUTE), NOW), "Updated 3m ago");
  assert.equal(formatUpdatedAgo(at(-2 * HOUR), NOW), "Updated 2h ago");
  assert.equal(formatUpdatedAgo(at(-3 * DAY), NOW), "Updated 3d ago");
});

test("picks a tone from the rounded percentage", () => {
  assert.equal(usageTone(79.4), "normal");
  assert.equal(usageTone(79.6), "warning");
  assert.equal(usageTone(94.4), "warning");
  assert.equal(usageTone(95), "critical");
  assert.equal(usageTone(100), "critical");
});

test("keeps the last good numbers when a refresh fails", () => {
  const previous: UsageSnapshot = { providers: [claude({ updatedAt: at(-6 * MINUTE) })] };
  const failed: UsageSnapshot = { providers: [claude({ status: "error", windows: [], message: "Claude is rate limiting usage checks. Try again in a minute." })] };

  const merged = mergeSnapshot(previous, failed);
  assert.deepEqual(merged.providers[0].windows, previous.providers[0].windows);
  assert.equal(merged.providers[0].updatedAt, at(-6 * MINUTE));
  assert.equal(merged.providers[0].status, "error");
  assert.equal(merged.providers[0].message, "Claude is rate limiting usage checks. Try again in a minute.");

  const failedAgain = mergeSnapshot(merged, failed);
  assert.deepEqual(failedAgain.providers[0].windows, previous.providers[0].windows);
  assert.equal(failedAgain.providers[0].updatedAt, at(-6 * MINUTE));

  const recovered = mergeSnapshot(failedAgain, { providers: [claude()] });
  assert.equal(recovered.providers[0].status, "ok");
  assert.equal(recovered.providers[0].message, undefined);
});

test("does not invent data for a first-time error or keep data for an unavailable provider", () => {
  const failed: UsageSnapshot = { providers: [claude({ status: "error", windows: [], message: "Couldn't reach Claude." })] };
  assert.deepEqual(mergeSnapshot(null, failed), failed);
  const gone: UsageSnapshot = { providers: [claude({ status: "unavailable", windows: [], message: "Not signed in to Claude Code." })] };
  assert.deepEqual(mergeSnapshot({ providers: [claude()] }, gone), gone);
});

test("hides unavailable providers and labels segments for screen readers", () => {
  const codexMissing: ProviderUsage = { provider: "codex", status: "unavailable", windows: [], updatedAt: at(0), message: "Codex CLI not found." };
  assert.deepEqual(visibleProviders({ providers: [claude(), codexMissing] }).map((item) => item.provider), ["claude"]);
  assert.equal(usageLabel(claude()), "Claude usage: Session 73% used, Weekly 61% used");
  assert.equal(usageLabel(claude({ status: "error", windows: [] })), "Claude usage unavailable");
});
```

In `package.json`, add after the `"test:agent"` line:

```json
    "test:ui": "node --test \"app/src/**/*.test.ts\"",
```

In `tsconfig.json`, add after `"include": ["app/src"]` (put a comma after `["app/src"]`):

```json
  "exclude": ["app/src/**/*.test.ts"]
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm run test:ui`
Expected: FAIL with `Cannot find module '…/app/src/components/usage/format.ts'`.

- [ ] **Step 3: Implement the helpers**

Create `app/src/components/usage/format.ts`:

```ts
import type { ModelProvider, ProviderUsage, UsageSnapshot } from "../../model";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const PROVIDER_NAMES: Record<ModelProvider, string> = { claude: "Claude", codex: "Codex" };

export type UsageTone = "normal" | "warning" | "critical";

export function usageTone(usedPercent: number): UsageTone {
  const rounded = Math.round(usedPercent);
  if (rounded >= 95) return "critical";
  if (rounded >= 80) return "warning";
  return "normal";
}

export function formatPercent(usedPercent: number) {
  return `${Math.round(usedPercent)}%`;
}

export function formatResetsIn(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null;
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) return null;
  const remaining = target - now;
  if (remaining <= 0) return "Resetting…";
  if (remaining < HOUR) return `Resets in ${Math.max(1, Math.ceil(remaining / MINUTE))}m`;
  if (remaining < DAY) return `Resets in ${Math.floor(remaining / HOUR)}h ${Math.floor((remaining % HOUR) / MINUTE)}m`;
  return `Resets in ${Math.floor(remaining / DAY)}d ${Math.floor((remaining % DAY) / HOUR)}h`;
}

export function formatUpdatedAgo(updatedAt: string, now: number): string {
  const elapsed = now - Date.parse(updatedAt);
  // NaN and negative (clock skew) both land here.
  if (!(elapsed >= MINUTE)) return "Updated just now";
  if (elapsed < HOUR) return `Updated ${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `Updated ${Math.floor(elapsed / HOUR)}h ago`;
  return `Updated ${Math.floor(elapsed / DAY)}d ago`;
}

export function visibleProviders(snapshot: UsageSnapshot) {
  return snapshot.providers.filter((item) => item.status !== "unavailable");
}

export function usageLabel(usage: ProviderUsage) {
  const name = PROVIDER_NAMES[usage.provider];
  if (usage.windows.length === 0) return `${name} usage unavailable`;
  const windows = usage.windows.slice(0, 2).map((item) => `${item.label} ${formatPercent(item.usedPercent)} used`);
  return `${name} usage: ${windows.join(", ")}`;
}

// A failed refresh keeps the last good windows and their timestamp, so the card
// stays useful and "Updated Xm ago" stays truthful while showing the error.
export function mergeSnapshot(previous: UsageSnapshot | null, next: UsageSnapshot): UsageSnapshot {
  return {
    providers: next.providers.map((current) => {
      if (current.status !== "error") return current;
      const before = previous?.providers.find((item) => item.provider === current.provider);
      if (!before || before.windows.length === 0) return current;
      return { ...current, windows: before.windows, updatedAt: before.updatedAt };
    }),
  };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm run test:ui`
Expected: PASS, 6 tests, 0 failures.

- [ ] **Step 5: Add the polling hook**

Create `app/src/components/usage/useUsage.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { UsageSnapshot } from "../../model";
import { mergeSnapshot } from "./format";

const POLL_MS = 5 * 60_000;

export function useUsage() {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const lastReadAt = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    setLoading(true);
    inFlight.current = window.milagre.readUsage()
      .then((next) => {
        lastReadAt.current = Date.now();
        setSnapshot((previous) => mergeSnapshot(previous, next));
      })
      .catch(() => {})
      .finally(() => {
        inFlight.current = null;
        setLoading(false);
      });
    return inFlight.current;
  }, []);

  const refreshIfStale = useCallback((maxAgeMs: number) => {
    if (Date.now() - lastReadAt.current > maxAgeMs) void refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { snapshot, loading, refresh, refreshIfStale };
}

export type UsageState = ReturnType<typeof useUsage>;
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0. The test file is excluded, so its `.ts` import extension is not checked by `tsc`.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/usage/format.ts app/src/components/usage/format.test.ts app/src/components/usage/useUsage.ts package.json tsconfig.json
git commit -m "feat: usage formatting helpers and polling hook"
```

---

### Task 5: Status bar, details card, and live check

**Files:**
- Create: `app/src/components/usage/ProviderMark.tsx`
- Create: `app/src/components/usage/UsageBar.tsx`
- Create: `app/src/components/usage/UsageCard.tsx`
- Create: `app/src/components/usage/UsageStatusBar.tsx`
- Modify: `app/src/App.tsx`

**Interfaces:**
- Consumes: `UsageState` / `useUsage` (Task 4), the `format.ts` helpers (Task 4), and the `ProviderUsage` / `ModelProvider` types.
- Produces:
  - `<UsageStatusBar usage={UsageState} />`
  - `<UsageCard … />`
  - `<UsageBar usedPercent className />`
  - `<ProviderMark provider size? />`
  - `USAGE_CARD_WIDTH = 288`

- [ ] **Step 1: Provider mark and bar**

Create `app/src/components/usage/ProviderMark.tsx`:

```tsx
import { HugeiconsIcon } from "@hugeicons/react";
import { ChatGptIcon, ClaudeIcon } from "@hugeicons/core-free-icons";
import type { ModelProvider } from "../../model";

const MARKS = { claude: ClaudeIcon, codex: ChatGptIcon } as const;

export function ProviderMark({ provider, size = 12 }: { provider: ModelProvider; size?: number }) {
  return <HugeiconsIcon icon={MARKS[provider]} size={size} strokeWidth={1.8} color="currentColor" />;
}
```

Create `app/src/components/usage/UsageBar.tsx`:

```tsx
import { usageTone } from "./format";

const FILL = { normal: "bg-ink-2", warning: "bg-orange", critical: "bg-red" } as const;

export function UsageBar({ usedPercent, className }: { usedPercent: number; className: string }) {
  return (
    <span aria-hidden className={`relative block shrink-0 overflow-hidden rounded-full bg-line-strong ${className}`}>
      <span
        className={`absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-300 ease-out motion-reduce:transition-none ${FILL[usageTone(usedPercent)]}`}
        style={{ width: `${usedPercent}%` }}
      />
    </span>
  );
}
```

- [ ] **Step 2: Details card**

Create `app/src/components/usage/UsageCard.tsx`:

```tsx
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import type { ProviderUsage } from "../../model";
import { PROVIDER_NAMES, formatPercent, formatResetsIn, formatUpdatedAgo } from "./format";
import { ProviderMark } from "./ProviderMark";
import { UsageBar } from "./UsageBar";

export const USAGE_CARD_WIDTH = 288;

type UsageCardProps = {
  id: string;
  usage: ProviderUsage;
  loading: boolean;
  position: { left: number; bottom: number };
  onRefresh: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
};

export function UsageCard({ id, usage, loading, position, onRefresh, onPointerEnter, onPointerLeave }: UsageCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const name = PROVIDER_NAMES[usage.provider];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setNow(Date.now());
  }, [usage.updatedAt]);

  return createPortal(
    <div
      id={id}
      role="dialog"
      aria-label={`${name} usage`}
      data-usage-card
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="fixed z-50 rounded-[14px] bg-surface text-ink shadow-overlay"
      style={{
        width: USAGE_CARD_WIDTH,
        left: position.left,
        bottom: position.bottom,
        animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
        transformOrigin: "bottom right",
      }}
    >
      <div className="flex items-start gap-2 px-4 pb-3 pt-3.5">
        <span className="mt-0.5 flex text-ink"><ProviderMark provider={usage.provider} size={16} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-5">{name}</p>
          <p className="text-[12px] text-ink-3">{formatUpdatedAgo(usage.updatedAt, now)}</p>
        </div>
        <button
          type="button"
          aria-label={`Refresh ${name} usage`}
          onClick={onRefresh}
          disabled={loading}
          className="flex size-7 items-center justify-center rounded-control text-ink-3 transition-[background-color,color] duration-150 hover:bg-hover-2 hover:text-ink disabled:cursor-default"
        >
          <span className="flex" style={loading ? { animation: "spin 800ms linear infinite" } : undefined}>
            <HugeiconsIcon icon={RefreshIcon} size={15} strokeWidth={1.8} color="currentColor" />
          </span>
        </button>
      </div>

      {usage.message && (
        <p className="mx-4 mb-3 rounded-control bg-orange-tint px-2.5 py-1.5 text-[12px] leading-[1.45] text-ink">{usage.message}</p>
      )}

      {usage.windows.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-line px-4 pb-4 pt-3">
          {usage.windows.map((item) => (
            <div key={item.id} className="flex flex-col gap-1.5">
              <p className="text-[13px] font-medium">{item.label}</p>
              <UsageBar usedPercent={item.usedPercent} className="h-1.5 w-full" />
              <div className="flex items-center justify-between text-[12px] tabular-nums text-ink-2">
                <span>{formatPercent(item.usedPercent)} used</span>
                <span>{formatResetsIn(item.resetsAt, now)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 3: Status bar**

Create `app/src/components/usage/UsageStatusBar.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { ModelProvider } from "../../model";
import { formatPercent, usageLabel, visibleProviders } from "./format";
import { ProviderMark } from "./ProviderMark";
import { UsageBar } from "./UsageBar";
import { USAGE_CARD_WIDTH, UsageCard } from "./UsageCard";
import type { UsageState } from "./useUsage";

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 150;
const CARD_GAP = 8;
const VIEWPORT_MARGIN = 12;
const STALE_AFTER_MS = 60_000;

type OpenCard = { provider: ModelProvider; left: number; bottom: number };

export function UsageStatusBar({ usage }: { usage: UsageState }) {
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const segments = useRef(new Map<ModelProvider, HTMLButtonElement>());
  const providers = usage.snapshot ? visibleProviders(usage.snapshot) : [];
  const openUsage = openCard ? providers.find((item) => item.provider === openCard.provider) : undefined;

  function clearTimers() {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }

  function show(provider: ModelProvider) {
    clearTimers();
    const rect = segments.current.get(provider)?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.right - USAGE_CARD_WIDTH, window.innerWidth - USAGE_CARD_WIDTH - VIEWPORT_MARGIN));
    setOpenCard({ provider, left, bottom: window.innerHeight - rect.top + CARD_GAP });
    usage.refreshIfStale(STALE_AFTER_MS);
  }

  function scheduleShow(provider: ModelProvider) {
    clearTimers();
    openTimer.current = window.setTimeout(() => show(provider), OPEN_DELAY_MS);
  }

  function scheduleHide() {
    clearTimers();
    closeTimer.current = window.setTimeout(() => setOpenCard(null), CLOSE_DELAY_MS);
  }

  function keepOpen() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  useEffect(() => clearTimers, []);

  useEffect(() => {
    if (!openCard) return;
    const close = () => setOpenCard(null);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [openCard]);

  if (providers.length === 0) return null;

  return (
    <div className="flex h-7 shrink-0 items-center justify-end gap-1 px-2 text-[12px] tabular-nums text-ink-2">
      {providers.map((item) => {
        const expanded = openCard?.provider === item.provider && Boolean(openUsage);
        return (
          <button
            key={item.provider}
            ref={(node) => {
              if (node) segments.current.set(item.provider, node);
              else segments.current.delete(item.provider);
            }}
            type="button"
            aria-label={usageLabel(item)}
            aria-expanded={expanded}
            aria-controls={expanded ? `usage-card-${item.provider}` : undefined}
            onPointerEnter={() => scheduleShow(item.provider)}
            onPointerLeave={scheduleHide}
            onFocus={(event) => {
              if (event.currentTarget.matches(":focus-visible")) show(item.provider);
            }}
            onBlur={(event) => {
              if (!(event.relatedTarget as Element | null)?.closest("[data-usage-card]")) scheduleHide();
            }}
            onClick={() => show(item.provider)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !openCard) return;
              // Stop here: App listens for Escape on window to cancel the running agent.
              event.preventDefault();
              event.stopPropagation();
              clearTimers();
              setOpenCard(null);
            }}
            className={`flex h-6 items-center gap-1.5 rounded-control px-1.5 transition-[background-color,color] duration-150 hover:bg-hover-2 hover:text-ink ${expanded ? "bg-hover-2 text-ink" : ""}`}
          >
            <ProviderMark provider={item.provider} />
            {item.windows.length === 0 ? (
              <span className="text-ink-3">—</span>
            ) : (
              item.windows.slice(0, 2).map((entry) => (
                <span key={entry.id} className="flex items-center gap-1">
                  <UsageBar usedPercent={entry.usedPercent} className="h-1 w-9" />
                  <span>{formatPercent(entry.usedPercent)}</span>
                  <span className="text-ink-3">{entry.shortLabel}</span>
                </span>
              ))
            )}
          </button>
        );
      })}

      {openCard && openUsage && (
        <UsageCard
          id={`usage-card-${openUsage.provider}`}
          usage={openUsage}
          loading={usage.loading}
          position={{ left: openCard.left, bottom: openCard.bottom }}
          onRefresh={() => void usage.refresh()}
          onPointerEnter={keepOpen}
          onPointerLeave={scheduleHide}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Mount it in App**

In `app/src/App.tsx`, add after `import type { ToolApprovalStatus } from "./components/agents/tool-approval";`:

```tsx
import { UsageStatusBar } from "./components/usage/UsageStatusBar";
import { useUsage } from "./components/usage/useUsage";
```

Add after `const approvalTimerRef = useRef<number | null>(null);`:

```tsx
  const usage = useUsage();
```

In `executeSend`, change the `finally` block to:

```tsx
    } finally {
      setIsSending(false);
      void usage.refresh();
    }
```

In the JSX, add the bar right after the chat wrapper `</div>` and before `</main>`:

```tsx
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatComposer
            …unchanged…
          />
        </div>
        <UsageStatusBar usage={usage} />
      </main>
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run build`
Expected: `tsc --noEmit` passes, then `vite build` prints `✓ built in …` with no errors.

- [ ] **Step 6: Launch the app with a debugging port**

Run each in the background, from the worktree root:

```bash
npx vite --host 127.0.0.1 --port 5180
```

```bash
MILAGRE_DEV_SERVER_URL=http://127.0.0.1:5180 npx electron . --remote-debugging-port=9222
```

Then read the `argent-device-interact` skill. Call argent `list-devices` and expect a `platform: "chromium"` device `chromium-cdp-9222`. Take a `screenshot`.

Expected:
- A row at the bottom right under the composer: Claude mark, two mini bars with `NN% 5h` and `NN% wk`, then the ChatGPT mark with `88% wk` (or the current value).
- The numbers match the Task 3 Step 7 smoke output.

- [ ] **Step 7: Check hover open and close**

argent has no hover tool, so create a throwaway CDP helper at `/tmp/milagre-hover.mjs` (not committed):

```js
// Usage: node /tmp/milagre-hover.mjs '<css selector>'   (or "away" to move the pointer to the corner)
const [target] = process.argv.slice(2);
const pages = await (await fetch("http://127.0.0.1:9222/json")).json();
const socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let nextId = 0;
const call = (method, params) => new Promise((resolve) => {
  const id = ++nextId;
  socket.addEventListener("message", function onMessage(event) {
    const message = JSON.parse(event.data);
    if (message.id !== id) return;
    socket.removeEventListener("message", onMessage);
    resolve(message.result);
  });
  socket.send(JSON.stringify({ id, method, params }));
});
let point = [4, 4];
if (target !== "away") {
  const { result } = await call("Runtime.evaluate", {
    expression: `(() => { const r = document.querySelector(${JSON.stringify(target)})?.getBoundingClientRect(); return r ? [r.x + r.width / 2, r.y + r.height / 2] : null; })()`,
    returnByValue: true,
  });
  if (!result.value) throw new Error(`No element for ${target}`);
  point = result.value;
}
await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point[0], y: point[1] });
socket.close();
```

Run: `node /tmp/milagre-hover.mjs 'button[aria-label^="Claude usage"]'`, then argent `screenshot`.

Expected: the card sits above the Claude segment and shows:
- "Claude" and "Updated just now"
- Session, Weekly and Fable rows, each with a bar, "NN% used" and "Resets in …"

Run: `node /tmp/milagre-hover.mjs 'button[aria-label^="Codex usage"]'`, then `screenshot`.
Expected: the Codex card replaces it, with one Weekly row.

Run: `node /tmp/milagre-hover.mjs away`, then argent `describe`.
Expected: no `dialog` named "… usage" in the tree.

- [ ] **Step 8: Check keyboard focus and click**

With argent:
- `gesture-tap` the composer text field, then use `keyboard` to press Tab until `describe` shows the Claude segment focused.
- Expected: the Claude card is open (`aria-expanded` true, the dialog is in the tree) without any hover.
- Press Escape with `keyboard`. Expected: the card closes and focus stays on the segment.
- `gesture-tap` the Codex segment. Expected: the Codex card opens.

- [ ] **Step 9: Check that Escape on the card doesn't cancel a running agent (Review Focus 5)**

1. Type `Reply with just: ok` in the composer and press Enter.
2. While "Working with …" is showing, `gesture-tap` the Claude segment, then press Escape with `keyboard`.

Expected:
- The card closes, and "Working with …" is still on screen.
- The agent reply arrives (not "Agent run cancelled.").
- Within a couple of seconds after the reply, the card shows "Updated just now" again: hover it with the helper.

- [ ] **Step 10: Check dark theme**

`gesture-tap` "Dark theme" in the sidebar footer. Hover the Claude segment with the helper and take a `screenshot`.

Expected:
- The bar and card read clearly on the dark surface.
- The card has its light hairline ring.
- Any window at 80% or more has an orange fill; any at 95% or more has a red fill.

Switch back to the light theme afterwards.

- [ ] **Step 11: Stop the app**

1. Stop the Electron and Vite background processes.
2. Call argent `stop-all-simulator-servers` with `devices: ["chromium-cdp-9222"]`.
3. Delete `/tmp/milagre-hover.mjs`.

- [ ] **Step 12: Commit**

```bash
git add app/src/components/usage/ProviderMark.tsx app/src/components/usage/UsageBar.tsx app/src/components/usage/UsageCard.tsx app/src/components/usage/UsageStatusBar.tsx app/src/App.tsx
git commit -m "feat: usage status bar with per-provider details card"
```

---

### Task 6: Final verification

**Files:** none changed unless a check fails.

**Interfaces:** none.

- [ ] **Step 1: Run every check from a clean state**

```bash
npm run test:agent
npm run test:ui
npm run build
git status --short
```

Expected:
- `test:agent`: all `electron/*.test.cjs` pass, including 25 usage tests.
- `test:ui`: 6 pass.
- `build`: succeeds.
- `git status --short`: prints nothing (`.milagre/` and `dist/` are gitignored).

- [ ] **Step 2: Confirm the token cannot leak through the codebase**

Run: `grep -n "accessToken" -r electron app/src`

Expected: matches only in `electron/usage.cjs` (credential parsing and the `Authorization` header) and `electron/usage.test.cjs`. Nothing in `main.cjs`, `preload.cjs` or `app/src`.
