# Agent Sessions PR 1: Sessions and Streaming Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Milagre's one-shot `claude --print` and `codex exec` calls with one long-lived agent session per chat. Replies stream in, chats keep their memory across turns and restarts, turns have no timeout, Cancel interrupts cleanly, and several chats can run at once.

**Architecture:** A session manager in the Electron main process owns one provider session per chat:

- **Claude** runs through the Claude Agent SDK `query()` with streaming input.
- **Codex** runs through a small JSON-RPC client for `codex app-server`.

Providers emit one normalised event stream, which the main process batches and forwards to the renderer on `agent:event`. The renderer accumulates streamed text per chat and saves the finished turn.

**Tech Stack:** Electron main process in CommonJS (`.cjs`), `@anthropic-ai/claude-agent-sdk@0.3.286` (ESM, loaded with dynamic `import()`), `codex app-server` (codex-cli 0.158.0), React 19 + TypeScript renderer, `node --test`.

**Spec:** `docs/specs/002-agent-sessions.md`. This plan covers delivery step 1 ("Sessions and streaming text"). Steps 2–4 (approvals, tool steps, models and environment) get their own plans once this lands.

## Global Constraints

- The Electron main process stays CommonJS (`electron/**/*.cjs`). The SDK is ESM-only and is loaded with `import("@anthropic-ai/claude-agent-sdk")`.
- `@anthropic-ai/claude-agent-sdk` is pinned to exactly `0.3.286`, with no caret. Its minor matches Claude Code CLI `2.1.x`.
- Codex is driven through `codex app-server` (verified against codex-cli 0.158.0). `initialize` sends `clientInfo.name = "milagre"`.
- Turns have no timeout. Only control calls are bounded:
  - `turn/start` acknowledgement: 90 s
  - `thread/start` and `thread/resume`: 60 s
  - other requests: 30 s
  - interrupt: falls back to a tree-kill after 3 s
- Text deltas are batched in main into 50 ms windows. Idle sessions close after 10 minutes.
- Ask keeps the renderer's existing pre-run check in this PR. No agent may wait on an approval:
  - Codex runs with `approvalPolicy: "never"`, and any approval request is declined.
  - Claude runs without `canUseTool`, in `acceptEdits` (Ask and Auto) or `bypassPermissions` (Full).
- `coordination.json` changes are additive only. Older files must load unchanged.
- User-facing error strings are defined once in `electron/agents/events.cjs` and reused.
- Agent tests live next to the code (`electron/agents/*.test.cjs`). Renderer logic tests are `app/src/lib/*.test.ts`, run by Node's type stripping. `npm run test:agent` runs all of them, and so does CI.

## Review Focus

1. **The saved session can no longer be resumed.** This happens when the Claude transcript or the Codex thread was deleted. Expected: a clear message and a `session-reset` that forgets the id, so the next message starts a fresh session instead of failing forever. Pinned in Task 3 (Codex), Task 4 (Claude) and Task 6 (renderer).
2. **Switching between a Codex chat and a Claude chat.** Expected: the model picker follows the open chat's provider, and a Claude chat is never sent a Codex model. Pinned in Task 6 (`modelForChat`).
3. **The CLI is missing or not on PATH.** Expected: an immediate, readable failure with nothing hanging. Pinned in Task 1 (RPC spawn error), Task 3 and Task 4 (null command), and Task 7 (`resolveExecutable`).
4. **Two chats streaming at once.** Expected: events never cross chats and both replies are saved. Pinned in Task 5 (manager) and Task 6 (renderer fold).
5. **Cancel before the agent has started the turn.** Expected: no stuck "working" state, and the turn ends as cancelled. Pinned in Task 3 (cancel before `turn/start`) and Task 4 (unresponsive interrupt).

---

### Task 1: Process tree-kill and Codex JSON-RPC client

**Files:**
- Create: `electron/agents/process-tree.cjs`
- Create: `electron/agents/codex-rpc.cjs`
- Create: `electron/agents/test-helpers.cjs`
- Create: `electron/agents/fixtures/fake-app-server.cjs`
- Test: `electron/agents/process-tree.test.cjs`, `electron/agents/codex-rpc.test.cjs`
- Modify: `package.json` (`test:agent` script)

**Interfaces:**
- Produces:
  - `killTree(child, { graceMs = 2000 } = {}): Promise<void>`
  - `class CodexRpc extends EventEmitter`
    - constructor: `({ command, args = ["app-server"], cwd, env = process.env, spawnImpl = spawn })`
    - methods: `start()`, `request(method, params = {}, { timeoutMs = 30000 } = {}): Promise<object>`, `notify(method, params?)`, `respond(id, result)`, `respondError(id, message)`, `close(): Promise<void>`
    - events: `"notification" { method, params }`, `"request" { id, method, params }`, `"exit" { code, signal, detail }`
  - `waitUntil(check, { timeoutMs = 3000 } = {}): Promise<void>` (test helper)
  - the fake app-server, used by Tasks 1 and 3

- [ ] **Step 1: Add the test helper and the fake app-server**

`electron/agents/test-helpers.cjs`:

```js
async function waitUntil(check, { timeoutMs = 3000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

module.exports = { waitUntil };
```

`electron/agents/fixtures/fake-app-server.cjs`:

```js
// Stand-in for `codex app-server` in tests. It speaks the JSON-RPC subset Milagre uses.
// FAKE_SCENARIO picks how a turn behaves: reply (default), fail, slow, crash, approval.
const fs = require("node:fs");
const { createInterface } = require("node:readline");

const scenario = process.env.FAKE_SCENARIO || "reply";
const received = [];
let threadStarts = 0;
let pendingTurn = null;

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const notify = (method, params) => send({ method, params });
const completeTurn = (threadId, turnId, status, error = null) => notify("turn/completed", { threadId, turn: { id: turnId, items: [], status, error } });

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  received.push(message);
  const { id, method, params = {} } = message;
  if (method === undefined) {
    if (pendingTurn && pendingTurn.approvalId === id) {
      notify("item/agentMessage/delta", { threadId: pendingTurn.threadId, turnId: pendingTurn.turnId, itemId: "msg-1", delta: `decision:${message.result && message.result.decision}` });
      completeTurn(pendingTurn.threadId, pendingTurn.turnId, "completed");
      pendingTurn = null;
    }
    return;
  }
  switch (method) {
    case "initialize":
      return send({ id, result: { userAgent: "fake/0.158.0" } });
    case "initialized":
      return undefined;
    case "fake/received":
      return send({ id, result: { received, threadStarts } });
    case "thread/start":
      threadStarts += 1;
      return send({ id, result: { thread: { id: `thread-${threadStarts}` }, model: params.model } });
    case "thread/resume":
      if (params.threadId === "missing") return send({ id, error: { code: -32600, message: "no rollout found for thread id missing" } });
      return send({ id, result: { thread: { id: params.threadId }, model: params.model } });
    case "thread/unarchive":
      return send({ id, error: { code: -32600, message: "thread is not archived" } });
    case "turn/start": {
      const { threadId } = params;
      const turnId = `turn-${received.filter((item) => item.method === "turn/start").length}`;
      message.imagesExist = (params.input || []).filter((input) => input.type === "localImage").map((input) => fs.existsSync(input.path));
      send({ id, result: { turn: { id: turnId, items: [], status: "inProgress", error: null } } });
      notify("turn/started", { threadId, turn: { id: turnId, status: "inProgress" } });
      notify("mcpServer/startupStatus/updated", { name: "noise", status: "ready" });
      if (scenario === "crash") {
        process.stderr.write("boom: model unavailable\n");
        process.exit(3);
      }
      if (scenario === "slow") {
        pendingTurn = { threadId, turnId };
        return undefined;
      }
      if (scenario === "approval") {
        pendingTurn = { threadId, turnId, approvalId: "srv-1" };
        return send({ id: "srv-1", method: "item/commandExecution/requestApproval", params: { threadId, turnId, itemId: "cmd-1", command: "rm -rf build" } });
      }
      notify("item/agentMessage/delta", { threadId, turnId, itemId: "msg-1", delta: "Hel" });
      notify("item/agentMessage/delta", { threadId, turnId, itemId: "msg-1", delta: "lo" });
      if (scenario === "fail") return completeTurn(threadId, turnId, "failed", { message: "The model gpt-x is not supported." });
      return completeTurn(threadId, turnId, "completed");
    }
    case "turn/interrupt":
      send({ id, result: {} });
      if (pendingTurn) {
        completeTurn(pendingTurn.threadId, pendingTurn.turnId, "interrupted");
        pendingTurn = null;
      }
      return undefined;
    default:
      return send({ id, error: { code: -32601, message: `unknown method ${method}` } });
  }
});
```

- [ ] **Step 2: Write the failing tests**

`electron/agents/process-tree.test.cjs`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { spawn } = require("node:child_process");
const { killTree } = require("./process-tree.cjs");
const { waitUntil } = require("./test-helpers.cjs");

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("killTree stops a detached child and the processes it started", async () => {
  const script = 'const { spawn } = require("node:child_process"); const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log(grandchild.pid); setInterval(() => {}, 1000);';
  const child = spawn(process.execPath, ["-e", script], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  const grandchildPid = Number(await new Promise((resolve) => child.stdout.once("data", (data) => resolve(String(data).trim()))));
  assert.ok(isAlive(grandchildPid));

  await killTree(child, { graceMs: 500 });

  assert.ok(child.exitCode !== null || child.signalCode !== null);
  await waitUntil(() => !isAlive(grandchildPid));
});

test("killTree resolves for a process that already exited", async () => {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => child.once("exit", resolve));
  await killTree(child);
  await killTree(null);
});
```

`electron/agents/codex-rpc.test.cjs`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { CodexRpc } = require("./codex-rpc.cjs");
const { waitUntil } = require("./test-helpers.cjs");

const FAKE = path.join(__dirname, "fixtures", "fake-app-server.cjs");

function client(t, scenario = "reply", command = process.execPath) {
  const rpc = new CodexRpc({ command, args: [FAKE], env: { ...process.env, FAKE_SCENARIO: scenario } });
  rpc.start();
  t.after(() => rpc.close());
  return rpc;
}

test("matches responses to requests and emits notifications in order", async (t) => {
  const rpc = client(t);
  const methods = [];
  rpc.on("notification", ({ method }) => methods.push(method));

  assert.deepEqual(await rpc.request("initialize", {}), { userAgent: "fake/0.158.0" });
  const { thread } = await rpc.request("thread/start", { model: "gpt-6-sol" });
  const { turn } = await rpc.request("turn/start", { threadId: thread.id, input: [] });

  assert.equal(turn.id, "turn-1");
  await waitUntil(() => methods.includes("turn/completed"));
  assert.deepEqual(methods, ["turn/started", "mcpServer/startupStatus/updated", "item/agentMessage/delta", "item/agentMessage/delta", "turn/completed"]);
});

test("rejects with the server's error message", async (t) => {
  const rpc = client(t);
  await assert.rejects(rpc.request("thread/nope"), /unknown method thread\/nope/);
});

test("delivers server requests and sends the reply back", async (t) => {
  const rpc = client(t, "approval");
  const deltas = [];
  rpc.on("request", ({ id, method }) => {
    assert.equal(method, "item/commandExecution/requestApproval");
    rpc.respond(id, { decision: "decline" });
  });
  rpc.on("notification", ({ method, params }) => {
    if (method === "item/agentMessage/delta") deltas.push(params.delta);
  });

  const { thread } = await rpc.request("thread/start", {});
  await rpc.request("turn/start", { threadId: thread.id, input: [] });

  await waitUntil(() => deltas.length > 0);
  assert.deepEqual(deltas, ["decision:decline"]);
});

test("reports Codex's stderr when the process exits and rejects later requests", async (t) => {
  const rpc = client(t, "crash");
  const exits = [];
  rpc.on("exit", (exit) => exits.push(exit));

  const { thread } = await rpc.request("thread/start", {});
  await rpc.request("turn/start", { threadId: thread.id, input: [] });

  await waitUntil(() => exits.length === 1);
  assert.match(exits[0].detail, /boom: model unavailable/);
  await assert.rejects(rpc.request("initialize", {}), /not running/);
});

test("explains a CLI that can't be started", async (t) => {
  const rpc = client(t, "reply", "milagre-definitely-missing-cli");
  const exits = [];
  rpc.on("exit", (exit) => exits.push(exit));

  await assert.rejects(rpc.request("initialize", {}), /isn't installed or isn't on your PATH/);
  assert.match(exits[0].detail, /milagre-definitely-missing-cli isn't installed or isn't on your PATH/);
});
```

- [ ] **Step 3: Add the new test folder to the test script and run it to see it fail**

In `package.json`, change the `test:agent` script to:

```json
"test:agent": "node --test electron/*.test.cjs electron/agents/*.test.cjs",
```

Run: `npm run test:agent`
Expected: FAIL, with `Cannot find module './process-tree.cjs'` and `Cannot find module './codex-rpc.cjs'`.

- [ ] **Step 4: Implement `process-tree.cjs`**

```js
// Stops a child process and everything it started. Agents start shells and MCP servers;
// signalling the whole process group keeps them from outliving the session. Children
// spawned with `detached: true` lead their own group; others fall back to a plain kill.
function killTree(child, { graceMs = 2000 } = {}) {
  if (!child?.pid || child.exitCode !== null || child.signalCode != null) return Promise.resolve();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms, "timeout"));
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
    } catch {
      try {
        child.kill(name);
      } catch {
        // Already gone.
      }
    }
  };
  signal("SIGTERM");
  return Promise.race([exited, wait(graceMs)]).then((result) => {
    if (result !== "timeout") return undefined;
    signal("SIGKILL");
    return Promise.race([exited, wait(graceMs)]).then(() => undefined);
  });
}

module.exports = { killTree };
```

- [ ] **Step 5: Implement `codex-rpc.cjs`**

```js
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { createInterface } = require("node:readline");
const { killTree } = require("./process-tree.cjs");

// Client for `codex app-server`: newline-delimited JSON over stdio, shaped like JSON-RPC
// without the "jsonrpc" field (verified against codex-cli 0.158.0):
//   request       { id, method, params }    sent by either side
//   response      { id, result } | { id, error: { code, message } }
//   notification  { method, params }
// Milagre uses initialize, initialized, thread/start, thread/resume, thread/unarchive,
// turn/start and turn/interrupt, plus the item/agentMessage/delta and turn/completed
// notifications. The protocol is marked experimental, so callers read fields defensively.
class CodexRpc extends EventEmitter {
  constructor({ command, args = ["app-server"], cwd, env = process.env, spawnImpl = spawn } = {}) {
    super();
    Object.assign(this, { command, args, cwd, env, spawnImpl });
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.child = null;
    this.exited = false;
  }

  start() {
    const child = this.spawnImpl(this.command, this.args, { cwd: this.cwd, env: this.env, stdio: ["pipe", "pipe", "pipe"], detached: true });
    this.child = child;
    createInterface({ input: child.stdout }).on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-4000);
    });
    child.stdin.on("error", () => {});
    child.on("error", (error) => this.handleExit({ code: null, signal: null, error }));
    child.on("exit", (code, signal) => this.handleExit({ code, signal }));
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method && message.id !== undefined) {
      this.emit("request", { id: message.id, method: message.method, params: message.params ?? {} });
      return;
    }
    if (message.method) {
      this.emit("notification", { method: message.method, params: message.params ?? {} });
      return;
    }
    const waiter = this.pending.get(message.id);
    if (!waiter) return;
    this.pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error.message || `Codex ${waiter.method} failed.`));
    else waiter.resolve(message.result ?? {});
  }

  handleExit({ code, signal, error }) {
    if (this.exited) return;
    this.exited = true;
    const detail = error?.code === "ENOENT"
      ? `${path.basename(String(this.command))} isn't installed or isn't on your PATH.`
      : error?.message || this.stderr.trim() || `Codex exited with code ${code}${signal ? ` (${signal})` : ""}.`;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(detail));
    }
    this.pending.clear();
    this.emit("exit", { code, signal, detail });
  }

  write(message) {
    if (!this.child || this.exited) throw new Error("Codex is not running.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}, { timeoutMs = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex did not answer ${method} within ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    this.write(params === undefined ? { method } : { method, params });
  }

  respond(id, result) {
    this.write({ id, result });
  }

  respondError(id, message) {
    this.write({ id, error: { code: -32601, message } });
  }

  close() {
    return killTree(this.child);
  }
}

module.exports = { CodexRpc };
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm run test:agent`
Expected: PASS, with all existing tests plus 2 process-tree tests and 5 codex-rpc tests.

- [ ] **Step 7: Commit**

```bash
git add package.json electron/agents
git commit -m "feat: add a JSON-RPC client for codex app-server" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

### Task 2: Normalised events and provider mappings

**Files:**
- Create: `electron/agents/events.cjs`
- Test: `electron/agents/events.test.cjs`

**Interfaces:**
- Produces, used by Tasks 3–5:
  - `MILAGRE_INSTRUCTIONS: string`
  - `RESUME_FAILED_MESSAGE: string`
  - `missingCliMessage(name): string`
  - `isTerminal(event): boolean`
  - `mapClaudeMessage(message, state): Event[]`, where `state = { sessionId, turnId, hasText }` is mutated
  - `mapCodexNotification(method, params, state): Event[]`, where `state = { threadId, turnId, lastItemId, hasText }` is mutated
- The `Event` shapes are exactly the ones in the header comment below. They mirror `AgentEvent` in `app/src/model.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { isTerminal, mapClaudeMessage, mapCodexNotification } = require("./events.cjs");

const claudeState = () => ({ sessionId: null, turnId: "turn-a", hasText: false });
const codexState = () => ({ threadId: "thread-1", turnId: null, lastItemId: null, hasText: false });
const delta = (text, extra = {}) => ({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text } }, ...extra });

test("Claude: init announces the session once", () => {
  const state = claudeState();
  assert.deepEqual(mapClaudeMessage({ type: "system", subtype: "init", session_id: "s-1" }, state), [{ type: "session-started", nativeId: "s-1" }]);
  assert.deepEqual(mapClaudeMessage({ type: "system", subtype: "init", session_id: "s-1" }, state), []);
});

test("Claude: streams top-level text and separates text blocks", () => {
  const state = claudeState();
  const start = { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", content_block: { type: "text" } } };
  assert.deepEqual(mapClaudeMessage(start, state), []);
  assert.deepEqual(mapClaudeMessage(delta("Checking"), state), [{ type: "text-delta", messageId: "turn-a", text: "Checking" }]);
  assert.deepEqual(mapClaudeMessage(delta("ignored", { parent_tool_use_id: "tool-1" }), state), []);
  assert.deepEqual(mapClaudeMessage(start, state), [{ type: "text-delta", messageId: "turn-a", text: "\n\n" }]);
});

test("Claude: results end the turn", () => {
  assert.deepEqual(mapClaudeMessage({ type: "result", subtype: "success", is_error: false, result: "ok" }, claudeState()), [{ type: "turn-completed" }]);
  assert.deepEqual(mapClaudeMessage({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["API Error: 529", "Overloaded"] }, claudeState()), [{ type: "turn-failed", message: "API Error: 529\nOverloaded" }]);
  assert.deepEqual(mapClaudeMessage({ type: "result", subtype: "success", is_error: true, result: "Credit balance is too low" }, claudeState()), [{ type: "turn-failed", message: "Credit balance is too low" }]);
});

test("Codex: streams agent message deltas and separates messages", () => {
  const state = codexState();
  assert.deepEqual(mapCodexNotification("item/agentMessage/delta", { threadId: "thread-1", turnId: "t-1", itemId: "a", delta: "First" }, state), [{ type: "text-delta", messageId: "t-1", text: "First" }]);
  assert.deepEqual(mapCodexNotification("item/agentMessage/delta", { threadId: "thread-1", turnId: "t-1", itemId: "b", delta: "Second" }, state), [
    { type: "text-delta", messageId: "t-1", text: "\n\n" },
    { type: "text-delta", messageId: "t-1", text: "Second" },
  ]);
});

test("Codex: ignores other threads and unrelated notifications", () => {
  const state = codexState();
  assert.deepEqual(mapCodexNotification("item/agentMessage/delta", { threadId: "thread-2", turnId: "t", itemId: "a", delta: "x" }, state), []);
  assert.deepEqual(mapCodexNotification("mcpServer/startupStatus/updated", { name: "x" }, state), []);
  assert.deepEqual(mapCodexNotification("hook/started", {}, state), []);
});

test("Codex: turn/completed maps each status", () => {
  const done = (status, error = null) => mapCodexNotification("turn/completed", { threadId: "thread-1", turn: { id: "t-1", status, error } }, codexState());
  assert.deepEqual(done("completed"), [{ type: "turn-completed" }]);
  assert.deepEqual(done("interrupted"), [{ type: "turn-cancelled" }]);
  assert.deepEqual(done("failed", { message: "The 'gpt-6.1-sol' model is not supported." }), [{ type: "turn-failed", message: "The 'gpt-6.1-sol' model is not supported." }]);
  assert.deepEqual(done("failed"), [{ type: "turn-failed", message: "Codex could not finish this turn." }]);
});

test("isTerminal recognises the three turn endings", () => {
  assert.equal(isTerminal({ type: "turn-completed" }), true);
  assert.equal(isTerminal({ type: "turn-failed", message: "x" }), true);
  assert.equal(isTerminal({ type: "turn-cancelled" }), true);
  assert.equal(isTerminal({ type: "text-delta", messageId: null, text: "x" }), false);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test electron/agents/events.test.cjs`
Expected: FAIL, with `Cannot find module './events.cjs'`.

- [ ] **Step 3: Implement `events.cjs`**

```js
// Normalised events every agent session emits. The main process forwards them to the
// renderer as { chatId, event }:
//   { type: "session-started", nativeId }   provider session or thread id; the chat saves it
//   { type: "session-reset" }               the saved id can't be resumed; the chat forgets it
//   { type: "text-delta", messageId, text } reply text as it streams; messageId is the turn id
//   { type: "turn-completed" } | { type: "turn-cancelled" } | { type: "turn-failed", message }
// Exactly one of the last three ends every turn.

const MILAGRE_INSTRUCTIONS = "You are an agent inside Milagre, an agent development environment. Answer the user concisely and humanly. Do not claim to have changed files unless you actually did.";
const RESUME_FAILED_MESSAGE = "Couldn't resume this chat's earlier agent session; it may have been deleted. Send your message again to continue in a fresh session.";
const TERMINAL_TYPES = new Set(["turn-completed", "turn-failed", "turn-cancelled"]);

function missingCliMessage(name) {
  return `Couldn't find the ${name} CLI. Install it and make sure it's on your PATH, then try again.`;
}

function isTerminal(event) {
  return TERMINAL_TYPES.has(event.type);
}

function textDelta(state, text) {
  state.hasText = true;
  return { type: "text-delta", messageId: state.turnId, text };
}

// Claude Agent SDK message -> events. Partial messages (includePartialMessages) carry the
// streamed text; subagent output (parent_tool_use_id set) is not part of the reply.
function mapClaudeMessage(message, state) {
  const events = [];
  if (message.type === "system" && message.subtype === "init" && message.session_id && message.session_id !== state.sessionId) {
    state.sessionId = message.session_id;
    events.push({ type: "session-started", nativeId: message.session_id });
  }
  if (message.type === "stream_event" && message.parent_tool_use_id == null) {
    const event = message.event ?? {};
    if (event.type === "content_block_start" && event.content_block?.type === "text" && state.hasText) events.push(textDelta(state, "\n\n"));
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) events.push(textDelta(state, event.delta.text));
  }
  if (message.type === "result") {
    if (message.subtype === "success" && !message.is_error) events.push({ type: "turn-completed" });
    else events.push({ type: "turn-failed", message: (message.errors?.length ? message.errors.join("\n") : message.result) || "Claude could not finish this turn." });
  }
  return events;
}

// codex app-server notification -> events. Everything not listed is ignored on purpose:
// the server also reports MCP startup, hooks, rate limits and token usage.
function mapCodexNotification(method, params, state) {
  if (params.threadId && state.threadId && params.threadId !== state.threadId) return [];
  if (method === "item/agentMessage/delta" && params.delta) {
    const events = [];
    state.turnId = params.turnId ?? state.turnId;
    if (state.hasText && state.lastItemId && params.itemId !== state.lastItemId) events.push(textDelta(state, "\n\n"));
    state.lastItemId = params.itemId;
    events.push(textDelta(state, params.delta));
    return events;
  }
  if (method === "turn/completed") {
    const turn = params.turn ?? {};
    if (turn.status === "interrupted") return [{ type: "turn-cancelled" }];
    if (turn.status === "failed") return [{ type: "turn-failed", message: turn.error?.message || "Codex could not finish this turn." }];
    return [{ type: "turn-completed" }];
  }
  return [];
}

module.exports = { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, isTerminal, mapClaudeMessage, mapCodexNotification, missingCliMessage };
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test electron/agents/events.test.cjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/agents/events.cjs electron/agents/events.test.cjs
git commit -m "feat: map Claude and Codex output to one event stream" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

### Task 3: Codex session

**Files:**
- Create: `electron/agents/codex-provider.cjs`
- Test: `electron/agents/codex-provider.test.cjs`

**Interfaces:**
- Consumes:
  - `CodexRpc` (Task 1)
  - `mapCodexNotification`, `isTerminal`, `MILAGRE_INSTRUCTIONS`, `RESUME_FAILED_MESSAGE` and `missingCliMessage` (Task 2)
  - `decodeImages` output from `electron/image-input.cjs`: `{ mime, bytes, base64 }[]`
- Produces `class CodexSession`:
  - constructor: `({ cwd, resumeId, command, emit, clientVersion = "0.0.0", createRpc = (options) => new CodexRpc(options) })`
  - `startTurn({ prompt, images = [], model, permissionMode }): Promise<{ turnId: string | null }>`. It never rejects: failures arrive as events. It rejects only when called while a turn is running.
  - `interrupt(): Promise<void>`
  - `close(): Promise<void>`
  - `nativeId: string | null`
  - `closed: boolean`

- [ ] **Step 1: Write the failing test**

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CodexRpc } = require("./codex-rpc.cjs");
const { CodexSession } = require("./codex-provider.cjs");
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, isTerminal, missingCliMessage } = require("./events.cjs");
const { decodeImages } = require("../image-input.cjs");
const { waitUntil } = require("./test-helpers.cjs");

const FAKE = path.join(__dirname, "fixtures", "fake-app-server.cjs");
const TURN = { prompt: "Hi", images: [], model: "gpt-6-sol", permissionMode: "auto" };

function codex(t, { scenario = "reply", resumeId, command = process.execPath } = {}) {
  const events = [];
  const session = new CodexSession({
    cwd: os.tmpdir(),
    resumeId,
    command,
    clientVersion: "test",
    emit: (event) => events.push(event),
    createRpc: (options) => new CodexRpc({ ...options, args: [FAKE], env: { ...process.env, FAKE_SCENARIO: scenario } }),
  });
  t.after(() => session.close());
  return { session, events };
}
const ended = (events, count = 1) => waitUntil(() => events.filter(isTerminal).length >= count);
const received = async (session) => (await session.rpc.request("fake/received")).received;

test("streams a reply and keeps one thread across turns", async (t) => {
  const { session, events } = codex(t);
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events, [
    { type: "session-started", nativeId: "thread-1" },
    { type: "text-delta", messageId: "turn-1", text: "Hel" },
    { type: "text-delta", messageId: "turn-1", text: "lo" },
    { type: "turn-completed" },
  ]);

  await session.startTurn(TURN);
  await ended(events, 2);
  assert.equal(events.filter((event) => event.type === "session-started").length, 1);
  assert.equal((await session.rpc.request("fake/received")).threadStarts, 1);
  assert.equal(session.nativeId, "thread-1");
});

test("starts threads and turns with Milagre's identity, instructions and policy", async (t) => {
  const { session, events } = codex(t);
  await session.startTurn({ ...TURN, permissionMode: "full" });
  await ended(events);
  const messages = await received(session);
  const find = (method) => messages.find((message) => message.method === method).params;

  assert.equal(find("initialize").clientInfo.name, "milagre");
  assert.equal(find("thread/start").developerInstructions, MILAGRE_INSTRUCTIONS);
  assert.equal(find("turn/start").approvalPolicy, "never");
  assert.deepEqual(find("turn/start").sandboxPolicy, { type: "dangerFullAccess" });
  assert.deepEqual(find("turn/start").input, [{ type: "text", text: "Hi", text_elements: [] }]);
});

test("Ask and Auto stay inside the workspace sandbox", async (t) => {
  const { session, events } = codex(t);
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await ended(events);
  const turnStart = (await received(session)).find((message) => message.method === "turn/start").params;
  assert.equal(turnStart.approvalPolicy, "never");
  assert.equal(turnStart.sandboxPolicy.type, "workspaceWrite");
  assert.deepEqual(turnStart.sandboxPolicy.writableRoots, [os.tmpdir()]);
});

test("resumes a saved thread without announcing it again", async (t) => {
  const { session, events } = codex(t, { resumeId: "thread-9" });
  await session.startTurn(TURN);
  await ended(events);
  assert.equal((await received(session)).find((message) => message.method === "thread/resume").params.threadId, "thread-9");
  assert.equal(events.some((event) => event.type === "session-started"), false);
  assert.equal(session.nativeId, "thread-9");
});

test("forgets a thread that can't be resumed", async (t) => {
  const { session, events } = codex(t, { resumeId: "missing" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events, [{ type: "session-reset" }, { type: "turn-failed", message: RESUME_FAILED_MESSAGE }]);
  assert.equal(session.closed, true);
});

test("interrupts a running turn", async (t) => {
  const { session, events } = codex(t, { scenario: "slow" });
  await session.startTurn(TURN);
  await session.interrupt();
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
});

test("cancels before Codex has started the turn", async (t) => {
  const { session, events } = codex(t);
  const pending = session.startTurn(TURN);
  await session.interrupt();
  await pending;
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
  assert.equal((await received(session)).some((message) => message.method === "turn/start"), false);
});

test("reports a failed turn and a crashed process", async (t) => {
  const failed = codex(t, { scenario: "fail" });
  await failed.session.startTurn(TURN);
  await ended(failed.events);
  assert.deepEqual(failed.events.at(-1), { type: "turn-failed", message: "The model gpt-x is not supported." });

  const crashed = codex(t, { scenario: "crash" });
  await crashed.session.startTurn(TURN);
  await ended(crashed.events);
  assert.match(crashed.events.at(-1).message, /boom: model unavailable/);
  assert.equal(crashed.session.closed, true);
});

test("declines approval requests so nothing waits on the user yet", async (t) => {
  const { session, events } = codex(t, { scenario: "approval" });
  await session.startTurn(TURN);
  await ended(events);
  assert.ok(events.some((event) => event.type === "text-delta" && event.text === "decision:decline"));
});

test("passes images as local files and removes them afterwards", async (t) => {
  const { session, events } = codex(t);
  const png = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64")}`;
  await session.startTurn({ ...TURN, images: decodeImages([{ dataUrl: png }]) });
  await ended(events);
  const turnStart = (await received(session)).find((message) => message.method === "turn/start");
  const image = turnStart.params.input.find((input) => input.type === "localImage");
  assert.deepEqual(turnStart.imagesExist, [true]);
  assert.equal(fs.existsSync(image.path), false);
});

test("closes a session whose startup failed so the next message starts over", async (t) => {
  const { session, events } = codex(t, { command: "milagre-definitely-missing-cli" });
  await session.startTurn(TURN);
  assert.match(events.at(-1).message, /isn't installed or isn't on your PATH/);
  assert.equal(session.closed, true);
});

test("explains a missing CLI without starting anything", async (t) => {
  const { session, events } = codex(t, { command: null });
  await session.startTurn(TURN);
  assert.deepEqual(events, [{ type: "turn-failed", message: missingCliMessage("codex") }]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test electron/agents/codex-provider.test.cjs`
Expected: FAIL, with `Cannot find module './codex-provider.cjs'`.

- [ ] **Step 3: Implement `codex-provider.cjs`**

```js
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { CodexRpc } = require("./codex-rpc.cjs");
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, isTerminal, mapCodexNotification, missingCliMessage } = require("./events.cjs");

const INTERRUPT_GRACE_MS = 3000;

// Milagre permission mode -> Codex policy. Approvals arrive in a later step, so no mode asks
// yet. Ask and Auto work inside the workspace sandbox, as `codex exec` did before; Ask also
// keeps Milagre's pre-run confirmation in the renderer.
function codexPolicy(permissionMode, cwd) {
  if (permissionMode === "full") return { approvalPolicy: "never", sandbox: "danger-full-access", sandboxPolicy: { type: "dangerFullAccess" } };
  return {
    approvalPolicy: "never",
    sandbox: "workspace-write",
    sandboxPolicy: { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
  };
}

async function writeImages(images) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "milagre-images-"));
  const paths = [];
  for (const [index, image] of images.entries()) {
    const file = path.join(directory, `${index}.${image.mime.split("/")[1]}`);
    await fs.writeFile(file, image.bytes, { mode: 0o600 });
    paths.push(file);
  }
  return { paths, cleanup: () => fs.rm(directory, { recursive: true, force: true }) };
}

class CodexSession {
  constructor({ cwd, resumeId, command, emit, clientVersion = "0.0.0", createRpc = (options) => new CodexRpc(options) }) {
    Object.assign(this, { cwd, resumeId, command, emit, clientVersion, createRpc });
    this.state = { threadId: resumeId ?? null, turnId: null, lastItemId: null, hasText: false };
    this.rpc = null;
    this.starting = null;
    this.turnActive = false;
    this.cancelRequested = false;
    this.images = null;
    this.ready = false;
    this.closed = false;
  }

  get nativeId() {
    return this.state.threadId;
  }

  async startTurn({ prompt, images = [], model, permissionMode }) {
    if (this.turnActive) throw new Error("This chat already has a turn running.");
    if (!this.command) {
      this.emit({ type: "turn-failed", message: missingCliMessage("codex") });
      return { turnId: null };
    }
    this.turnActive = true;
    this.cancelRequested = false;
    Object.assign(this.state, { turnId: null, lastItemId: null, hasText: false });
    const policy = codexPolicy(permissionMode, this.cwd);
    try {
      this.starting ??= this.start(model, policy);
      await this.starting;
      if (this.cancelRequested) {
        await this.finishTurn([{ type: "turn-cancelled" }]);
        return { turnId: null };
      }
      this.images = images.length ? await writeImages(images) : null;
      const input = [{ type: "text", text: prompt, text_elements: [] }, ...(this.images?.paths ?? []).map((file) => ({ type: "localImage", path: file }))];
      const { turn } = await this.rpc.request("turn/start", {
        threadId: this.state.threadId,
        input,
        model,
        approvalPolicy: policy.approvalPolicy,
        sandboxPolicy: policy.sandboxPolicy,
      }, { timeoutMs: 90_000 });
      this.state.turnId ??= turn?.id ?? null;
      if (this.cancelRequested) void this.interrupt();
      return { turnId: this.state.turnId };
    } catch (error) {
      if (error.resumeFailed) {
        await this.finishTurn([{ type: "session-reset" }, { type: "turn-failed", message: RESUME_FAILED_MESSAGE }]);
        await this.close();
      } else {
        await this.finishTurn([this.cancelRequested ? { type: "turn-cancelled" } : { type: "turn-failed", message: error.message }]);
        // A session that never finished starting is unusable; closing it lets the manager start over.
        if (!this.ready) await this.close();
      }
      return { turnId: null };
    }
  }

  async start(model, policy) {
    const rpc = this.createRpc({ command: this.command, cwd: this.cwd });
    this.rpc = rpc;
    rpc.on("notification", ({ method, params }) => this.handleNotification(method, params));
    rpc.on("request", ({ id, method }) => this.handleServerRequest(id, method));
    rpc.on("exit", ({ detail }) => this.handleExit(detail));
    rpc.start();
    await rpc.request("initialize", { clientInfo: { name: "milagre", title: "Milagre", version: this.clientVersion }, capabilities: null });
    rpc.notify("initialized");
    const threadParams = { cwd: this.cwd, model, approvalPolicy: policy.approvalPolicy, sandbox: policy.sandbox, developerInstructions: MILAGRE_INSTRUCTIONS };
    const thread = this.resumeId ? await this.resume(threadParams) : (await rpc.request("thread/start", threadParams, { timeoutMs: 60_000 })).thread;
    if (thread?.id && thread.id !== this.state.threadId) {
      this.state.threadId = thread.id;
      this.emit({ type: "session-started", nativeId: thread.id });
    }
    this.ready = true;
  }

  async resume(threadParams) {
    const params = { ...threadParams, threadId: this.resumeId };
    try {
      return (await this.rpc.request("thread/resume", params, { timeoutMs: 60_000 })).thread;
    } catch {
      try {
        await this.rpc.request("thread/unarchive", { threadId: this.resumeId });
        return (await this.rpc.request("thread/resume", params, { timeoutMs: 60_000 })).thread;
      } catch {
        throw Object.assign(new Error(RESUME_FAILED_MESSAGE), { resumeFailed: true });
      }
    }
  }

  handleNotification(method, params) {
    if (method === "turn/started" && params.threadId === this.state.threadId) this.state.turnId ??= params.turn?.id ?? null;
    const events = mapCodexNotification(method, params, this.state);
    if (!events.some(isTerminal)) {
      events.forEach((event) => this.emit(event));
      return;
    }
    void this.finishTurn(this.cancelRequested ? events.map((event) => (isTerminal(event) ? { type: "turn-cancelled" } : event)) : events);
  }

  // Approvals arrive in a later step; until then nothing may wait on the user.
  handleServerRequest(id, method) {
    if (method.endsWith("/requestApproval")) this.rpc.respond(id, { decision: "decline" });
    else this.rpc.respondError(id, `Milagre does not support ${method} yet.`);
  }

  handleExit(detail) {
    this.closed = true;
    void this.finishTurn([this.cancelRequested ? { type: "turn-cancelled" } : { type: "turn-failed", message: `Codex stopped: ${detail}` }]);
  }

  async finishTurn(events) {
    if (!this.turnActive) return;
    this.turnActive = false;
    clearTimeout(this.interruptTimer);
    const images = this.images;
    this.images = null;
    await images?.cleanup();
    events.forEach((event) => this.emit(event));
  }

  async interrupt() {
    if (!this.turnActive) return;
    this.cancelRequested = true;
    if (!this.state.turnId || !this.rpc) return;
    clearTimeout(this.interruptTimer);
    this.interruptTimer = setTimeout(() => void this.close(), INTERRUPT_GRACE_MS);
    try {
      await this.rpc.request("turn/interrupt", { threadId: this.state.threadId, turnId: this.state.turnId }, { timeoutMs: INTERRUPT_GRACE_MS });
    } catch {
      await this.close();
    }
  }

  async close() {
    if (this.turnActive) this.cancelRequested = true;
    this.closed = true;
    await this.rpc?.close();
  }
}

module.exports = { CodexSession, codexPolicy };
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test electron/agents/codex-provider.test.cjs`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/agents/codex-provider.cjs electron/agents/codex-provider.test.cjs
git commit -m "feat: run Codex chats as resumable app-server threads" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

### Task 4: Claude session

**Files:**
- Create: `electron/agents/claude-provider.cjs`
- Test: `electron/agents/claude-provider.test.cjs`
- Modify: `package.json`, `package-lock.json` (dependency)

**Interfaces:**
- Consumes:
  - `killTree` (Task 1)
  - `mapClaudeMessage`, `isTerminal`, `MILAGRE_INSTRUCTIONS`, `RESUME_FAILED_MESSAGE` and `missingCliMessage` (Task 2)
- Produces `class ClaudeSession`:
  - constructor: `({ cwd, resumeId, command, emit, loadSdk = () => import("@anthropic-ai/claude-agent-sdk"), spawnImpl = spawn, interruptGraceMs = 3000 })`
  - the same session API as `CodexSession`: `startTurn`, `interrupt`, `close`, `nativeId`, `closed`

- [ ] **Step 1: Add the pinned SDK**

Run: `npm install --save-exact @anthropic-ai/claude-agent-sdk@0.3.286`
Expected: `package.json` lists `"@anthropic-ai/claude-agent-sdk": "0.3.286"` under `dependencies`.

- [ ] **Step 2: Write the failing test**

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { ClaudeSession } = require("./claude-provider.cjs");
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, isTerminal, missingCliMessage } = require("./events.cjs");
const { waitUntil } = require("./test-helpers.cjs");

const TURN = { prompt: "Hi", images: [], model: "claude-opus-5-5", permissionMode: "auto" };
const init = { type: "system", subtype: "init", session_id: "session-1" };
const delta = (text) => ({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
const success = { type: "result", subtype: "success", is_error: false, result: "Hello" };

const scripts = {
  async *reply() {
    yield init;
    yield delta("Hel");
    yield delta("lo");
    yield success;
  },
  async *interruptible({ interrupted }) {
    yield init;
    await interrupted;
    yield { type: "result", subtype: "error_during_execution", is_error: true, errors: ["Request was aborted."] };
  },
  async *unresponsive() {
    yield init;
    await new Promise(() => {});
  },
  async *crash() {
    yield init;
    throw new Error("Claude Code process exited with code 1");
  },
  async *missing() {
    throw new Error("No conversation found with session ID: gone");
  },
};

// Stands in for the SDK's query(): consumes the streaming prompt and plays a script per turn.
function fakeSdk(script) {
  const calls = { options: null, queries: 0, prompts: [], models: [], modes: [], interrupts: 0 };
  const query = ({ prompt, options }) => {
    calls.queries += 1;
    calls.options = options;
    let markInterrupted;
    const interrupted = new Promise((resolve) => { markInterrupted = resolve; });
    async function* run() {
      for await (const message of prompt) {
        calls.prompts.push(message);
        yield* script({ interrupted });
      }
    }
    return Object.assign(run(), {
      interrupt: async () => { calls.interrupts += 1; markInterrupted(); },
      setModel: async (model) => { calls.models.push(model); },
      setPermissionMode: async (mode) => { calls.modes.push(mode); },
    });
  };
  return { calls, loadSdk: async () => ({ query }) };
}

function claude(t, { script = scripts.reply, resumeId, command = "/usr/local/bin/claude", interruptGraceMs } = {}) {
  const sdk = fakeSdk(script);
  const events = [];
  const session = new ClaudeSession({ cwd: "/repo", resumeId, command, emit: (event) => events.push(event), loadSdk: sdk.loadSdk, interruptGraceMs });
  t.after(() => session.close());
  return { session, events, calls: sdk.calls };
}
const ended = (events, count = 1) => waitUntil(() => events.filter(isTerminal).length >= count);

test("starts with Milagre's options and streams a reply", async (t) => {
  const { session, events, calls } = claude(t);
  await session.startTurn(TURN);
  await ended(events);

  assert.deepEqual(events.map((event) => event.type), ["session-started", "text-delta", "text-delta", "turn-completed"]);
  assert.equal(events[0].nativeId, "session-1");
  assert.equal(events.filter((event) => event.type === "text-delta").map((event) => event.text).join(""), "Hello");
  assert.equal(calls.options.cwd, "/repo");
  assert.equal(calls.options.model, "claude-opus-5-5");
  assert.equal(calls.options.permissionMode, "acceptEdits");
  assert.equal(calls.options.includePartialMessages, true);
  assert.equal(calls.options.allowDangerouslySkipPermissions, true);
  assert.equal(calls.options.pathToClaudeCodeExecutable, "/usr/local/bin/claude");
  assert.deepEqual(calls.options.settingSources, ["user", "project", "local"]);
  assert.deepEqual(calls.options.systemPrompt, { type: "preset", preset: "claude_code", append: MILAGRE_INSTRUCTIONS });
  assert.equal("resume" in calls.options, false);
  assert.deepEqual(calls.prompts[0].message.content, [{ type: "text", text: "Hi" }]);
});

test("keeps one query across turns and applies model and mode changes", async (t) => {
  const { session, events, calls } = claude(t);
  await session.startTurn(TURN);
  await ended(events);
  await session.startTurn({ ...TURN, model: "claude-sonnet-5-5", permissionMode: "full" });
  await ended(events, 2);

  assert.equal(calls.queries, 1);
  assert.deepEqual(calls.models, ["claude-sonnet-5-5"]);
  assert.deepEqual(calls.modes, ["bypassPermissions"]);
  assert.equal(events.filter((event) => event.type === "session-started").length, 1);
});

test("sends images as base64 content blocks", async (t) => {
  const { session, events, calls } = claude(t);
  await session.startTurn({ ...TURN, images: [{ mime: "image/png", base64: "iVBORw0KGgo=" }] });
  await ended(events);
  assert.deepEqual(calls.prompts[0].message.content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } });
});

test("resumes a saved session without announcing it again", async (t) => {
  const { session, events, calls } = claude(t, { resumeId: "session-1" });
  await session.startTurn(TURN);
  await ended(events);
  assert.equal(calls.options.resume, "session-1");
  assert.equal(events.some((event) => event.type === "session-started"), false);
});

test("forgets a session that can't be resumed", async (t) => {
  const { session, events } = claude(t, { script: scripts.missing, resumeId: "gone" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events, [{ type: "session-reset" }, { type: "turn-failed", message: RESUME_FAILED_MESSAGE }]);
  assert.equal(session.closed, true);
});

test("interrupts a running turn", async (t) => {
  const { session, events, calls } = claude(t, { script: scripts.interruptible });
  await session.startTurn(TURN);
  await waitUntil(() => events.length > 0);
  await session.interrupt();
  await ended(events);
  assert.equal(calls.interrupts, 1);
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
});

test("gives up on an interrupt Claude never answers", async (t) => {
  const { session, events } = claude(t, { script: scripts.unresponsive, interruptGraceMs: 50 });
  await session.startTurn(TURN);
  await waitUntil(() => events.length > 0);
  await session.interrupt();
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
});

test("reports a crash mid-turn", async (t) => {
  const { session, events } = claude(t, { script: scripts.crash });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-failed", message: "Claude Code process exited with code 1" });
  assert.equal(session.closed, true);
});

test("explains a missing CLI without starting anything", async (t) => {
  const { session, events, calls } = claude(t, { command: null });
  await session.startTurn(TURN);
  assert.deepEqual(events, [{ type: "turn-failed", message: missingCliMessage("claude") }]);
  assert.equal(calls.queries, 0);
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `node --test electron/agents/claude-provider.test.cjs`
Expected: FAIL, with `Cannot find module './claude-provider.cjs'`.

- [ ] **Step 4: Implement `claude-provider.cjs`**

```js
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { killTree } = require("./process-tree.cjs");
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, isTerminal, mapClaudeMessage, missingCliMessage } = require("./events.cjs");

// Milagre permission mode -> Claude Code permission mode. Approvals arrive in a later step,
// so Ask uses acceptEdits like the old `claude --print` call; Ask also keeps Milagre's
// pre-run confirmation in the renderer.
const CLAUDE_MODES = { ask: "acceptEdits", auto: "acceptEdits", full: "bypassPermissions" };

// User messages for a running query: the SDK's streaming-input mode reads this until it ends.
class Inbox {
  constructor() {
    this.queue = [];
    this.wake = null;
    this.ended = false;
  }

  push(message) {
    this.queue.push(message);
    this.wake?.();
  }

  end() {
    this.ended = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.queue.length) yield this.queue.shift();
      if (this.ended) return;
      await new Promise((resolve) => { this.wake = resolve; });
      this.wake = null;
    }
  }
}

class ClaudeSession {
  constructor({ cwd, resumeId, command, emit, loadSdk = () => import("@anthropic-ai/claude-agent-sdk"), spawnImpl = spawn, interruptGraceMs = 3000 }) {
    Object.assign(this, { cwd, resumeId, command, emit, loadSdk, spawnImpl, interruptGraceMs });
    this.state = { sessionId: resumeId ?? null, turnId: null, hasText: false };
    this.query = null;
    this.inbox = null;
    this.child = null;
    this.stderr = "";
    this.initSeen = false;
    this.turnActive = false;
    this.cancelRequested = false;
    this.closed = false;
  }

  get nativeId() {
    return this.state.sessionId;
  }

  async startTurn({ prompt, images = [], model, permissionMode }) {
    if (this.turnActive) throw new Error("This chat already has a turn running.");
    if (!this.command) {
      this.emit({ type: "turn-failed", message: missingCliMessage("claude") });
      return { turnId: null };
    }
    this.turnActive = true;
    this.cancelRequested = false;
    const turnId = randomUUID();
    Object.assign(this.state, { turnId, hasText: false });
    const mode = CLAUDE_MODES[permissionMode] ?? "acceptEdits";
    try {
      if (!this.query) await this.start(model, mode);
      if (model !== this.model) {
        await this.query.setModel(model);
        this.model = model;
      }
      if (mode !== this.mode) {
        await this.query.setPermissionMode(mode);
        this.mode = mode;
      }
    } catch (error) {
      this.finishTurn({ type: "turn-failed", message: error.message });
      return { turnId: null };
    }
    const content = [{ type: "text", text: prompt }, ...images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mime, data: image.base64 } }))];
    this.inbox.push({ type: "user", message: { role: "user", content }, parent_tool_use_id: null });
    return { turnId };
  }

  async start(model, mode) {
    const { query } = await this.loadSdk();
    this.inbox = new Inbox();
    this.model = model;
    this.mode = mode;
    this.query = query({
      prompt: this.inbox,
      options: {
        cwd: this.cwd,
        model,
        permissionMode: mode,
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        pathToClaudeCodeExecutable: this.command,
        settingSources: ["user", "project", "local"],
        systemPrompt: { type: "preset", preset: "claude_code", append: MILAGRE_INSTRUCTIONS },
        ...(this.resumeId ? { resume: this.resumeId } : {}),
        // Own the process so close() can stop Claude Code and everything it started.
        spawnClaudeCodeProcess: ({ command, args, cwd, env, signal }) => {
          const child = this.spawnImpl(command, args, { cwd, env, signal, stdio: ["pipe", "pipe", "pipe"], detached: true });
          child.stderr?.on("data", (chunk) => { this.stderr = (this.stderr + chunk.toString()).slice(-4000); });
          this.child = child;
          return child;
        },
      },
    });
    void this.readMessages(this.query);
  }

  async readMessages(query) {
    try {
      for await (const message of query) {
        if (message.type === "system" && message.subtype === "init") this.initSeen = true;
        for (const event of mapClaudeMessage(message, this.state)) {
          if (!isTerminal(event)) this.emit(event);
          else if (this.cancelRequested) this.finishTurn({ type: "turn-cancelled" });
          else if (event.type === "turn-failed" && this.resumeId && !this.initSeen) this.resumeFailed();
          else this.finishTurn(event);
        }
      }
      this.handleEnd(null);
    } catch (error) {
      this.handleEnd(error);
    }
  }

  handleEnd(error) {
    this.query = null;
    this.closed = true;
    if (!this.turnActive) return;
    if (this.cancelRequested) this.finishTurn({ type: "turn-cancelled" });
    else if (this.resumeId && !this.initSeen) this.resumeFailed();
    else this.finishTurn({ type: "turn-failed", message: error?.message || this.stderr.trim() || "Claude Code stopped unexpectedly." });
  }

  resumeFailed() {
    if (!this.turnActive) return;
    this.emit({ type: "session-reset" });
    this.finishTurn({ type: "turn-failed", message: RESUME_FAILED_MESSAGE });
    void this.close();
  }

  finishTurn(event) {
    if (!this.turnActive) return;
    this.turnActive = false;
    clearTimeout(this.interruptTimer);
    this.emit(event);
  }

  async interrupt() {
    if (!this.turnActive) return;
    this.cancelRequested = true;
    clearTimeout(this.interruptTimer);
    // If Claude never confirms, stop the process; the turn then ends as cancelled.
    this.interruptTimer = setTimeout(() => {
      void this.close().then(() => this.finishTurn({ type: "turn-cancelled" }));
    }, this.interruptGraceMs);
    // interrupt() rejects with "Query closed before response received" when the query
    // closes first; that is expected during cancel and shutdown.
    await this.query?.interrupt().catch(() => {});
  }

  async close() {
    if (this.turnActive) this.cancelRequested = true;
    this.closed = true;
    this.inbox?.end();
    const query = this.query;
    this.query = null;
    // An async generator stuck on an await never settles return(), so don't wait forever.
    await Promise.race([query?.return?.().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await killTree(this.child);
  }
}

module.exports = { ClaudeSession, CLAUDE_MODES };
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node --test electron/agents/claude-provider.test.cjs`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json electron/agents/claude-provider.cjs electron/agents/claude-provider.test.cjs
git commit -m "feat: run Claude chats as resumable Agent SDK sessions" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

### Task 5: Session manager

**Files:**
- Create: `electron/agents/session-manager.cjs`
- Test: `electron/agents/session-manager.test.cjs`

**Interfaces:**
- Consumes: `isTerminal` (Task 2). Sessions are created through the injected `createSession`, so the manager never imports the providers.
- Produces `class SessionManager`:
  - constructor: `({ createSession(provider, { cwd, resumeId, command, emit }), send(chatId, event), idleMs = 600000, batchMs = 50 })`
  - `startTurn(request): Promise<{ turnId: string | null }>`, where `request = { chatId, provider, model, cwd, permissionMode, prompt, images, resumeId, command }`
  - `interrupt(chatId): Promise<void>`
  - `closeChat(chatId): Promise<void>`
  - `closeAll(): Promise<void>`

- [ ] **Step 1: Write the failing test**

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { SessionManager } = require("./session-manager.cjs");
const { waitUntil } = require("./test-helpers.cjs");

class FakeSession {
  constructor(provider, options) {
    Object.assign(this, { provider, options, turns: [], interrupts: 0, closed: false });
  }

  async startTurn(turn) {
    this.turns.push(turn);
    return { turnId: `t${this.turns.length}` };
  }

  emit(event) {
    this.options.emit(event);
  }

  async interrupt() {
    this.interrupts += 1;
  }

  async close() {
    this.closed = true;
  }
}

function harness({ idleMs = 60_000 } = {}) {
  const sent = [];
  const created = [];
  const manager = new SessionManager({
    send: (chatId, event) => sent.push({ chatId, event }),
    createSession: (provider, options) => {
      const session = new FakeSession(provider, options);
      created.push(session);
      return session;
    },
    idleMs,
    batchMs: 20,
  });
  return { manager, sent, created };
}
const request = (chatId, extra = {}) => ({ chatId, provider: "codex", model: "gpt-6-sol", cwd: "/repo", permissionMode: "auto", prompt: "hi", images: [], command: "/bin/codex", ...extra });

test("creates one session per chat and reuses it", async (t) => {
  const { manager, created } = harness();
  t.after(() => manager.closeAll());
  assert.deepEqual(await manager.startTurn(request("1", { resumeId: "thread-7" })), { turnId: "t1" });
  await manager.startTurn(request("1"));

  assert.equal(created.length, 1);
  assert.equal(created[0].turns.length, 2);
  assert.equal(created[0].options.cwd, "/repo");
  assert.equal(created[0].options.resumeId, "thread-7");
  assert.equal(created[0].options.command, "/bin/codex");
  assert.deepEqual(created[0].turns[0], { prompt: "hi", images: [], model: "gpt-6-sol", permissionMode: "auto" });
});

test("keeps chats apart", async (t) => {
  const { manager, sent, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  await manager.startTurn(request("2", { provider: "claude" }));
  created[1].emit({ type: "turn-completed" });
  created[0].emit({ type: "turn-failed", message: "x" });

  assert.equal(created.length, 2);
  assert.deepEqual(sent, [
    { chatId: "2", event: { type: "turn-completed" } },
    { chatId: "1", event: { type: "turn-failed", message: "x" } },
  ]);
});

test("batches text and flushes it before the turn ends", async (t) => {
  const { manager, sent, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].emit({ type: "text-delta", messageId: "t1", text: "Hel" });
  created[0].emit({ type: "text-delta", messageId: "t1", text: "lo" });
  assert.deepEqual(sent, []);
  created[0].emit({ type: "turn-completed" });

  assert.deepEqual(sent, [
    { chatId: "1", event: { type: "text-delta", messageId: "t1", text: "Hello" } },
    { chatId: "1", event: { type: "turn-completed" } },
  ]);
});

test("sends batched text after the batch window", async (t) => {
  const { manager, sent, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].emit({ type: "text-delta", messageId: "t1", text: "Hi" });
  await waitUntil(() => sent.length === 1);
  assert.deepEqual(sent[0], { chatId: "1", event: { type: "text-delta", messageId: "t1", text: "Hi" } });
});

test("replaces a session after a provider switch or a crash", async (t) => {
  const { manager, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  await manager.startTurn(request("1", { provider: "claude" }));
  assert.equal(created[0].closed, true);
  assert.equal(created[1].provider, "claude");

  created[1].closed = true;
  await manager.startTurn(request("1", { provider: "claude", resumeId: "session-1" }));
  assert.equal(created.length, 3);
  assert.equal(created[2].options.resumeId, "session-1");
});

test("closes idle sessions", async (t) => {
  const { manager, created } = harness({ idleMs: 30 });
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].emit({ type: "turn-completed" });
  await waitUntil(() => created[0].closed);
});

test("routes interrupts and closes everything on shutdown", async () => {
  const { manager, created } = harness();
  await manager.startTurn(request("1"));
  await manager.startTurn(request("2"));
  await manager.interrupt("2");
  await manager.interrupt("missing");
  assert.equal(created[1].interrupts, 1);

  await manager.closeAll();
  assert.ok(created.every((session) => session.closed));
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test electron/agents/session-manager.test.cjs`
Expected: FAIL, with `Cannot find module './session-manager.cjs'`.

- [ ] **Step 3: Implement `session-manager.cjs`**

```js
const { isTerminal } = require("./events.cjs");

const IDLE_MS = 10 * 60 * 1000;
const BATCH_MS = 50;

// One agent session per chat. Sessions start on a chat's first turn, resume from the id the
// chat saved, close after a quiet period, and are replaced when they crash or the chat
// changes provider. Text deltas are batched so fast streams don't flood IPC.
class SessionManager {
  constructor({ createSession, send, idleMs = IDLE_MS, batchMs = BATCH_MS }) {
    Object.assign(this, { createSession, send, idleMs, batchMs });
    this.sessions = new Map();
    this.buffers = new Map();
  }

  async startTurn(request) {
    const { chatId, provider } = request;
    let entry = this.sessions.get(chatId);
    if (entry && (entry.provider !== provider || entry.session.closed)) {
      await this.closeChat(chatId);
      entry = undefined;
    }
    if (!entry) {
      const session = this.createSession(provider, {
        cwd: request.cwd,
        resumeId: request.resumeId,
        command: request.command,
        emit: (event) => this.forward(chatId, event),
      });
      entry = { provider, session, idleTimer: null };
      this.sessions.set(chatId, entry);
    }
    clearTimeout(entry.idleTimer);
    return entry.session.startTurn({ prompt: request.prompt, images: request.images, model: request.model, permissionMode: request.permissionMode });
  }

  forward(chatId, event) {
    if (event.type === "text-delta") {
      const buffer = this.buffers.get(chatId);
      if (buffer && buffer.messageId !== event.messageId) this.flush(chatId);
      const next = this.buffers.get(chatId) ?? { messageId: event.messageId, text: "", timer: setTimeout(() => this.flush(chatId), this.batchMs) };
      next.text += event.text;
      this.buffers.set(chatId, next);
      return;
    }
    this.flush(chatId);
    this.send(chatId, event);
    if (isTerminal(event)) this.scheduleIdleClose(chatId);
  }

  flush(chatId) {
    const buffer = this.buffers.get(chatId);
    if (!buffer) return;
    clearTimeout(buffer.timer);
    this.buffers.delete(chatId);
    if (buffer.text) this.send(chatId, { type: "text-delta", messageId: buffer.messageId, text: buffer.text });
  }

  scheduleIdleClose(chatId) {
    const entry = this.sessions.get(chatId);
    if (!entry) return;
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => void this.closeChat(chatId), this.idleMs);
    entry.idleTimer.unref?.();
  }

  async interrupt(chatId) {
    await this.sessions.get(chatId)?.session.interrupt();
  }

  async closeChat(chatId) {
    const entry = this.sessions.get(chatId);
    if (!entry) return;
    this.sessions.delete(chatId);
    clearTimeout(entry.idleTimer);
    await entry.session.close();
  }

  async closeAll() {
    await Promise.all([...this.sessions.keys()].map((chatId) => this.closeChat(chatId)));
  }
}

module.exports = { SessionManager };
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test electron/agents/session-manager.test.cjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/agents/session-manager.cjs electron/agents/session-manager.test.cjs
git commit -m "feat: manage one agent session per chat" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

### Task 6: Renderer state for streamed turns

**Files:**
- Modify: `app/src/model.ts` (types)
- Create: `app/src/lib/agent-runs.ts`
- Test: `app/src/lib/agent-runs.test.ts`
- Modify: `tsconfig.json` (`allowImportingTsExtensions`), `package.json` (`test:agent` script)

**Interfaces:**
- Produces in `app/src/model.ts`, matching Task 2's events:
  - `AgentEvent`
  - `AgentStartTurnRequest`
  - `AgentSession.provider?`
  - `AgentSession.native_session_id?`
  - `ChatMessage.outcome?`
- Produces in `app/src/lib/agent-runs.ts`, used by Task 7:
  - `type AgentRun = { text: string; model: string }`
  - `type AgentRuns = Record<string, AgentRun>`
  - `startRun(runs, chatId, model): AgentRuns`
  - `applyAgentEvent(state, runs, chatId, event): { state; runs; changed: boolean }`
  - `modelForChat(selected, provider, messages, catalog): ModelOption`

- [ ] **Step 1: Add the types to `app/src/model.ts`**

Replace the `AgentSession` interface with:

```ts
export interface AgentSession {
  id: number;
  worktree_id: number;
  agent_name: string;
  status: SessionStatus;
  /** The agent this chat is bound to once it has messages. */
  provider?: ModelProvider;
  /** Claude session id or Codex thread id, used to resume the agent's memory. */
  native_session_id?: string;
}
```

Add to `ChatMessage`:

```ts
  /** How the agent turn that produced this reply ended. */
  outcome?: "completed" | "failed" | "cancelled";
```

Add after the `AgentRequest` interface (Task 7 removes `AgentRequest` once nothing uses it):

```ts
export type AgentEvent =
  | { type: "session-started"; nativeId: string }
  | { type: "session-reset" }
  | { type: "text-delta"; messageId: string | null; text: string }
  | { type: "turn-completed" }
  | { type: "turn-cancelled" }
  | { type: "turn-failed"; message: string };

export interface AgentStartTurnRequest {
  chatId: string;
  provider: ModelProvider;
  model: string;
  cwd: string;
  permissionMode: PermissionMode;
  prompt: string;
  images: ImageAttachment[];
  resumeId?: string;
}
```

- [ ] **Step 2: Let tests import TypeScript files and add them to the test script**

In `tsconfig.json` `compilerOptions`, add:

```json
"allowImportingTsExtensions": true,
```

In `package.json`:

```json
"test:agent": "node --test electron/*.test.cjs electron/agents/*.test.cjs app/src/lib/*.test.ts",
```

- [ ] **Step 3: Write the failing test** `app/src/lib/agent-runs.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { CoordinatorState, ModelOption } from "../model";
import { applyAgentEvent, modelForChat, startRun } from "./agent-runs.ts";

const base = (): CoordinatorState => ({
  next_id: 10,
  projects: {},
  worktrees: {},
  sessions: {
    "1": { id: 1, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex" },
    "2": { id: 2, worktree_id: 1, agent_name: "main", status: "Created", provider: "claude", native_session_id: "s-old" },
  },
  connections: {},
  events: [],
  messages: [],
  approvals: [],
  tasks: {},
  artifacts: {},
  outputs: [],
  conflicts: [],
});

test("saves and forgets the agent's native session id", () => {
  const started = applyAgentEvent(base(), {}, "1", { type: "session-started", nativeId: "thread-1" });
  assert.equal(started.changed, true);
  assert.equal(started.state.sessions["1"].native_session_id, "thread-1");
  assert.equal(applyAgentEvent(started.state, {}, "1", { type: "session-started", nativeId: "thread-1" }).changed, false);

  const reset = applyAgentEvent(base(), {}, "2", { type: "session-reset" });
  assert.equal(reset.changed, true);
  assert.equal("native_session_id" in reset.state.sessions["2"], false);
});

test("streams text per chat and saves each finished reply once", () => {
  let state = base();
  let runs = startRun(startRun({}, "1", "gpt-6-sol"), "2", "claude-opus-5-5");
  for (const [chatId, text] of [["1", "Hel"], ["2", "Hi"], ["1", "lo"], ["2", " there"]] as const) {
    ({ state, runs } = applyAgentEvent(state, runs, chatId, { type: "text-delta", messageId: "t", text }));
  }
  assert.equal(runs["1"].text, "Hello");
  assert.equal(runs["2"].text, "Hi there");

  const first = applyAgentEvent(state, runs, "2", { type: "turn-completed" });
  const second = applyAgentEvent(first.state, first.runs, "1", { type: "turn-completed" });
  assert.equal(second.changed, true);
  assert.deepEqual(second.runs, {});
  assert.deepEqual(second.state.messages.map(({ id, session_id, body, role, model, outcome }) => ({ id, session_id, body, role, model, outcome })), [
    { id: 10, session_id: 2, body: "Hi there", role: "assistant", model: "claude-opus-5-5", outcome: "completed" },
    { id: 11, session_id: 1, body: "Hello", role: "assistant", model: "gpt-6-sol", outcome: "completed" },
  ]);
  assert.equal(second.state.next_id, 12);
});

test("keeps partial text when a turn fails or is cancelled", () => {
  const runs = { "1": { text: "Half an answer", model: "gpt-6-sol" } };
  const failed = applyAgentEvent(base(), runs, "1", { type: "turn-failed", message: "Codex stopped: boom" });
  assert.equal(failed.state.messages[0].body, "Half an answer\n\nAgent error: Codex stopped: boom");
  assert.equal(failed.state.messages[0].outcome, "failed");

  const cancelled = applyAgentEvent(base(), { "1": { text: "", model: "gpt-6-sol" } }, "1", { type: "turn-cancelled" });
  assert.equal(cancelled.state.messages[0].body, "Agent run cancelled.");
  assert.equal(cancelled.state.messages[0].outcome, "cancelled");
});

test("ignores events for chats with nothing running", () => {
  const state = base();
  assert.deepEqual(applyAgentEvent(state, {}, "1", { type: "text-delta", messageId: "t", text: "x" }), { state, runs: {}, changed: false });
  assert.deepEqual(applyAgentEvent(state, {}, "1", { type: "turn-completed" }), { state, runs: {}, changed: false });
});

test("picks a model from the chat's provider", () => {
  const catalog: ModelOption[] = [
    { id: "gpt-6-sol", name: "GPT-6 Sol", provider: "codex", description: "" },
    { id: "claude-opus-5-5", name: "Claude Opus 5.5", provider: "claude", description: "" },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", provider: "claude", description: "" },
  ];
  const [codex, opus, sonnet] = catalog;
  const lastUsed = [{ id: 1, session_id: 2, body: "hi", context: null, role: "user" as const, model: "claude-sonnet-5-5" }];

  assert.equal(modelForChat(codex, undefined, [], catalog), codex);
  assert.equal(modelForChat(opus, "claude", lastUsed, catalog), opus);
  assert.equal(modelForChat(codex, "claude", lastUsed, catalog), sonnet);
  assert.equal(modelForChat(codex, "claude", [], catalog), opus);
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `node --test app/src/lib/agent-runs.test.ts`
Expected: FAIL, with `Cannot find module` for `./agent-runs.ts`.

- [ ] **Step 5: Implement `app/src/lib/agent-runs.ts`**

```ts
import type { AgentEvent, ChatMessage, CoordinatorState, ModelOption, ModelProvider } from "../model";

/** A turn streaming in a chat, keyed by chat (session) id. */
export interface AgentRun {
  text: string;
  model: string;
}

export type AgentRuns = Record<string, AgentRun>;

export function startRun(runs: AgentRuns, chatId: string, model: string): AgentRuns {
  return { ...runs, [chatId]: { text: "", model } };
}

/**
 * Folds one agent event into the saved state and the in-memory runs. `changed` is true when
 * `state` changed and must be saved; streamed text only lives in `runs` until the turn ends.
 */
export function applyAgentEvent(state: CoordinatorState, runs: AgentRuns, chatId: string, event: AgentEvent): { state: CoordinatorState; runs: AgentRuns; changed: boolean } {
  const session = state.sessions[chatId];
  const run = runs[chatId];
  switch (event.type) {
    case "session-started": {
      if (!session || session.native_session_id === event.nativeId) return { state, runs, changed: false };
      return { state: { ...state, sessions: { ...state.sessions, [chatId]: { ...session, native_session_id: event.nativeId } } }, runs, changed: true };
    }
    case "session-reset": {
      if (!session?.native_session_id) return { state, runs, changed: false };
      const { native_session_id: _forgotten, ...rest } = session;
      return { state: { ...state, sessions: { ...state.sessions, [chatId]: rest } }, runs, changed: true };
    }
    case "text-delta": {
      if (!run) return { state, runs, changed: false };
      return { state, runs: { ...runs, [chatId]: { ...run, text: run.text + event.text } }, changed: false };
    }
    default: {
      if (!run) return { state, runs, changed: false };
      const { [chatId]: _finished, ...remaining } = runs;
      const message: ChatMessage = {
        id: state.next_id,
        session_id: Number(chatId),
        body: replyBody(run.text, event),
        context: null,
        role: "assistant",
        model: run.model,
        outcome: event.type === "turn-completed" ? "completed" : event.type === "turn-cancelled" ? "cancelled" : "failed",
      };
      return { state: { ...state, next_id: state.next_id + 1, messages: [...state.messages, message] }, runs: remaining, changed: true };
    }
  }
}

function replyBody(text: string, event: AgentEvent) {
  const reply = text.trim();
  if (event.type === "turn-failed") return reply ? `${reply}\n\nAgent error: ${event.message}` : `Agent error: ${event.message}`;
  if (event.type === "turn-cancelled") return reply ? `${reply}\n\nAgent run cancelled.` : "Agent run cancelled.";
  return reply || "The agent finished without a reply.";
}

/** The model to use for a chat. A chat bound to a provider never runs another provider's model. */
export function modelForChat(selected: ModelOption, provider: ModelProvider | undefined, messages: ChatMessage[], catalog: ModelOption[]): ModelOption {
  if (!provider || selected.provider === provider) return selected;
  const lastUsed = [...messages].reverse().find((message) => catalog.some((option) => option.id === message.model && option.provider === provider));
  return catalog.find((option) => option.id === lastUsed?.model) ?? catalog.find((option) => option.provider === provider) ?? selected;
}
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `node --test app/src/lib/agent-runs.test.ts && npx tsc --noEmit`
Expected: the tests PASS (5 tests) and the typecheck passes.

- [ ] **Step 7: Commit**

```bash
git add app/src/model.ts app/src/lib/agent-runs.ts app/src/lib/agent-runs.test.ts tsconfig.json package.json
git commit -m "feat: fold streamed agent turns into chat history" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

### Task 7: Wire sessions into the app

**Files:**
- Create: `electron/agents/environment.cjs`, `electron/agents/environment.test.cjs`, `app/src/components/useAgentRuns.ts`
- Modify: `electron/main.cjs`, `electron/preload.cjs`, `electron/image-input.cjs`, `electron/image-input.test.cjs`, `app/src/electron.d.ts`, `app/src/App.tsx`, `app/src/components/ChatComposer.tsx`, `app/src/components/PromptComposer.tsx`
- Delete: `electron/agent-runner.cjs`, `electron/agent-runner.test.cjs`

**Interfaces:**
- Consumes:
  - `SessionManager` (Task 5), `ClaudeSession` (Task 4), `CodexSession` (Task 3)
  - `applyAgentEvent`, `startRun`, `modelForChat` and the model types (Task 6)
- Produces:
  - IPC handlers `agent:start-turn` and `agent:interrupt`, and the `agent:event` channel
  - preload `window.milagre.startTurn`, `interruptAgent` and `onAgentEvent`
  - `useAgentRuns(getState, commit)`, returning `{ runs, start, interrupt }`

- [ ] **Step 1: Write the failing `resolveExecutable` test** `electron/agents/environment.test.cjs`

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveExecutable } = require("./environment.cjs");

test("returns the first path which reports", async () => {
  const execFileImpl = (file, args, options, callback) => callback(null, "/opt/homebrew/bin/codex\n/usr/local/bin/codex\n");
  assert.equal(await resolveExecutable("codex", { execFileImpl }), "/opt/homebrew/bin/codex");
});

test("returns null when the CLI isn't installed", async () => {
  const execFileImpl = (file, args, options, callback) => callback(Object.assign(new Error("not found"), { code: 1 }), "");
  assert.equal(await resolveExecutable("codex", { execFileImpl }), null);
});
```

Run: `node --test electron/agents/environment.test.cjs`
Expected: FAIL, with `Cannot find module './environment.cjs'`.

- [ ] **Step 2: Implement `electron/agents/environment.cjs`**

```js
const { execFile } = require("node:child_process");

// Absolute path of a CLI on the app's PATH, or null when it isn't installed. Importing the
// login shell's PATH for apps opened from Finder is part of a later step.
function resolveExecutable(name, { execFileImpl = execFile } = {}) {
  return new Promise((resolve) => {
    execFileImpl("/usr/bin/which", [name], { encoding: "utf8", timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : String(stdout).trim().split("\n")[0] || null);
    });
  });
}

module.exports = { resolveExecutable };
```

Run: `node --test electron/agents/environment.test.cjs`
Expected: PASS, 2 tests.

- [ ] **Step 3: Retire the one-shot runner**

Delete `electron/agent-runner.cjs` and `electron/agent-runner.test.cjs`. In `electron/image-input.cjs`:

- Remove the `fs`, `os`, `path` and `runAgent` requires.
- Remove `runAgentWithImages`.
- End with `module.exports = { decodeImages };`

In `electron/image-input.test.cjs`, keep only the first test ("validates pasted images and rejects unsupported or excessive attachments") and its requires. The other four tested the removed CLI argument building.

Run: `node --test electron/image-input.test.cjs`
Expected: PASS, 1 test.

- [ ] **Step 4: Replace the agent IPC in `electron/main.cjs`**

Replace the `runAgentWithImages` require with:

```js
const { decodeImages } = require("./image-input.cjs");
const { ClaudeSession } = require("./agents/claude-provider.cjs");
const { CodexSession } = require("./agents/codex-provider.cjs");
const { resolveExecutable } = require("./agents/environment.cjs");
const { SessionManager } = require("./agents/session-manager.cjs");
```

Remove `let activeAgentProcess = null;`. Replace the whole `ipcMain.handle("agent:send", …)` and `ipcMain.handle("agent:cancel", …)` blocks with:

```js
const agents = new SessionManager({
  createSession: (provider, options) => (provider === "codex"
    ? new CodexSession({ ...options, clientVersion: app.getVersion() })
    : new ClaudeSession(options)),
  send: (chatId, event) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("agent:event", { chatId, event });
  },
});

// CLI paths are looked up once per run; a missing CLI is looked up again next time.
const executables = new Map();
function executable(name) {
  if (!executables.has(name)) {
    executables.set(name, resolveExecutable(name).then((found) => {
      if (!found) executables.delete(name);
      return found;
    }));
  }
  return executables.get(name);
}

ipcMain.handle("agent:start-turn", async (_event, request) => {
  const images = decodeImages(request.images);
  const prompt = await expandSkillPrompt(request.cwd, request.prompt);
  const command = await executable(request.provider === "codex" ? "codex" : "claude");
  return agents.startTurn({ ...request, prompt, images, command });
});

ipcMain.handle("agent:interrupt", (_event, chatId) => agents.interrupt(chatId));
```

Replace the `window-all-closed` handler with:

```js
app.on("window-all-closed", () => {
  // The renderer saves finished turns, so running turns stop with the last window.
  void agents.closeAll();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void agents.closeAll();
});
```

- [ ] **Step 5: Update the preload bridge and its types**

In `electron/preload.cjs`, replace `sendToAgent` and `cancelAgent` with:

```js
  startTurn: (request) => ipcRenderer.invoke("agent:start-turn", request),
  interruptAgent: (chatId) => ipcRenderer.invoke("agent:interrupt", chatId),
  onAgentEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
```

Remove the `AgentRequest` interface from `app/src/model.ts`; nothing uses it after this step.

In `app/src/electron.d.ts`:

- Change the model import to `import type { AgentEvent, AgentStartTurnRequest, CoordinatorState, OpenProject, SkillCatalog, WorktreeRequest } from "./model";`
- Replace the `sendToAgent` and `cancelAgent` members with:

```ts
      startTurn: (request: AgentStartTurnRequest) => Promise<{ turnId: string | null }>;
      interruptAgent: (chatId: string) => Promise<void>;
      onAgentEvent: (callback: (payload: { chatId: string; event: AgentEvent }) => void) => () => void;
```

- [ ] **Step 6: Add the renderer hook** `app/src/components/useAgentRuns.ts`

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, AgentStartTurnRequest, CoordinatorState } from "../model";
import { applyAgentEvent, startRun } from "../lib/agent-runs";
import type { AgentRuns } from "../lib/agent-runs";

/** Streams agent turns per chat and saves each finished turn into the project state. */
export function useAgentRuns(getState: () => CoordinatorState | null, commit: (next: CoordinatorState) => void) {
  const [runs, setRuns] = useState<AgentRuns>({});
  const runsRef = useRef(runs);
  const getStateRef = useRef(getState);
  const commitRef = useRef(commit);
  getStateRef.current = getState;
  commitRef.current = commit;

  const apply = useCallback((chatId: string, event: AgentEvent) => {
    const state = getStateRef.current();
    if (!state) return;
    const result = applyAgentEvent(state, runsRef.current, chatId, event);
    runsRef.current = result.runs;
    setRuns(result.runs);
    if (result.changed) commitRef.current(result.state);
  }, []);

  useEffect(() => window.milagre.onAgentEvent(({ chatId, event }) => apply(chatId, event)), [apply]);

  const start = useCallback(async (request: AgentStartTurnRequest) => {
    runsRef.current = startRun(runsRef.current, request.chatId, request.model);
    setRuns(runsRef.current);
    try {
      await window.milagre.startTurn(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      apply(request.chatId, { type: "turn-failed", message: message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") });
    }
  }, [apply]);

  const interrupt = useCallback((chatId: string) => window.milagre.interruptAgent(chatId), []);

  return { runs, start, interrupt };
}
```

- [ ] **Step 7: Switch `App.tsx` to per-chat runs**

In `app/src/App.tsx`:

1. Import `useAgentRuns` from `./components/useAgentRuns` and `modelForChat` from `./lib/agent-runs`.
2. Replace `const [isSending, setIsSending] = useState(false);` with `const [preparing, setPreparing] = useState(false);`.
3. After the `state` declaration, add the ref and a single place that saves:

```ts
  const stateRef = useRef<CoordinatorState | null>(null);
  stateRef.current = state;
```

4. Replace `persist` with:

```ts
  // Every state change goes through here, so turns finishing in two chats can't overwrite each other.
  function commit(next: CoordinatorState) {
    stateRef.current = next;
    setState(next);
    if (project) void window.milagre.saveProject(project.path, next);
  }

  async function persist(nextState: CoordinatorState) {
    commit(nextState);
  }
```

5. After `messages` is defined, add:

```ts
  const agentRuns = useAgentRuns(() => stateRef.current, commit);
  const run = selectedSession ? agentRuns.runs[String(selectedSession.id)] : undefined;
  const isSending = preparing || Boolean(run);

  // A chat stays on the agent it started with; the picker follows the open chat.
  useEffect(() => {
    if (!selectedSession?.provider) return;
    const next = modelForChat(selectedModel, selectedSession.provider, messages, MODEL_CATALOG);
    if (next.id !== selectedModel.id) setSelectedModel(next);
  }, [selectedSession?.id, selectedSession?.provider]);
```

6. In `executeSend`, replace `setIsSending(true)` with `setPreparing(true)`, and each `setIsSending(false)` before a `return` with `setPreparing(false)`. Replace everything from `const userMessage = {` to the end of the function with:

```ts
    const model = modelForChat(selectedModel, session.provider, baseState.messages.filter((message) => message.session_id === session.id), MODEL_CATALOG);
    const userMessage = {
      id: baseState.next_id,
      session_id: session.id,
      body,
      images,
      context: null,
      role: "user" as const,
      model: model.id,
    };
    commit({
      ...baseState,
      next_id: baseState.next_id + 1,
      messages: [...baseState.messages, userMessage],
      sessions: { ...baseState.sessions, [session.id]: { ...session, provider: model.provider } },
    });
    setDraft("");
    imageDraft.clear();
    setPreparing(false);
    await agentRuns.start({
      chatId: String(session.id),
      provider: model.provider,
      model: model.id,
      cwd: worktree.path,
      permissionMode: mode,
      prompt: body || "Describe the attached images.",
      images,
      resumeId: session.native_session_id,
    });
  }
```

7. In the Escape handler, replace the `if (isSending) { … cancelAgent … }` block with:

```ts
      if (run && selectedSession) {
        event.preventDefault();
        void agentRuns.interrupt(String(selectedSession.id));
      }
```

   Then change its dependency list to `[approvalPrompt, run, selectedSession?.id, view]`.

8. Pass the live reply and the provider lock to the composer. On `<ChatComposer`, add:

```tsx
            streamingText={run?.text}
            lockedProvider={messages.length > 0 ? selectedSession?.provider : undefined}
```

- [ ] **Step 8: Render the live reply and lock the provider tab**

In `app/src/components/ChatComposer.tsx`:

- Add `import type { ModelProvider } from "../model";` (or extend the existing model type import).
- Add props `streamingText?: string;` and `lockedProvider?: ModelProvider;`, and destructure both.
- Change the scroller's `autoScrollKey` to `` `${messages.length}-${isSending}-${streamingText?.length ?? 0}` ``.
- Replace the `{isSending && (…ThinkingIndicator…)}` block with:

```tsx
            {isSending && streamingText && (
              <MessageSection
                message={{ id: -1, session_id: messages.at(-1)?.session_id ?? -1, body: streamingText, context: null, role: "assistant" }}
                session={sessions[String(messages.at(-1)?.session_id)]}
                isUser={false}
                modelName={selectedModel.name}
              />
            )}
            {isSending && (
              <div className="w-full" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
                <ThinkingIndicator label={`Working with ${selectedModel.name}`} />
              </div>
            )}
```

- Pass `lockedProvider={lockedProvider}` to `<PromptComposer`.

In `app/src/components/PromptComposer.tsx`:

- Add `lockedProvider?: ModelProvider;` to `PromptComposerProps` and destructure it.
- In the provider tab buttons (`(["codex", "claude"] as ModelProvider[]).map((item) => <button …`), add:

```tsx
disabled={lockedProvider !== undefined && item !== lockedProvider}
title={lockedProvider !== undefined && item !== lockedProvider ? `This chat runs on ${lockedProvider === "codex" ? "Codex" : "Claude"}. Start a new chat to use ${item === "codex" ? "Codex" : "Claude"}.` : undefined}
```

- Append `disabled:cursor-not-allowed disabled:opacity-40` to that button's className.

- [ ] **Step 9: Run every check**

Run: `npm run typecheck && npm run test:agent && npm run build`
Expected: the typecheck passes; every test passes (the old runner's tests are gone, the new agent and renderer tests pass); the build ends with `✓ built in`.

- [ ] **Step 10: Verify in Electron with the real CLIs**

Restart the dev app (`npm run dev`); the main process and preload changed. Then check each of these:

1. New chat, Codex (`gpt-6-sol`): send "Remember the word mango". The reply streams in. Send "Which word?" and the reply is "mango".
2. Quit Milagre, run `npm run dev` again, open the same chat and send "Which word?". The reply is still "mango", because the session resumed.
3. Repeat steps 1 and 2 with a Claude model in a new chat.
4. Start a long request ("Write 40 numbered lines about Lisbon") and press Escape mid-stream. The partial text stays, followed by "Agent run cancelled.", and the chat accepts a new message.
5. Start a long request in one chat, switch to another chat, and send there. Both stream, and both replies are saved under their own chats.
6. In a chat with messages, open the model picker. The other provider's tab is disabled, with the explanation as its tooltip.
7. Ask mode with "delete the README". Milagre's pre-run approval card still appears first.

- [ ] **Step 11: Commit**

```bash
git add -A electron app/src
git commit -m "feat: stream agent replies from one session per chat" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

### Task 8: Documentation and pull request

**Files:**
- Modify: `README.md`, `docs/specs/002-agent-sessions.md`

- [ ] **Step 1: Update the README**

In "What exists today", replace "Codex and Claude CLI process integration through Electron's main process." with:

> One long-lived agent session per chat, run by Electron's main process: Claude through the Claude Agent SDK and Codex through `codex app-server`. Replies stream in, chats remember earlier turns after a restart, and Escape cancels a running turn.

- [ ] **Step 2: Record two refinements in the spec**

In `docs/specs/002-agent-sessions.md`:

- Under "Event stream", add `- \`session-reset\`: the saved native id can't be resumed (transcript or thread deleted). The renderer forgets it and the next message starts a fresh session.`
- Under "Persistence", replace the sentence about a turn interrupted by quitting with: `A turn still running when the last window closes or the app quits is interrupted; the user's message is already saved, but its partial reply is not.`

- [ ] **Step 3: Commit and open the pull request**

```bash
git add README.md docs/specs/002-agent-sessions.md
git commit -m "docs: describe agent sessions" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
git push -u fork agent-sessions
```

Open the PR against `marcosgenesis/milagre-ade` `main`, titled `feat: keep one agent session per chat with streamed replies`.

- Note at the top that it builds on #8 and #10, and link a compare view of only this branch's commits.
- Use the repository's PR template.
- List the checks from Task 7 Step 10.
- End the body with `https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5`.
