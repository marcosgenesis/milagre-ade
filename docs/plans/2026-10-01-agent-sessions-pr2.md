# Agent Sessions PR 2: Real Approvals and Steering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents stop and ask before the commands and edits Milagre's permission mode doesn't already allow, showing the exact command or change. A message sent while a turn runs steers that turn instead of being refused.

**Architecture:**

- **Shared approval code.** A new `electron/agents/permissions.cjs` holds two things:
  - the pending-request bookkeeping both providers share;
  - pure functions that turn each agent's request into a `permission-request` event, and the user's answer into the reply that agent expects.
- **Claude.** `canUseTool` turns each check into a pending promise that the user's answer settles.
- **Codex.** The server's `requestApproval` calls are answered the same way.
- **Steering.**
  - Both sessions' `startTurn` steer when a turn is already running.
  - Claude: the message is pushed into the running query.
  - Codex: the message is sent with `turn/steer`.
  - A new `turn-started` event lets the renderer show turns it didn't start itself.
- **Renderer.**
  - It keeps pending approvals on each chat's run and shows the oldest one with the existing `ToolApproval` card.
  - A message sent mid-turn saves the reply streamed so far, then steers the turn.

**Tech Stack:** Electron main process in CommonJS (`.cjs`), `@anthropic-ai/claude-agent-sdk@0.3.286`, `codex app-server` (codex-cli 0.158.0), React 19 + TypeScript renderer, `node --test`.

**Spec:** `docs/specs/002-agent-sessions.md`, delivery step 2 ("Real approvals and steering"). The spec was amended on this branch (commit `docs: bring steering into the agent sessions spec`) to bring steering into scope. Read the sections "Event stream", "Claude provider", "Codex provider", "Steering" and "Renderer" before starting.

## Global Constraints

- **Main process.**
  - It stays CommonJS.
  - `@anthropic-ai/claude-agent-sdk` stays pinned to exactly `0.3.286`.
  - No new dependencies.
- **Mode mapping**, exactly:

  | Milagre mode | Claude `permissionMode` | Codex `approvalPolicy` | Codex `sandbox` |
  | --- | --- | --- | --- |
  | Ask | `default` | `untrusted` | `workspace-write` |
  | Auto | `acceptEdits` | `on-request` | `workspace-write` |
  | Full | `bypassPermissions` | `never` | `danger-full-access` |

  An unknown mode falls back to Ask's values.
- **No time limit on approvals.** Turns and permission waits have no timeout.
- **Decisions.**
  - The user's decision is one of `"allow"`, `"allow-for-chat"` or `"deny"`. `permission-resolved` may also carry `"cancelled"`.
  - The main process rejects any other value coming from the renderer.
- **Claude replies.**
  - A denial is `{ behavior: "deny", message: "Denied in Milagre" }`.
  - A cancelled request is `{ behavior: "deny", message: "The turn was cancelled in Milagre.", interrupt: true }`.
- **Codex replies.** `allow` → `accept`, `allow-for-chat` → `acceptForSession`, `deny` → `decline`, `cancelled` → `cancel`.
- **Always allow in this chat.**
  - For Claude, it applies the SDK's suggestions with every `destination` rewritten to `"session"`.
  - It never writes to the user's settings files.
  - It is offered only when the SDK passed suggestions and didn't set `suppressAlwaysAllowRule`.
- **Card text.**
  - Card buttons read `Allow once`, `Always allow in this chat` and `Deny`.
  - `diff` and `detail` on a request are capped at 20,000 characters, with a `… truncated` line.
- **Steering.** A steering message ignores model and permission-mode changes; those apply from the next turn.
- **Saved data.** `coordination.json` changes stay additive. This PR adds none.
- **Tests.**
  - Agent tests live next to the code (`electron/agents/*.test.cjs`). Renderer logic tests are `app/src/lib/*.test.ts`.
  - `npm run test:agent` runs them all, and `npm run build` must stay clean (it includes `tsc --noEmit`).
- **Commits.** Every commit message ends with the line `Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5`.

## Review Focus

1. **Several approvals at once.** Claude can ask about parallel tool calls together.
   - Expected: the card shows the oldest request and how many are waiting, and each is answered once, in order.
   - Pinned in Task 1 (each request answers once) and Task 6 (the run keeps requests in arrival order).
2. **Answering a request that's already gone.** Causes: a double click, Escape pressed twice, or the turn ending first.
   - Expected: nothing happens and nothing throws.
   - Pinned in Task 1 (`resolve` on an unknown id), Tasks 2–3 (unknown request ids) and Task 5 (unknown chat).
3. **A steering message that arrives as the turn ends.**
   - Expected: the message still gets an answer, as a turn of its own, and nothing is left in a "working" state.
   - Pinned in Task 4 (Claude's implicit turn; Codex refusing `turn/steer`) and Task 6 (`turn-started` opens a run).
4. **Interrupt or reload while an approval is pending.**
   - Expected: the card disappears, the turn ends as cancelled, and the agent is not left waiting.
   - Pinned in Tasks 2–3 (pending requests cancelled on interrupt), Task 5 (`interruptAll`) and Task 6 (`permission-resolved` removes the card).
5. **"Always allow in this chat" for Claude.**
   - Expected: it must never persist a rule to `~/.claude/settings.json` or the project's settings.
   - Pinned in Task 1 (destinations rewritten to `session`).

---

### Task 1: Approval bookkeeping and mapping

**Files:**
- Create: `electron/agents/permissions.cjs`
- Test: `electron/agents/permissions.test.cjs`

**Interfaces:**
- Produces, in `electron/agents/permissions.cjs`:
  - `class PendingPermissions`:
    - `constructor(emit)`
    - `add(request, answer)` emits `{ type: "permission-request", ...request }`.
    - `resolve(requestId, decision): boolean` calls `answer(decision)` once and emits `{ type: "permission-resolved", requestId, decision }`.
    - `forget(requestId): boolean` emits a `cancelled` resolution without answering.
    - `cancelAll()` resolves every pending request as `"cancelled"`.
    - `size` getter.
  - `claudeRequest(toolName, input, options) → PermissionRequest`
  - `claudeResult(decision, input, suggestions) → SDK PermissionResult`
  - `codexCommandRequest(id, params) → PermissionRequest`
  - `codexFileRequest(id, params, changes) → PermissionRequest`
  - `codexDecision(decision) → string`
  - `unwrapShell(command) → string`
  - `capText(text) → string`
  - Constants: `DENIED_MESSAGE`, `CANCELLED_MESSAGE`, `USER_DECISIONS` (a `Set`).
- A `PermissionRequest` is a plain object with no `undefined` values:
  `{ requestId, kind: "command"|"edit"|"other", tool, title, description?, command?, cwd?, diff?, files?, detail?, reason?, allowForChat }`.

- [ ] **Step 1: Write the failing tests**

Create `electron/agents/permissions.test.cjs`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CANCELLED_MESSAGE,
  DENIED_MESSAGE,
  PendingPermissions,
  capText,
  claudeRequest,
  claudeResult,
  codexCommandRequest,
  codexDecision,
  codexFileRequest,
  unwrapShell,
} = require("./permissions.cjs");

function pending() {
  const events = [];
  const answers = [];
  const permissions = new PendingPermissions((event) => events.push(event));
  const ask = (requestId) => permissions.add({ requestId, kind: "other", tool: "T", title: "Allow?", allowForChat: false }, (decision) => answers.push({ requestId, decision }));
  return { permissions, events, answers, ask };
}

test("each request is announced, then answered exactly once", () => {
  const { permissions, events, answers, ask } = pending();
  ask("a");
  assert.equal(permissions.size, 1);
  assert.equal(permissions.resolve("a", "allow"), true);
  assert.equal(permissions.resolve("a", "deny"), false);
  assert.equal(permissions.resolve("missing", "allow"), false);
  assert.deepEqual(answers, [{ requestId: "a", decision: "allow" }]);
  assert.deepEqual(events, [
    { type: "permission-request", requestId: "a", kind: "other", tool: "T", title: "Allow?", allowForChat: false },
    { type: "permission-resolved", requestId: "a", decision: "allow" },
  ]);
  assert.equal(permissions.size, 0);
});

test("cancelAll answers every waiting request as cancelled", () => {
  const { permissions, events, answers, ask } = pending();
  ask("a");
  ask("b");
  permissions.cancelAll();
  assert.deepEqual(answers.map((answer) => answer.decision), ["cancelled", "cancelled"]);
  assert.deepEqual(events.filter((event) => event.type === "permission-resolved").map((event) => event.requestId), ["a", "b"]);
  assert.equal(permissions.size, 0);
});

test("forget drops a withdrawn request without answering it", () => {
  const { permissions, events, answers, ask } = pending();
  ask("a");
  assert.equal(permissions.forget("a"), true);
  assert.equal(permissions.forget("a"), false);
  assert.deepEqual(answers, []);
  assert.deepEqual(events.at(-1), { type: "permission-resolved", requestId: "a", decision: "cancelled" });
});

test("Claude: a shell command shows the command", () => {
  const request = claudeRequest("Bash", { command: "npm test", description: "Run tests" }, { requestId: "r1", toolUseID: "t1", suggestions: [{ type: "addRules" }] });
  assert.deepEqual(request, { requestId: "r1", kind: "command", tool: "Bash", title: "Run this command?", command: "npm test", allowForChat: true });
});

test("Claude: edits show the file and a diff", () => {
  const write = claudeRequest("Write", { file_path: "/repo/hello.txt", content: "hi\nthere" }, { requestId: "r1" });
  assert.deepEqual(write, { requestId: "r1", kind: "edit", tool: "Write", title: "Write hello.txt?", files: ["/repo/hello.txt"], diff: "+hi\n+there", allowForChat: false });
  const edit = claudeRequest("Edit", { file_path: "/repo/a.ts", old_string: "let a", new_string: "const a" }, { requestId: "r2" });
  assert.equal(edit.title, "Edit a.ts?");
  assert.equal(edit.diff, "-let a\n+const a");
  const multi = claudeRequest("MultiEdit", { file_path: "/repo/a.ts", edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] }, { requestId: "r3" });
  assert.equal(multi.diff, "-a\n+b\n@@\n-c\n+d");
});

test("Claude: other tools show their input, and the SDK's own wording wins", () => {
  const fetch = claudeRequest("WebFetch", { url: "https://example.com" }, { requestId: "r1" });
  assert.equal(fetch.kind, "other");
  assert.equal(fetch.title, "Use WebFetch?");
  assert.equal(fetch.detail, JSON.stringify({ url: "https://example.com" }, null, 2));
  const worded = claudeRequest("Read", { file_path: "/etc/hosts" }, { requestId: "r2", title: "Claude wants to read hosts", displayName: "Read file", description: "Outside the project", decisionReason: "Not in the allow list" });
  assert.equal(worded.title, "Claude wants to read hosts");
  assert.equal(worded.tool, "Read file");
  assert.equal(worded.description, "Outside the project");
  assert.equal(worded.reason, "Not in the allow list");
  const blocked = claudeRequest("Bash", { command: "cat ~/x" }, { requestId: "r3", blockedPath: "/Users/me/x" });
  assert.equal(blocked.reason, "Reaches outside this chat's folder: /Users/me/x");
});

test("Claude: always-allow is offered only with suggestions the SDK lets us keep", () => {
  const suggestions = [{ type: "setMode", mode: "acceptEdits", destination: "session" }];
  assert.equal(claudeRequest("Write", { file_path: "/a" }, { requestId: "r", suggestions }).allowForChat, true);
  assert.equal(claudeRequest("Write", { file_path: "/a" }, { requestId: "r", suggestions: [] }).allowForChat, false);
  assert.equal(claudeRequest("Write", { file_path: "/a" }, { requestId: "r", suggestions, suppressAlwaysAllowRule: true }).allowForChat, false);
});

test("Claude: answers become SDK permission results, and chat-wide rules stay in the session", () => {
  const input = { command: "npm test" };
  const suggestions = [
    { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "localSettings" },
    { type: "setMode", mode: "acceptEdits", destination: "userSettings" },
  ];
  assert.deepEqual(claudeResult("allow", input, suggestions), { behavior: "allow", updatedInput: input });
  assert.deepEqual(claudeResult("allow-for-chat", input, suggestions), {
    behavior: "allow",
    updatedInput: input,
    updatedPermissions: [
      { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "session" },
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ],
  });
  assert.deepEqual(claudeResult("deny", input, suggestions), { behavior: "deny", message: DENIED_MESSAGE });
  assert.deepEqual(claudeResult("cancelled", input, suggestions), { behavior: "deny", message: CANCELLED_MESSAGE, interrupt: true });
  assert.equal(DENIED_MESSAGE, "Denied in Milagre");
});

test("Codex: the shell wrapper is removed from commands", () => {
  assert.equal(unwrapShell("/bin/zsh -lc 'ls -la'"), "ls -la");
  assert.equal(unwrapShell("/bin/bash -lc 'echo '\\''hi'\\'''"), "echo 'hi'");
  assert.equal(unwrapShell("git status"), "git status");
});

test("Codex: command requests", () => {
  assert.deepEqual(codexCommandRequest("srv-1", { itemId: "c", command: "/bin/zsh -lc 'rm -rf build'", cwd: "/repo", reason: "Clean the build" }), {
    requestId: "srv-1", kind: "command", tool: "Shell", title: "Run this command?", command: "rm -rf build", cwd: "/repo", reason: "Clean the build", allowForChat: true,
  });
  assert.deepEqual(codexCommandRequest(7, { command: "curl x", reason: null, networkApprovalContext: { host: "example.com", protocol: "https" } }), {
    requestId: "7", kind: "command", tool: "Shell", title: "Allow network access to example.com?", command: "curl x", allowForChat: true,
  });
});

test("Codex: file requests show the changes Codex reported when the edit started", () => {
  const changes = [{ path: "/repo/notes.txt", kind: { type: "add" }, diff: "+hello\n" }];
  assert.deepEqual(codexFileRequest("srv-2", { itemId: "p", reason: "Write notes" }, changes), {
    requestId: "srv-2", kind: "edit", tool: "Edit files", title: "Edit notes.txt?", files: ["/repo/notes.txt"], diff: "--- /repo/notes.txt\n+hello\n", reason: "Write notes", allowForChat: true,
  });
  assert.equal(codexFileRequest("s", {}, [changes[0], { path: "/repo/b", diff: "" }]).title, "Edit 2 files?");
  assert.deepEqual(codexFileRequest("s", { grantRoot: "/tmp/out" }, undefined), { requestId: "s", kind: "edit", tool: "Edit files", title: "Allow writing to /tmp/out?", files: [], allowForChat: true });
});

test("Codex: decisions", () => {
  assert.deepEqual(["allow", "allow-for-chat", "deny", "cancelled"].map(codexDecision), ["accept", "acceptForSession", "decline", "cancel"]);
});

test("long diffs and details are capped", () => {
  assert.equal(capText("short"), "short");
  const long = capText("x".repeat(25_000));
  assert.equal(long.length, 20_000 + "\n… truncated".length);
  assert.ok(long.endsWith("\n… truncated"));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test electron/agents/permissions.test.cjs`
Expected: FAIL with `Cannot find module './permissions.cjs'`.

- [ ] **Step 3: Implement `permissions.cjs`**

Create `electron/agents/permissions.cjs`:

```js
const path = require("node:path");

// Approval requests from both agents, in the shape of the `permission-request` event, and the
// replies each agent expects for the user's answer. A request is
//   { requestId, kind: "command"|"edit"|"other", tool, title, description?, command?, cwd?,
//     diff?, files?, detail?, reason?, allowForChat }
// and a decision is "allow" | "allow-for-chat" | "deny", or "cancelled" when the turn stops first.

const DENIED_MESSAGE = "Denied in Milagre";
const CANCELLED_MESSAGE = "The turn was cancelled in Milagre.";
const USER_DECISIONS = new Set(["allow", "allow-for-chat", "deny"]);
const MAX_TEXT = 20_000;
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

function capText(text) {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n… truncated` : text;
}

// Drops undefined fields so requests stay plain and compare cleanly.
function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

const prefixLines = (text, prefix) => String(text ?? "").split("\n").map((line) => `${prefix}${line}`).join("\n");
const replaced = (oldText, newText) => `${prefixLines(oldText, "-")}\n${prefixLines(newText, "+")}`;

// Claude's edit tools carry the whole change in their input; show it as a minimal diff.
function claudeEditDiff(toolName, input) {
  if (toolName === "Edit") return capText(replaced(input.old_string, input.new_string));
  if (toolName === "MultiEdit") return capText((input.edits ?? []).map((edit) => replaced(edit.old_string, edit.new_string)).join("\n@@\n"));
  if (toolName === "Write") return capText(prefixLines(input.content, "+"));
  return capText(prefixLines(input.new_source, "+"));
}

// canUseTool(toolName, input, options) -> request. The SDK's own title, displayName and description win.
function claudeRequest(toolName, input, options = {}) {
  const base = {
    requestId: String(options.requestId ?? options.toolUseID),
    tool: options.displayName || toolName,
    description: options.description || undefined,
    reason: options.decisionReason || (options.blockedPath ? `Reaches outside this chat's folder: ${options.blockedPath}` : undefined),
    allowForChat: Boolean(options.suggestions?.length) && !options.suppressAlwaysAllowRule,
  };
  if (toolName === "Bash") return compact({ ...base, kind: "command", title: options.title || "Run this command?", command: String(input.command ?? "") });
  if (EDIT_TOOLS.has(toolName)) {
    const file = String(input.file_path ?? input.notebook_path ?? "");
    const verb = toolName === "Write" ? "Write" : "Edit";
    return compact({ ...base, kind: "edit", title: options.title || `${verb} ${path.basename(file) || "a file"}?`, files: file ? [file] : [], diff: claudeEditDiff(toolName, input) });
  }
  return compact({ ...base, kind: "other", title: options.title || `Use ${toolName}?`, detail: capText(JSON.stringify(input, null, 2)) });
}

// The user's answer -> the SDK's PermissionResult. Chat-wide rules are kept in the session only,
// so they never reach the user's settings files.
function claudeResult(decision, input, suggestions = []) {
  if (decision === "allow") return { behavior: "allow", updatedInput: input };
  if (decision === "allow-for-chat") return { behavior: "allow", updatedInput: input, updatedPermissions: suggestions.map((update) => ({ ...update, destination: "session" })) };
  if (decision === "cancelled") return { behavior: "deny", message: CANCELLED_MESSAGE, interrupt: true };
  return { behavior: "deny", message: DENIED_MESSAGE };
}

// Codex runs commands through the user's login shell: `/bin/zsh -lc 'npm test'`. The card shows `npm test`.
function unwrapShell(command) {
  const match = /^\/(?:usr\/)?bin\/(?:ba|z)?sh -lc '((?:[^']|'\\'')*)'$/.exec(command);
  return match ? match[1].replace(/'\\''/g, "'") : command;
}

// item/commandExecution/requestApproval params -> request.
function codexCommandRequest(id, params) {
  const host = params.networkApprovalContext?.host;
  return compact({
    requestId: String(id),
    kind: "command",
    tool: "Shell",
    title: host ? `Allow network access to ${host}?` : "Run this command?",
    command: unwrapShell(String(params.command ?? "")),
    cwd: params.cwd ?? undefined,
    reason: params.reason ?? undefined,
    allowForChat: true,
  });
}

// item/fileChange/requestApproval params -> request. The request has no diff of its own; `changes`
// are the ones the matching fileChange item reported in item/started.
function codexFileRequest(id, params, changes = []) {
  const files = changes.map((change) => change.path);
  const title = params.grantRoot
    ? `Allow writing to ${params.grantRoot}?`
    : files.length === 1 ? `Edit ${path.basename(files[0])}?` : files.length ? `Edit ${files.length} files?` : "Edit files?";
  return compact({
    requestId: String(id),
    kind: "edit",
    tool: "Edit files",
    title,
    files,
    diff: changes.length ? capText(changes.map((change) => `--- ${change.path}\n${change.diff ?? ""}`).join("\n")) : undefined,
    reason: params.reason ?? undefined,
    allowForChat: true,
  });
}

const CODEX_DECISIONS = { allow: "accept", "allow-for-chat": "acceptForSession", deny: "decline", cancelled: "cancel" };

function codexDecision(decision) {
  return CODEX_DECISIONS[decision] ?? "decline";
}

// The approval requests a session is waiting on. Each is answered exactly once: by the user, or as
// cancelled when its turn stops. `forget` drops one the agent withdrew without replying to it.
class PendingPermissions {
  constructor(emit) {
    this.emit = emit;
    this.answers = new Map();
  }

  get size() {
    return this.answers.size;
  }

  add(request, answer) {
    this.answers.set(request.requestId, answer);
    this.emit({ type: "permission-request", ...request });
  }

  resolve(requestId, decision) {
    const answer = this.answers.get(requestId);
    if (!answer) return false;
    this.answers.delete(requestId);
    answer(decision);
    this.emit({ type: "permission-resolved", requestId, decision });
    return true;
  }

  forget(requestId) {
    if (!this.answers.delete(requestId)) return false;
    this.emit({ type: "permission-resolved", requestId, decision: "cancelled" });
    return true;
  }

  cancelAll() {
    for (const requestId of [...this.answers.keys()]) this.resolve(requestId, "cancelled");
  }
}

module.exports = {
  CANCELLED_MESSAGE,
  DENIED_MESSAGE,
  USER_DECISIONS,
  PendingPermissions,
  capText,
  claudeRequest,
  claudeResult,
  codexCommandRequest,
  codexDecision,
  codexFileRequest,
  unwrapShell,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test electron/agents/permissions.test.cjs`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/agents/permissions.cjs electron/agents/permissions.test.cjs
git commit -m "feat: map agent approval requests and answers" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 2: Claude approvals

**Files:**
- Modify: `electron/agents/claude-provider.cjs`
- Test: `electron/agents/claude-provider.test.cjs`

**Interfaces:**
- Consumes: `PendingPermissions`, `claudeRequest`, `claudeResult` from Task 1.
- Produces:
  - `ClaudeSession#respondToPermission(requestId, decision): boolean`
  - `CLAUDE_MODES` becomes `{ ask: "default", auto: "acceptEdits", full: "bypassPermissions" }`.
  - The query options gain `canUseTool` and `disallowedTools: ["AskUserQuestion"]`.

- [ ] **Step 1: Teach the fake SDK to ask and abort**

In `electron/agents/claude-provider.test.cjs`, replace `fakeSdk` with a version that hands each script the query options, an abort signal (aborted on interrupt) and a way to read the next streamed message:

```js
// Stands in for the SDK's query(): consumes the streaming prompt and plays a script per message.
// Scripts get the query options (for canUseTool), an abort signal that interrupt() trips, a gate
// the test opens with calls.release(), and next() to read a message sent while they run.
function fakeSdk(script) {
  const calls = { options: null, queries: 0, prompts: [], models: [], modes: [], interrupts: 0, release: () => {} };
  const query = ({ prompt, options }) => {
    calls.queries += 1;
    calls.options = options;
    let markInterrupted;
    const interrupted = new Promise((resolve) => { markInterrupted = resolve; });
    const released = new Promise((resolve) => { calls.release = resolve; });
    const controller = new AbortController();
    const messages = prompt[Symbol.asyncIterator]();
    const next = async () => {
      const { value } = await messages.next();
      if (value) calls.prompts.push(value);
      return value;
    };
    async function* run() {
      while (await next()) yield* script({ interrupted, released, options, signal: controller.signal, next });
    }
    return Object.assign(run(), {
      interrupt: async () => { calls.interrupts += 1; controller.abort(); markInterrupted(); },
      setModel: async (model) => { calls.models.push(model); },
      setPermissionMode: async (mode) => { calls.modes.push(mode); },
    });
  };
  return { calls, loadSdk: async () => ({ query }) };
}
```

Add this script to `scripts`:

```js
  async *asks({ options, signal }) {
    yield init;
    const result = await options.canUseTool("Write", { file_path: "/repo/hello.txt", content: "hi" }, {
      signal,
      requestId: "req-1",
      toolUseID: "tool-1",
      suggestions: [{ type: "addRules", rules: [{ toolName: "Write" }], behavior: "allow", destination: "localSettings" }],
    });
    yield delta(JSON.stringify(result));
    yield success;
  },
```

- [ ] **Step 2: Write the failing tests**

In the test "starts with Milagre's options and streams a reply", add after the `systemPrompt` assertion:

```js
  assert.equal(typeof calls.options.canUseTool, "function");
  assert.deepEqual(calls.options.disallowedTools, ["AskUserQuestion"]);
```

Append these tests:

```js
const asked = (events) => waitUntil(() => events.some((event) => event.type === "permission-request"));
const replyText = (events) => events.filter((event) => event.type === "text-delta").map((event) => event.text).join("");

test("Ask mode lets Claude Code check with the user", async (t) => {
  const { session, events, calls } = claude(t);
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await ended(events);
  assert.equal(calls.options.permissionMode, "default");
});

test("asks before a tool runs and passes the answer back", async (t) => {
  const { session, events } = claude(t, { script: scripts.asks });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  assert.deepEqual(events.find((event) => event.type === "permission-request"), {
    type: "permission-request", requestId: "req-1", kind: "edit", tool: "Write", title: "Write hello.txt?", files: ["/repo/hello.txt"], diff: "+hi", allowForChat: true,
  });
  assert.equal(session.respondToPermission("req-1", "allow"), true);
  await ended(events);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "allow", updatedInput: { file_path: "/repo/hello.txt", content: "hi" } });
  const types = events.map((event) => event.type);
  assert.ok(types.indexOf("permission-resolved") < types.indexOf("turn-completed"));
  assert.deepEqual(events.find((event) => event.type === "permission-resolved"), { type: "permission-resolved", requestId: "req-1", decision: "allow" });
});

test("always allowing in this chat keeps the rule in the session", async (t) => {
  const { session, events } = claude(t, { script: scripts.asks });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  session.respondToPermission("req-1", "allow-for-chat");
  await ended(events);
  assert.deepEqual(JSON.parse(replyText(events)).updatedPermissions, [{ type: "addRules", rules: [{ toolName: "Write" }], behavior: "allow", destination: "session" }]);
});

test("denying tells Claude it was denied in Milagre", async (t) => {
  const { session, events } = claude(t, { script: scripts.asks });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  session.respondToPermission("req-1", "deny");
  await ended(events);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "deny", message: "Denied in Milagre" });
});

test("interrupting cancels a pending approval", async (t) => {
  const { session, events } = claude(t, { script: scripts.asks });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  await session.interrupt();
  await ended(events);
  assert.deepEqual(events.find((event) => event.type === "permission-resolved"), { type: "permission-resolved", requestId: "req-1", decision: "cancelled" });
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
  assert.equal(session.respondToPermission("req-1", "allow"), false);
});

test("closing cancels a pending approval", async (t) => {
  const { session, events } = claude(t, { script: scripts.asks });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  await session.close();
  assert.ok(events.some((event) => event.type === "permission-resolved" && event.decision === "cancelled"));
  // The script may still flush its last text while the query closes, so check the ending, not the order.
  assert.deepEqual(events.filter(isTerminal), [{ type: "turn-cancelled" }]);
});

test("an answer for an unknown request changes nothing", async (t) => {
  const { session } = claude(t);
  assert.equal(session.respondToPermission("nope", "allow"), false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test electron/agents/claude-provider.test.cjs`
Expected: FAIL. `canUseTool` is undefined, `permissionMode` is `acceptEdits` instead of `default`, and `respondToPermission` is not a function.

- [ ] **Step 4: Implement approvals in `claude-provider.cjs`**

1. Below the existing `require` lines, add:

```js
const { PendingPermissions, claudeRequest, claudeResult } = require("./permissions.cjs");
```

2. Replace the mode comment and constant:

```js
// Milagre permission mode -> Claude Code permission mode. In Ask (`default`) Claude Code checks with
// the user, through canUseTool, before edits and commands its rules don't already allow.
const CLAUDE_MODES = { ask: "default", auto: "acceptEdits", full: "bypassPermissions" };
```

3. In the constructor, after `this.closed = false;`, add:

```js
    this.permissions = new PendingPermissions((event) => this.emit(event));
```

4. In `startTurn`, change the fallback mode from `"acceptEdits"` to `"default"`:

```js
    const mode = CLAUDE_MODES[permissionMode] ?? "default";
```

5. In `start()`, add two options right after `systemPrompt`:

```js
        canUseTool: (toolName, input, options) => this.askPermission(toolName, input, options),
        // Questions to the user are out of scope for now; Claude asks in its reply instead.
        disallowedTools: ["AskUserQuestion"],
```

6. Add these methods after `start()`:

```js
  // Claude Code waits on this promise until the user answers in Milagre, the turn stops, or the SDK
  // aborts the request.
  askPermission(toolName, input, options = {}) {
    const request = claudeRequest(toolName, input, options);
    return new Promise((resolve) => {
      const abort = () => this.permissions.resolve(request.requestId, "cancelled");
      this.permissions.add(request, (decision) => {
        options.signal?.removeEventListener("abort", abort);
        resolve(claudeResult(decision, input, options.suggestions));
      });
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });
  }

  respondToPermission(requestId, decision) {
    return this.permissions.resolve(requestId, decision);
  }
```

7. In `finishTurn`, cancel anything still waiting before the terminal event goes out:

```js
  finishTurn(event) {
    if (!this.turnActive) return;
    this.turnActive = false;
    clearTimeout(this.interruptTimer);
    this.permissions.cancelAll();
    this.emit(event);
  }
```

8. In `interrupt()`, cancel pending approvals before asking Claude Code to stop. The new line goes right after the `this.interruptTimer = setTimeout(...)` statement:

```js
    this.permissions.cancelAll();
```

9. In `close()`, cancel pending approvals first. The new line is the method's first line:

```js
    this.permissions.cancelAll();
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test electron/agents/claude-provider.test.cjs`
Expected: PASS, all tests including the 7 new ones.

- [ ] **Step 6: Commit**

```bash
git add electron/agents/claude-provider.cjs electron/agents/claude-provider.test.cjs
git commit -m "feat: ask before Claude runs tools in Ask mode" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 3: Codex approvals

**Files:**
- Modify: `electron/agents/codex-provider.cjs`
- Modify: `electron/agents/fixtures/fake-app-server.cjs`
- Test: `electron/agents/codex-provider.test.cjs`

**Interfaces:**
- Consumes: `PendingPermissions`, `codexCommandRequest`, `codexFileRequest`, `codexDecision` from Task 1.
- Produces:
  - `CodexSession#respondToPermission(requestId, decision): boolean`
  - `codexPolicy(permissionMode, cwd)` returns `approvalPolicy` `"untrusted"` for Ask (and unknown modes), `"on-request"` for Auto and `"never"` for Full.

- [ ] **Step 1: Add approval scenarios to the fake app-server**

In `electron/agents/fixtures/fake-app-server.cjs`:

1. Update the header comment's scenario list to:

```js
// FAKE_SCENARIO picks how a turn behaves: reply (default), fail, slow, crash, approval (command
// approval), file-approval, permissions (extra sandbox permissions), withdrawn (an approval Codex
// takes back), stubborn (turn never ends, interrupt unanswered), hang-init (initialize unanswered),
// resume-exit (exits on thread/resume).
```

2. Replace the response branch (`if (method === undefined) { … }`) with one that reports any answer:

```js
  if (method === undefined) {
    if (pendingTurn && pendingTurn.approvalId === id) {
      const result = message.result || {};
      const answer = result.decision !== undefined ? `decision:${result.decision}` : `answer:${JSON.stringify(message.result ?? message.error)}`;
      notify("item/agentMessage/delta", { threadId: pendingTurn.threadId, turnId: pendingTurn.turnId, itemId: "msg-1", delta: answer });
      completeTurn(pendingTurn.threadId, pendingTurn.turnId, "completed");
      pendingTurn = null;
    }
    return;
  }
```

3. In `turn/start`, replace the `approval` scenario block with these four:

```js
      if (scenario === "approval") {
        pendingTurn = { threadId, turnId, approvalId: "srv-1" };
        return send({ id: "srv-1", method: "item/commandExecution/requestApproval", params: { threadId, turnId, itemId: "cmd-1", startedAtMs: 0, command: "/bin/zsh -lc 'rm -rf build'", cwd: "/repo", reason: "Clean the build" } });
      }
      if (scenario === "file-approval") {
        pendingTurn = { threadId, turnId, approvalId: "srv-1" };
        notify("item/started", { threadId, turnId, item: { type: "fileChange", id: "patch-1", status: "inProgress", changes: [{ path: "/repo/notes.txt", kind: { type: "add" }, diff: "+hello\n" }] } });
        return send({ id: "srv-1", method: "item/fileChange/requestApproval", params: { threadId, turnId, itemId: "patch-1", startedAtMs: 0, reason: "Write notes" } });
      }
      if (scenario === "permissions") {
        pendingTurn = { threadId, turnId, approvalId: "srv-1" };
        return send({ id: "srv-1", method: "item/permissions/requestApproval", params: { threadId, turnId, itemId: "perm-1" } });
      }
      if (scenario === "withdrawn") {
        send({ id: "srv-1", method: "item/commandExecution/requestApproval", params: { threadId, turnId, itemId: "cmd-1", startedAtMs: 0, command: "/bin/zsh -lc 'ls'" } });
        notify("serverRequest/resolved", { threadId, requestId: "srv-1" });
        return completeTurn(threadId, turnId, "completed");
      }
```

- [ ] **Step 2: Write the failing tests**

In `electron/agents/codex-provider.test.cjs`:

1. Replace the test "Ask and Auto stay inside the workspace sandbox" with:

```js
test("Ask asks about untrusted commands, Auto only about leaving the sandbox", async (t) => {
  const { session, events } = codex(t);
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await ended(events);
  await session.startTurn({ ...TURN, permissionMode: "auto" });
  await ended(events, 2);
  const turnStarts = (await received(session)).filter((message) => message.method === "turn/start").map((message) => message.params);
  assert.deepEqual(turnStarts.map((params) => params.approvalPolicy), ["untrusted", "on-request"]);
  for (const params of turnStarts) {
    assert.equal(params.sandboxPolicy.type, "workspaceWrite");
    assert.deepEqual(params.sandboxPolicy.writableRoots, [os.tmpdir()]);
  }
});
```

2. Replace the test "declines approval requests so nothing waits on the user yet" with:

```js
const asked = (events) => waitUntil(() => events.some((event) => event.type === "permission-request"));
const replyText = (events) => events.filter((event) => event.type === "text-delta").map((event) => event.text).join("");

test("asks before running a command and passes the answer back", async (t) => {
  const { session, events } = codex(t, { scenario: "approval" });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  assert.deepEqual(events.find((event) => event.type === "permission-request"), {
    type: "permission-request", requestId: "srv-1", kind: "command", tool: "Shell", title: "Run this command?", command: "rm -rf build", cwd: "/repo", reason: "Clean the build", allowForChat: true,
  });
  assert.equal(session.respondToPermission("srv-1", "allow-for-chat"), true);
  await ended(events);
  assert.equal(replyText(events), "decision:acceptForSession");
  assert.deepEqual(events.find((event) => event.type === "permission-resolved"), { type: "permission-resolved", requestId: "srv-1", decision: "allow-for-chat" });
});

test("denying declines the command", async (t) => {
  const { session, events } = codex(t, { scenario: "approval" });
  await session.startTurn(TURN);
  await asked(events);
  session.respondToPermission("srv-1", "deny");
  await ended(events);
  assert.equal(replyText(events), "decision:decline");
});

test("file changes show the diff Codex is about to apply", async (t) => {
  const { session, events } = codex(t, { scenario: "file-approval" });
  await session.startTurn(TURN);
  await asked(events);
  assert.deepEqual(events.find((event) => event.type === "permission-request"), {
    type: "permission-request", requestId: "srv-1", kind: "edit", tool: "Edit files", title: "Edit notes.txt?", files: ["/repo/notes.txt"], diff: "--- /repo/notes.txt\n+hello\n", reason: "Write notes", allowForChat: true,
  });
  session.respondToPermission("srv-1", "allow");
  await ended(events);
  assert.equal(replyText(events), "decision:accept");
});

test("interrupting cancels a pending approval", async (t) => {
  const { session, events } = codex(t, { scenario: "approval" });
  await session.startTurn(TURN);
  await asked(events);
  await session.interrupt();
  await ended(events);
  assert.deepEqual(events.find((event) => event.type === "permission-resolved"), { type: "permission-resolved", requestId: "srv-1", decision: "cancelled" });
  assert.equal(replyText(events), "decision:cancel");
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
});

test("a request Codex withdraws is dropped without an answer", async (t) => {
  const { session, events } = codex(t, { scenario: "withdrawn" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events.find((event) => event.type === "permission-resolved"), { type: "permission-resolved", requestId: "srv-1", decision: "cancelled" });
  assert.equal((await received(session)).some((message) => message.id === "srv-1"), false);
  assert.equal(session.respondToPermission("srv-1", "allow"), false);
});

test("extra sandbox permissions are declined", async (t) => {
  const { session, events } = codex(t, { scenario: "permissions" });
  await session.startTurn(TURN);
  await ended(events);
  assert.equal(replyText(events), 'answer:{"permissions":{},"scope":"turn"}');
  assert.equal(events.some((event) => event.type === "permission-request"), false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test electron/agents/codex-provider.test.cjs`
Expected: FAIL. The approval policies are `never`, there are no `permission-request` events, and `respondToPermission` is not a function.

- [ ] **Step 4: Implement approvals in `codex-provider.cjs`**

1. Below the existing `require` lines, add:

```js
const { PendingPermissions, codexCommandRequest, codexDecision, codexFileRequest } = require("./permissions.cjs");
```

2. Replace the comment and `codexPolicy`:

```js
// Milagre permission mode -> Codex policy. Ask asks before any command Codex doesn't already trust,
// Auto only when Codex wants to go beyond the workspace sandbox, and Full never asks.
function codexPolicy(permissionMode, cwd) {
  if (permissionMode === "full") return { approvalPolicy: "never", sandbox: "danger-full-access", sandboxPolicy: { type: "dangerFullAccess" } };
  return {
    approvalPolicy: permissionMode === "auto" ? "on-request" : "untrusted",
    sandbox: "workspace-write",
    sandboxPolicy: { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
  };
}
```

3. In the constructor, after `this.closed = false;`, add:

```js
    this.permissions = new PendingPermissions((event) => this.emit(event));
    // fileChange items by id, from item/started: their approval requests carry no diff of their own.
    this.fileChanges = new Map();
```

4. In `start()`, pass the request params through:

```js
    rpc.on("request", ({ id, method, params }) => this.handleServerRequest(id, method, params));
```

5. At the top of `handleNotification`, before the existing `turn/started` line, add:

```js
    if (method === "item/started" && params.item?.type === "fileChange") this.fileChanges.set(params.item.id, params.item.changes ?? []);
    if (method === "serverRequest/resolved") this.permissions.forget(String(params.requestId));
```

6. Replace `handleServerRequest` and add `reply` and `respondToPermission`:

```js
  handleServerRequest(id, method, params = {}) {
    const answer = (decision) => this.reply(id, { decision: codexDecision(decision) });
    if (method === "item/commandExecution/requestApproval") this.permissions.add(codexCommandRequest(id, params), answer);
    else if (method === "item/fileChange/requestApproval") this.permissions.add(codexFileRequest(id, params, this.fileChanges.get(params.itemId)), answer);
    // Granting extra sandbox permissions is out of scope: grant none, for this turn only.
    else if (method === "item/permissions/requestApproval") this.reply(id, { permissions: {}, scope: "turn" });
    else {
      try {
        this.rpc.respondError(id, `Milagre does not support ${method} yet.`);
      } catch {}
    }
  }

  // Codex may already have exited; then there is nobody left to answer.
  reply(id, result) {
    try {
      this.rpc?.respond(id, result);
    } catch {}
  }

  respondToPermission(requestId, decision) {
    return this.permissions.resolve(requestId, decision);
  }
```

7. In `finishTurn`, after `clearTimeout(this.interruptTimer);`, add:

```js
    this.permissions.cancelAll();
    this.fileChanges.clear();
```

8. In `interrupt()`, after the `this.interruptTimer = setTimeout(...)` line and before `if (!this.state.turnId || !this.rpc) return;`, add:

```js
    this.permissions.cancelAll();
```

9. In `close()`, add as the first line:

```js
    this.permissions.cancelAll();
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test electron/agents/codex-provider.test.cjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/agents/codex-provider.cjs electron/agents/codex-provider.test.cjs electron/agents/fixtures/fake-app-server.cjs
git commit -m "feat: ask before Codex runs commands or edits files" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 4: Steering a running turn

**Files:**
- Modify: `electron/agents/events.cjs`
- Modify: `electron/agents/claude-provider.cjs`
- Modify: `electron/agents/codex-provider.cjs`
- Modify: `electron/agents/fixtures/fake-app-server.cjs`
- Test: `electron/agents/events.test.cjs`, `electron/agents/claude-provider.test.cjs`, `electron/agents/codex-provider.test.cjs`

**Interfaces:**
- Consumes: the fake SDK from Task 2 (`released`, `next`, `calls.release()`).
- Produces:
  - Both sessions' `startTurn(request)` resolve to `{ turnId, steered }`. When a turn is running they steer it instead of throwing.
  - Both sessions emit `{ type: "turn-started", turnId }` as the first event of every turn.
  - `mapCodexNotification("turn/started", …)` returns `[{ type: "turn-started", turnId }]`.
  - `TURN_RUNNING_MESSAGE` is removed from `events.cjs`.

- [ ] **Step 1: Write the failing event test**

In `electron/agents/events.test.cjs`, append:

```js
test("Codex: a started turn is announced", () => {
  const state = { threadId: "thread-1", turnId: null, lastItemId: null, hasText: false };
  assert.deepEqual(mapCodexNotification("turn/started", { threadId: "thread-1", turn: { id: "t-2" } }, state), [{ type: "turn-started", turnId: "t-2" }]);
  assert.deepEqual(mapCodexNotification("turn/started", { threadId: "thread-9", turn: { id: "t-3" } }, state), []);
});
```

- [ ] **Step 2: Add steering to the fake app-server**

In `electron/agents/fixtures/fake-app-server.cjs`:

1. Add `steer` to the header comment's list: `steer (the first turn waits; turn/steer joins it, or is refused when its text says "too late")`.

2. In `turn/start`, add this block right after the `stubborn` line:

```js
      if (scenario === "steer" && turnId === "turn-1") {
        pendingTurn = { threadId, turnId };
        return undefined;
      }
```

3. Add a `turn/steer` case before `default`:

```js
    case "turn/steer": {
      const text = (params.input || []).map((input) => input.text || "").join("");
      if (!pendingTurn || params.expectedTurnId !== pendingTurn.turnId || text.includes("too late")) {
        send({ id, error: { code: -32600, message: "no active turn to steer" } });
        if (pendingTurn) completeTurn(pendingTurn.threadId, pendingTurn.turnId, "completed");
        pendingTurn = null;
        return undefined;
      }
      send({ id, result: { turnId: pendingTurn.turnId } });
      notify("item/agentMessage/delta", { threadId: pendingTurn.threadId, turnId: pendingTurn.turnId, itemId: "msg-1", delta: `steered:${text}` });
      completeTurn(pendingTurn.threadId, pendingTurn.turnId, "completed");
      pendingTurn = null;
      return undefined;
    }
```

- [ ] **Step 3: Write the failing provider tests**

In `electron/agents/claude-provider.test.cjs`:

1. Add two scripts to `scripts`:

```js
  async *absorbs({ next }) {
    yield init;
    const steer = await next();
    yield delta(`steered:${steer.message.content[0].text}`);
    yield success;
  },
  async *held({ released }) {
    yield init;
    await released;
    yield delta("Done");
    yield success;
  },
```

2. Every turn now opens with `turn-started`, so update the expectations below.

   In "starts with Milagre's options and streams a reply":

```js
  assert.deepEqual(events.map((event) => event.type), ["turn-started", "session-started", "text-delta", "text-delta", "turn-completed"]);
  assert.equal(events[1].nativeId, "session-1");
```

   In "forgets a session that can't be resumed":

```js
  assert.deepEqual(events.slice(1), [{ type: "session-reset" }, { type: "turn-failed", message: RESUME_FAILED_MESSAGE }]);
  assert.equal(events[0].type, "turn-started");
```

   In "keeps the saved session when a resumed start fails for another reason":

```js
  assert.deepEqual(events.slice(1), [{ type: "turn-failed", message: "spawn EACCES" }]);
```

3. Append:

```js
test("steers a running turn", async (t) => {
  const { session, events, calls } = claude(t, { script: scripts.absorbs });
  const first = await session.startTurn(TURN);
  const second = await session.startTurn({ ...TURN, prompt: "Also add tests" });
  await ended(events);
  assert.equal(first.steered, false);
  assert.deepEqual(second, { turnId: first.turnId, steered: true });
  assert.equal(calls.prompts.length, 2);
  assert.ok(events.some((event) => event.type === "text-delta" && event.text === "steered:Also add tests"));
  assert.equal(events.filter(isTerminal).length, 1);
});

test("a steer that arrives as the turn ends becomes a turn of its own", async (t) => {
  const { session, events, calls } = claude(t, { script: scripts.held });
  const first = await session.startTurn(TURN);
  const second = await session.startTurn({ ...TURN, prompt: "One more thing" });
  calls.release();
  await ended(events, 2);
  assert.equal(second.steered, true);
  const started = events.filter((event) => event.type === "turn-started");
  assert.equal(started.length, 2);
  assert.equal(started[0].turnId, first.turnId);
  assert.notEqual(started[1].turnId, first.turnId);
  assert.equal(session.turnActive, false);
  assert.equal(calls.prompts.length, 2);
});

test("a steer sent while the SDK is still loading waits for the turn", async (t) => {
  const { session, events, calls } = claude(t, { script: scripts.absorbs });
  const first = session.startTurn(TURN);
  const second = session.startTurn({ ...TURN, prompt: "Also add tests" });
  assert.equal((await second).steered, true);
  await first;
  await ended(events);
  assert.deepEqual(calls.prompts.map((prompt) => prompt.message.content[0].text), ["Hi", "Also add tests"]);
});
```

In `electron/agents/codex-provider.test.cjs`:

1. In "streams a reply and keeps one thread across turns", expect the new event:

```js
  assert.deepEqual(events, [
    { type: "session-started", nativeId: "thread-1" },
    { type: "turn-started", turnId: "turn-1" },
    { type: "text-delta", messageId: "turn-1", text: "Hel" },
    { type: "text-delta", messageId: "turn-1", text: "lo" },
    { type: "turn-completed" },
  ]);
```

2. Append:

```js
test("steers a running turn", async (t) => {
  const { session, events } = codex(t, { scenario: "steer" });
  const first = await session.startTurn(TURN);
  const second = await session.startTurn({ ...TURN, prompt: "Also add tests" });
  await ended(events);
  assert.deepEqual(first, { turnId: "turn-1", steered: false });
  assert.deepEqual(second, { turnId: "turn-1", steered: true });
  assert.ok(events.some((event) => event.type === "text-delta" && event.text === "steered:Also add tests"));
  const steer = (await received(session)).find((message) => message.method === "turn/steer").params;
  assert.equal(steer.expectedTurnId, "turn-1");
  assert.equal(steer.threadId, "thread-1");
  assert.deepEqual(steer.input, [{ type: "text", text: "Also add tests", text_elements: [] }]);
});

test("a steer Codex refuses starts the next turn once this one ends", async (t) => {
  const { session, events } = codex(t, { scenario: "steer" });
  await session.startTurn(TURN);
  const late = await session.startTurn({ ...TURN, prompt: "too late" });
  await ended(events, 2);
  assert.deepEqual(late, { turnId: "turn-2", steered: false });
  assert.deepEqual(events.filter((event) => event.type === "turn-started").map((event) => event.turnId), ["turn-1", "turn-2"]);
  const types = events.map((event) => event.type);
  assert.ok(types.indexOf("turn-completed") < types.lastIndexOf("turn-started"));
  const starts = (await received(session)).filter((message) => message.method === "turn/start");
  assert.equal(starts.length, 2);
  assert.equal(starts[1].params.input[0].text, "too late");
});

test("a steer sent before Codex has started the turn waits for it", async (t) => {
  const { session, events } = codex(t, { scenario: "steer" });
  const first = session.startTurn(TURN);
  const second = session.startTurn({ ...TURN, prompt: "Also add tests" });
  assert.deepEqual(await second, { turnId: "turn-1", steered: true });
  assert.deepEqual(await first, { turnId: "turn-1", steered: false });
  await ended(events);
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node --test electron/agents/events.test.cjs electron/agents/claude-provider.test.cjs electron/agents/codex-provider.test.cjs`
Expected: FAIL. There is no `turn-started` event, and a second `startTurn` rejects with "This chat already has a turn running."

- [ ] **Step 5: Implement `turn-started` and drop `TURN_RUNNING_MESSAGE` in `events.cjs`**

1. Replace the header comment:

```js
// Normalised events every agent session emits. The main process forwards them to the
// renderer as { chatId, event }, where chatId is the chat key `${projectPath}#${sessionId}`:
//   { type: "session-started", nativeId }   provider session or thread id; the chat saves it
//   { type: "session-reset" }               the saved id can't be resumed; the chat forgets it
//   { type: "turn-started", turnId }        first event of every turn, including turns the renderer
//                                           didn't start (a steering message that arrived as the last turn ended)
//   { type: "text-delta", messageId, text } reply text as it streams; messageId is the turn id
//   { type: "permission-request", ...request } and { type: "permission-resolved", requestId, decision }
//                                           an approval the turn waits on (see permissions.cjs)
//   { type: "turn-completed" } | { type: "turn-cancelled" } | { type: "turn-failed", message }
// Exactly one of the last three ends every turn.
```

2. Delete the `TURN_RUNNING_MESSAGE` constant and remove it from `module.exports`.

3. In `mapCodexNotification`, add right after the thread check:

```js
  if (method === "turn/started") return [{ type: "turn-started", turnId: params.turn?.id ?? null }];
```

- [ ] **Step 6: Implement steering in `claude-provider.cjs`**

1. Remove `TURN_RUNNING_MESSAGE` from the `events.cjs` import.

2. Add this helper above `class ClaudeSession`:

```js
function userMessage(prompt, images = []) {
  const content = [{ type: "text", text: prompt }, ...images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mime, data: image.base64 } }))];
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
}
```

3. In the constructor, after the `this.permissions = …` line, add:

```js
    // Settles once the running turn's own message is in Claude Code's input (or the turn failed to start).
    this.turnReady = Promise.resolve();
```

4. Replace `startTurn` with `startTurn` plus `beginTurn`. Apart from the return values and the two marked lines, `beginTurn` is the old body:

```js
  async startTurn(request) {
    if (this.closed) throw new Error("This Claude session is closed.");
    if (this.turnActive) return this.steer(request);
    if (!this.command) {
      this.emit({ type: "turn-failed", message: missingCliMessage("claude") });
      return { turnId: null, steered: false };
    }
    this.turnActive = true;
    this.cancelRequested = false;
    let markReady;
    this.turnReady = new Promise((resolve) => { markReady = resolve; });
    try {
      return await this.beginTurn(request);
    } finally {
      markReady();
    }
  }

  async beginTurn({ prompt, images = [], model, permissionMode }) {
    const turnId = randomUUID();
    Object.assign(this.state, { turnId, hasText: false });
    const mode = CLAUDE_MODES[permissionMode] ?? "default";
    try {
      if (!this.query) await this.start(model, mode);
      if (!this.closed) {
        if (model !== this.model) {
          await this.query.setModel(model);
          this.model = model;
        }
        if (mode !== this.mode) {
          await this.query.setPermissionMode(mode);
          this.mode = mode;
        }
      }
    } catch (error) {
      this.finishTurn({ type: "turn-failed", message: error.message });
      return { turnId: null, steered: false };
    }
    // close() or interrupt() may have landed while the SDK was loading or the query starting.
    if (this.closed) {
      await this.close();
      this.finishTurn({ type: "turn-cancelled" });
      return { turnId: null, steered: false };
    }
    if (this.cancelRequested) {
      this.finishTurn({ type: "turn-cancelled" });
      return { turnId: null, steered: false };
    }
    this.inbox.push(userMessage(prompt, images));
    this.emit({ type: "turn-started", turnId });
    return { turnId, steered: false };
  }

  // A message for the running turn goes straight into Claude Code's input. Claude Code picks it up at
  // the next tool boundary; if the turn ends first, it starts a new turn for it (see readMessages).
  async steer(request) {
    await this.turnReady;
    if (!this.turnActive || !this.inbox || this.closed) return this.startTurn(request);
    this.inbox.push(userMessage(request.prompt, request.images));
    return { turnId: this.state.turnId, steered: true };
  }

  beginImplicitTurn() {
    const turnId = randomUUID();
    this.turnActive = true;
    this.cancelRequested = false;
    Object.assign(this.state, { turnId, hasText: false });
    this.turnReady = Promise.resolve();
    this.emit({ type: "turn-started", turnId });
  }
```

5. In `readMessages`, make the first line inside the `for await` loop:

```js
        // Claude Code opens every turn with init. One arriving while no turn runs is a turn Claude Code
        // started by itself, for a steering message that came in just as the last turn ended.
        if (message.type === "system" && message.subtype === "init" && !this.turnActive && !this.closed) this.beginImplicitTurn();
```

- [ ] **Step 7: Implement steering in `codex-provider.cjs`**

1. Remove `TURN_RUNNING_MESSAGE` from the `events.cjs` import.

2. Add this helper below `writeImages`:

```js
const turnInput = (prompt, files) => [{ type: "text", text: prompt, text_elements: [] }, ...(files?.paths ?? []).map((file) => ({ type: "localImage", path: file }))];
```

3. In the constructor, replace `this.images = null;` with:

```js
    // Image files written for this turn's messages; removed when the turn ends.
    this.imageSets = [];
    // Settle once the running turn has its id (or failed to start), and once it has ended.
    this.turnReady = Promise.resolve();
    this.turnEnded = Promise.resolve();
```

4. Replace `startTurn` with `startTurn`, `beginTurn` and `steer`:

```js
  async startTurn(request) {
    if (this.turnActive) return this.steer(request);
    if (!this.command) {
      this.emit({ type: "turn-failed", message: missingCliMessage("codex") });
      return { turnId: null, steered: false };
    }
    this.turnActive = true;
    this.cancelRequested = false;
    Object.assign(this.state, { turnId: null, lastItemId: null, hasText: false });
    let markReady;
    this.turnReady = new Promise((resolve) => { markReady = resolve; });
    this.turnEnded = new Promise((resolve) => { this.markTurnEnded = resolve; });
    try {
      return await this.beginTurn(request);
    } finally {
      markReady();
    }
  }

  async beginTurn({ prompt, images = [], model, permissionMode }) {
    const policy = codexPolicy(permissionMode, this.cwd);
    try {
      this.starting ??= this.start(model, policy);
      await this.starting;
      if (this.cancelRequested) {
        await this.finishTurn([{ type: "turn-cancelled" }]);
        return { turnId: null, steered: false };
      }
      const files = images.length ? await writeImages(images) : null;
      if (files) this.imageSets.push(files);
      const { turn } = await this.rpc.request("turn/start", {
        threadId: this.state.threadId,
        input: turnInput(prompt, files),
        model,
        approvalPolicy: policy.approvalPolicy,
        sandboxPolicy: policy.sandboxPolicy,
      }, { timeoutMs: 90_000 });
      this.state.turnId ??= turn?.id ?? null;
      if (this.cancelRequested) void this.interrupt();
      return { turnId: this.state.turnId, steered: false };
    } catch (error) {
      if (error.resumeFailed) {
        await this.finishTurn([{ type: "session-reset" }, { type: "turn-failed", message: RESUME_FAILED_MESSAGE }]);
        await this.close();
      } else {
        await this.finishTurn([this.cancelRequested ? { type: "turn-cancelled" } : { type: "turn-failed", message: error.message }]);
        // A session that never finished starting is unusable; closing it lets the manager start over.
        if (!this.ready) await this.close();
      }
      return { turnId: null, steered: false };
    }
  }

  // A message for the running turn joins it through turn/steer, once the turn has an id. If Codex
  // refuses because the turn already ended, the message starts the next turn instead.
  async steer(request) {
    await this.turnReady;
    if (!this.turnActive || !this.state.turnId) return this.startTurn(request);
    const turnId = this.state.turnId;
    const files = request.images?.length ? await writeImages(request.images) : null;
    if (files) this.imageSets.push(files);
    try {
      await this.rpc.request("turn/steer", { threadId: this.state.threadId, expectedTurnId: turnId, input: turnInput(request.prompt, files) });
      return { turnId, steered: true };
    } catch (error) {
      if (!error.rpcError) throw error;
      await this.turnEnded;
      return this.startTurn(request);
    }
  }
```

5. Replace `finishTurn`:

```js
  async finishTurn(events) {
    if (!this.turnActive) return;
    this.turnActive = false;
    clearTimeout(this.interruptTimer);
    this.permissions.cancelAll();
    this.fileChanges.clear();
    const imageSets = this.imageSets;
    this.imageSets = [];
    await Promise.all(imageSets.map((files) => files.cleanup().catch(() => {})));
    events.forEach((event) => this.emit(event));
    this.markTurnEnded?.();
  }
```

- [ ] **Step 8: Run all agent tests**

Run: `npm run test:agent`
Expected: PASS, including the 7 new tests. The session manager tests still pass: its fake sessions don't care about the new return shape.

- [ ] **Step 9: Commit**

```bash
git add electron/agents
git commit -m "feat: steer a running agent turn with a new message" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 5: Session manager and IPC

**Files:**
- Modify: `electron/agents/session-manager.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Test: `electron/agents/session-manager.test.cjs`

**Interfaces:**
- Consumes:
  - `USER_DECISIONS` from Task 1.
  - `session.respondToPermission(requestId, decision)` from Tasks 2–3.
  - The `{ turnId, steered }` result from Task 4.
- Produces:
  - `SessionManager#respondToPermission(chatId, requestId, decision): boolean`. It throws `Unknown permission decision: <value>` for anything outside `USER_DECISIONS`.
  - `SessionManager#interruptAll(): Promise<void>`
  - IPC `agent:respond-permission`, taking `{ chatId, requestId, decision }` and resolving to a `boolean`.
  - Preload `window.milagre.respondToPermission(chatId, requestId, decision)`.
  - Main interrupts every running turn when the renderer reloads.

- [ ] **Step 1: Write the failing tests**

In `electron/agents/session-manager.test.cjs`, add to `FakeSession`:

```js
  respondToPermission(requestId, decision) {
    this.answers = [...(this.answers ?? []), { requestId, decision }];
    return true;
  }
```

Append:

```js
test("routes approval answers to the chat's session and refuses unknown decisions", async (t) => {
  const { manager, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  assert.equal(manager.respondToPermission("1", "req-1", "allow-for-chat"), true);
  assert.deepEqual(created[0].answers, [{ requestId: "req-1", decision: "allow-for-chat" }]);
  assert.equal(manager.respondToPermission("9", "req-1", "allow"), false);
  assert.throws(() => manager.respondToPermission("1", "req-1", "cancelled"), /Unknown permission decision: cancelled/);
  assert.throws(() => manager.respondToPermission("1", "req-1", "yes"), /Unknown permission decision: yes/);
});

test("interruptAll stops every chat's turn", async (t) => {
  const { manager, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  await manager.startTurn(request("2"));
  await manager.interruptAll();
  assert.deepEqual(created.map((session) => session.interrupts), [1, 1]);
});

test("an approval request is sent right after the text before it", async (t) => {
  const { manager, sent, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].emit({ type: "text-delta", messageId: "t1", text: "Let me check" });
  created[0].emit({ type: "permission-request", requestId: "r1", kind: "command", tool: "Shell", title: "Run this command?", command: "ls", allowForChat: true });
  assert.deepEqual(sent.map((item) => item.event.type), ["text-delta", "permission-request"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test electron/agents/session-manager.test.cjs`
Expected: FAIL. `manager.respondToPermission` and `manager.interruptAll` are not functions.

- [ ] **Step 3: Implement the manager methods**

In `electron/agents/session-manager.cjs`:

1. Change the first line's import to:

```js
const { isTerminal } = require("./events.cjs");
const { USER_DECISIONS } = require("./permissions.cjs");
```

2. Add after `interrupt(chatId)`:

```js
  // The renderer is untrusted input: only the user's three answers reach a session.
  respondToPermission(chatId, requestId, decision) {
    if (!USER_DECISIONS.has(decision)) throw new Error(`Unknown permission decision: ${decision}`);
    return this.sessions.get(chatId)?.session.respondToPermission(requestId, decision) ?? false;
  }

  async interruptAll() {
    await Promise.all([...this.sessions.values()].map((entry) => entry.session.interrupt()));
  }
```

3. In the class comment, add the sentence `A turn's session steers it when the chat sends again while it runs.` after the sentence about text deltas.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test electron/agents/session-manager.test.cjs`
Expected: PASS.

- [ ] **Step 5: Wire IPC and reloads in `main.cjs` and `preload.cjs`**

In `electron/main.cjs`, after the `agent:interrupt` handler, add:

```js
ipcMain.handle("agent:respond-permission", (_event, { chatId, requestId, decision }) => agents.respondToPermission(chatId, requestId, decision));
```

In `createWindow()`, after the `guardNavigation(...)` line, add:

```js
  // A reload starts the renderer with no running turns, so stop the agents' turns: none may keep
  // waiting on an approval card that no longer exists.
  let loaded = false;
  window.webContents.on("did-finish-load", () => {
    if (loaded) void agents.interruptAll().catch(() => {});
    loaded = true;
  });
```

In `electron/preload.cjs`, after `interruptAgent`, add:

```js
  respondToPermission: (chatId, requestId, decision) => ipcRenderer.invoke("agent:respond-permission", { chatId, requestId, decision }),
```

- [ ] **Step 6: Run all agent tests and commit**

Run: `npm run test:agent`
Expected: PASS.

```bash
git add electron/agents/session-manager.cjs electron/agents/session-manager.test.cjs electron/main.cjs electron/preload.cjs
git commit -m "feat: route approval answers from the window to agent sessions" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 6: Renderer state for approvals and steering

**Files:**
- Modify: `app/src/model.ts`
- Modify: `app/src/electron.d.ts`
- Modify: `app/src/lib/agent-runs.ts`
- Test: `app/src/lib/agent-runs.test.ts`

**Interfaces:**
- Consumes: the event shapes from Tasks 1 and 4.
- Produces:
  - In `model.ts`:
    - `PermissionRequest`
    - `PermissionDecision = "allow" | "allow-for-chat" | "deny"`
    - three new `AgentEvent` members: `turn-started`, `permission-request` and `permission-resolved`.
  - In `agent-runs.ts`:
    - `AgentRun` gains `approvals: PermissionRequest[]`.
    - `splitRunForSteer(state, runs, projectPath, chatId) → { state, runs, changed }`
  - In `electron.d.ts`:
    - `startTurn` resolves to `{ turnId: string | null; steered: boolean }`.
    - New `respondToPermission(chatId, requestId, decision): Promise<boolean>`.

- [ ] **Step 1: Add the types**

In `app/src/model.ts`, replace the `AgentEvent` type with:

```ts
/** What an agent asks to do, as shown on the approval card. */
export interface PermissionRequest {
  requestId: string;
  kind: "command" | "edit" | "other";
  /** Short name of the tool, e.g. "Bash", "Shell" or "Edit files". */
  tool: string;
  title: string;
  description?: string;
  command?: string;
  cwd?: string;
  /** A unified diff (or the new content), capped at 20,000 characters. */
  diff?: string;
  files?: string[];
  /** The tool's raw input, for tools that are neither commands nor edits. */
  detail?: string;
  reason?: string;
  /** Whether "Always allow in this chat" can be offered. */
  allowForChat: boolean;
}

export type PermissionDecision = "allow" | "allow-for-chat" | "deny";

export type AgentEvent =
  | { type: "session-started"; nativeId: string }
  | { type: "session-reset" }
  | { type: "turn-started"; turnId: string | null }
  | { type: "text-delta"; messageId: string | null; text: string }
  | ({ type: "permission-request" } & PermissionRequest)
  | { type: "permission-resolved"; requestId: string; decision: PermissionDecision | "cancelled" }
  | { type: "turn-completed" }
  | { type: "turn-cancelled" }
  | { type: "turn-failed"; message: string };
```

In `app/src/electron.d.ts`, add `PermissionDecision` to the `./model` import and replace the `startTurn` line with these two:

```ts
      startTurn: (request: AgentStartTurnRequest) => Promise<{ turnId: string | null; steered: boolean }>;
      respondToPermission: (chatId: string, requestId: string, decision: PermissionDecision) => Promise<boolean>;
```

- [ ] **Step 2: Write the failing tests**

In `app/src/lib/agent-runs.test.ts`:

1. Add `splitRunForSteer` to the `./agent-runs.ts` import, `PermissionRequest` to the `../model` type import, and this line:

```ts
import type { AgentRuns } from "./agent-runs.ts";
```

2. Runs now always carry `approvals`, so add `approvals: []` to every run literal in the existing tests: "keeps partial text when a turn fails or is cancelled" (2 literals), "a key from another project path never touches this state", "an unknown session id is a no-op" and "an unknown event type changes nothing". For example:

```ts
  const runs = { [key(1)]: { text: "Half an answer", model: "gpt-6-sol", approvals: [] } };
```

3. In "an unknown event type changes nothing", the made-up event must stay unknown. Its `type: "tool-started"` is still not an `AgentEvent`, so it needs no change.

4. Append:

```ts
const approval = (requestId: string): PermissionRequest => ({ requestId, kind: "command", tool: "Shell", title: "Run this command?", command: "ls", allowForChat: true });

test("turn-started opens a run for a turn this window didn't start", () => {
  const state = { ...base(), messages: [{ id: 5, session_id: 2, body: "One more thing", context: null, role: "user" as const, model: "claude-opus-5-5" }] };
  const opened = applyAgentEvent(state, {}, PROJECT, key(2), { type: "turn-started", turnId: "t-2" });
  assert.deepEqual(opened.runs[key(2)], { text: "", model: "claude-opus-5-5", approvals: [] });
  assert.equal(opened.changed, false);

  const running = startRun({}, key(2), "claude-sonnet-5-5");
  const kept = applyAgentEvent(state, running, PROJECT, key(2), { type: "turn-started", turnId: "t-2" });
  assert.equal(kept.runs, running);
});

test("approval requests wait on the run, oldest first, until they're resolved", () => {
  let runs = startRun({}, key(1), "gpt-6-sol");
  const state = base();
  for (const requestId of ["a", "b"]) runs = applyAgentEvent(state, runs, PROJECT, key(1), { type: "permission-request", ...approval(requestId) }).runs;
  assert.deepEqual(runs[key(1)].approvals.map((item) => item.requestId), ["a", "b"]);
  assert.deepEqual(runs[key(1)].approvals[0], approval("a"));

  runs = applyAgentEvent(state, runs, PROJECT, key(1), { type: "permission-request", ...approval("a"), title: "Again?" }).runs;
  assert.deepEqual(runs[key(1)].approvals.map((item) => item.requestId), ["b", "a"]);

  runs = applyAgentEvent(state, runs, PROJECT, key(1), { type: "permission-resolved", requestId: "b", decision: "deny" }).runs;
  assert.deepEqual(runs[key(1)].approvals.map((item) => item.requestId), ["a"]);
  runs = applyAgentEvent(state, runs, PROJECT, key(1), { type: "permission-resolved", requestId: "missing", decision: "cancelled" }).runs;
  assert.equal(runs[key(1)].approvals.length, 1);

  const ended = applyAgentEvent(state, runs, PROJECT, key(1), { type: "turn-cancelled" });
  assert.equal(ended.runs[key(1)], undefined);
  assert.equal(applyAgentEvent(state, {}, PROJECT, key(1), { type: "permission-request", ...approval("c") }).runs[key(1)], undefined);
});

test("a steer saves the reply so far and keeps the run going", () => {
  const state = base();
  const runs = { [key(1)]: { text: "  Half an answer \n", model: "gpt-6-sol", approvals: [approval("a")] } };
  const split = splitRunForSteer(state, runs, PROJECT, key(1));
  assert.equal(split.changed, true);
  assert.deepEqual(split.state.messages.at(-1), { id: state.next_id, session_id: 1, body: "Half an answer", context: null, role: "assistant", model: "gpt-6-sol" });
  assert.equal(split.state.next_id, state.next_id + 1);
  assert.deepEqual(split.runs[key(1)], { text: "", model: "gpt-6-sol", approvals: [approval("a")] });

  const cases: Array<[AgentRuns, string]> = [
    [{ [key(1)]: { text: "  ", model: "gpt-6-sol", approvals: [] } }, key(1)],
    [{}, key(1)],
    [runs, chatKey("/work/other", 1)],
    [runs, key(99)],
  ];
  for (const [testRuns, chatId] of cases) {
    const unchanged = splitRunForSteer(state, testRuns, PROJECT, chatId);
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.state, state);
    assert.equal(unchanged.runs, testRuns);
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test app/src/lib/agent-runs.test.ts`
Expected: FAIL. `splitRunForSteer` is not exported, and `turn-started` opens no run.

- [ ] **Step 4: Implement the fold**

In `app/src/lib/agent-runs.ts`:

1. Import the new type:

```ts
import type { AgentEvent, ChatMessage, CoordinatorState, ModelOption, ModelProvider, PermissionRequest } from "../model";
```

2. Replace `AgentRun` and `startRun`:

```ts
/** A turn streaming in a chat, keyed by chat key (see `chatKey`). */
export interface AgentRun {
  text: string;
  model: string;
  /** Approval requests the turn waits on, oldest first. */
  approvals: PermissionRequest[];
}
```

```ts
export function startRun(runs: AgentRuns, chatId: string, model: string): AgentRuns {
  return { ...runs, [chatId]: { text: "", model, approvals: [] } };
}
```

3. In `applyAgentEvent`'s `switch`, add before `case "text-delta"`:

```ts
    case "turn-started": {
      // A turn this window didn't start, such as a steering message that arrived as the last turn ended.
      if (run) return { state, runs, changed: false };
      const model = [...state.messages].reverse().find((message) => message.session_id === sessionId && message.role === "user")?.model ?? "";
      return { state, runs: startRun(runs, chatId, model), changed: false };
    }
    case "permission-request": {
      if (!run) return { state, runs, changed: false };
      const { type: _type, ...request } = event;
      const approvals = [...run.approvals.filter((item) => item.requestId !== request.requestId), request];
      return { state, runs: { ...runs, [chatId]: { ...run, approvals } }, changed: false };
    }
    case "permission-resolved": {
      if (!run) return { state, runs, changed: false };
      const approvals = run.approvals.filter((item) => item.requestId !== event.requestId);
      if (approvals.length === run.approvals.length) return { state, runs, changed: false };
      return { state, runs: { ...runs, [chatId]: { ...run, approvals } }, changed: false };
    }
```

4. Add after `applyAgentEvent`:

```ts
/**
 * Before a steering message joins a running turn, the reply streamed so far is saved as its own
 * message, so the chat reads in order: the reply so far, the new message, then the rest of the reply.
 */
export function splitRunForSteer(state: CoordinatorState, runs: AgentRuns, projectPath: string, chatId: string): { state: CoordinatorState; runs: AgentRuns; changed: boolean } {
  const sessionId = sessionIdFromKey(chatId);
  const run = runs[chatId];
  const body = run?.text.trim();
  if (!chatInProject(projectPath, chatId) || !state.sessions[sessionId] || !run || !body) return { state, runs, changed: false };
  const message: ChatMessage = { id: state.next_id, session_id: sessionId, body, context: null, role: "assistant", model: run.model };
  return {
    state: { ...state, next_id: state.next_id + 1, messages: [...state.messages, message] },
    runs: { ...runs, [chatId]: { ...run, text: "" } },
    changed: true,
  };
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `node --test app/src/lib/agent-runs.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: errors only in `app/src/App.tsx` and `app/src/components/useAgentRuns.ts`, if any. Those are fixed in Task 7. `agent-runs.ts`, its test, `model.ts` and `electron.d.ts` must have none.

- [ ] **Step 6: Commit**

```bash
git add app/src/model.ts app/src/electron.d.ts app/src/lib/agent-runs.ts app/src/lib/agent-runs.test.ts
git commit -m "feat: keep pending approvals and steering in each chat's run" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 7: Approval card, steering and Escape in the window

**Files:**
- Create: `app/src/components/agents/PermissionCard.tsx`
- Modify: `app/src/components/agents/tool-approval.tsx`
- Modify: `app/src/components/useAgentRuns.ts`
- Modify: `app/src/App.tsx`
- Modify: `app/src/components/ChatComposer.tsx`
- Modify: `app/src/components/PromptComposer.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes:
  - `AgentRun.approvals`, `splitRunForSteer`, `PermissionRequest` and `PermissionDecision` from Task 6.
  - `window.milagre.respondToPermission` from Task 5.
- Produces:
  - `useAgentRuns(...)` returns `{ runs, start, interrupt, respond, splitForSteer }`.
  - `PermissionCard({ request, waiting, answering, onAnswer })`
  - `ToolApproval` gains `alwaysAllowLabel?: ReactNode`.
  - `ChatComposer` gains `sendBlocked: boolean`.
  - `PromptComposer` replaces `isSending` with `sendBlocked: boolean` and gains `running?: boolean`.

There is no renderer test harness, so this task is checked by the typecheck and the build, then in Electron in Task 8.

- [ ] **Step 1: Let `ToolApproval` label its always-allow button**

In `app/src/components/agents/tool-approval.tsx`:

1. Add to `ToolApprovalProps`, after `onAlwaysAllow?: () => void;`:

```ts
  /** Label for the always-allow button. */
  alwaysAllowLabel?: ReactNode;
```

2. Add `alwaysAllowLabel = "Always allow",` to the destructured props, after `onAlwaysAllow,`.

3. In the always-allow button, replace the text `Always allow` with `{alwaysAllowLabel}`.

- [ ] **Step 2: Create the card**

Create `app/src/components/agents/PermissionCard.tsx`:

```tsx
import type { PermissionDecision, PermissionRequest } from "../../model";
import { ToolApproval, ToolApprovalCode } from "./tool-approval";
import type { ToolApprovalParameter } from "./tool-approval";

/** The open chat's oldest pending approval, with the exact command or change the agent wants to make. */
export function PermissionCard({ request, waiting, answering, onAnswer }: {
  request: PermissionRequest;
  /** How many more requests are queued behind this one. */
  waiting: number;
  /** The answer already sent for this request, while the agent takes it. */
  answering: PermissionDecision | null;
  onAnswer: (decision: PermissionDecision) => void;
}) {
  const parameters: ToolApprovalParameter[] = [];
  if (request.command) parameters.push({ id: "command", label: "Command", value: <ToolApprovalCode code={request.command} language="bash" /> });
  if (request.cwd) parameters.push({ id: "cwd", label: "Folder", value: <span className="font-mono">{request.cwd}</span> });
  if (request.files?.length) parameters.push({ id: "files", label: request.files.length === 1 ? "File" : "Files", value: <span className="whitespace-pre-wrap font-mono">{request.files.join("\n")}</span> });
  if (request.diff) parameters.push({ id: "diff", label: "Changes", value: <ToolApprovalCode code={request.diff} language="diff" /> });
  if (request.detail) parameters.push({ id: "detail", label: "Details", value: <ToolApprovalCode code={request.detail} language="json" /> });
  if (request.reason) parameters.push({ id: "reason", label: "Reason", value: request.reason });
  const queued = waiting > 0 ? `${waiting} more ${waiting === 1 ? "request is" : "requests are"} waiting after this one.` : "";
  const description = [request.description, queued].filter(Boolean).join(" ");
  return (
    <ToolApproval
      tool={request.tool}
      title={request.title}
      description={description || undefined}
      status={answering === null ? "pending" : answering === "deny" ? "denied" : "approving"}
      defaultOpen
      parameters={parameters}
      onApprove={() => onAnswer("allow")}
      onAlwaysAllow={request.allowForChat ? () => onAnswer("allow-for-chat") : undefined}
      alwaysAllowLabel="Always allow in this chat"
      onDeny={() => onAnswer("deny")}
    />
  );
}
```

- [ ] **Step 3: Let the hook steer, split and answer**

In `app/src/components/useAgentRuns.ts`:

1. Update the imports:

```ts
import type { AgentEvent, AgentStartTurnRequest, CoordinatorState, PermissionDecision } from "../model";
import { applyAgentEvent, chatInProject, splitRunForSteer, startRun } from "../lib/agent-runs";
```

2. In `start`, keep an existing run, so that a message sent mid-turn steers it. Replace the two lines that create the run:

```ts
    // A chat whose turn is running keeps its run: the message steers that turn.
    if (!runsRef.current[request.chatId]) {
      runsRef.current = startRun(runsRef.current, request.chatId, request.model);
      setRuns(runsRef.current);
    }
```

3. Add after `interrupt`:

```ts
  /** Saves the reply streamed so far in a chat, so a steering message can follow it. */
  const splitForSteer = useCallback((chatId: string) => {
    const state = getStateRef.current();
    if (!state) return;
    const result = splitRunForSteer(state, runsRef.current, projectPathRef.current, chatId);
    if (!result.changed) return;
    runsRef.current = result.runs;
    setRuns(result.runs);
    commitRef.current(result.state);
  }, []);

  const respond = useCallback((chatId: string, requestId: string, decision: PermissionDecision) => window.milagre.respondToPermission(chatId, requestId, decision), []);
```

4. Return them:

```ts
  return { runs, start, interrupt, respond, splitForSteer };
```

- [ ] **Step 4: Replace the pre-run approval in `App.tsx`**

1. Imports:
   - Add `PermissionDecision,` to the `./model` import list.
   - Delete the two `./components/agents/tool-approval` imports.
   - Add:

```ts
import { PermissionCard } from "./components/agents/PermissionCard";
```

2. Delete `MUTATING_INTENT`, `READ_ONLY_INTENT`, `EXPLICIT_MUTATION` and `requiresApproval`.

3. Delete the `approvalImages`, `approvalPrompt` and `approvalStatus` state and `approvalTimerRef`. Add in their place:

```ts
  // The answer sent for the open approval, shown on the card until the agent takes it.
  const [answering, setAnswering] = useState<{ requestId: string; decision: PermissionDecision } | null>(null);
```

4. After `const isSending = preparing || Boolean(run);`, add:

```ts
  const pendingApproval = run?.approvals[0];

  function answerApproval(decision: PermissionDecision) {
    if (!project || !selectedSession || !pendingApproval) return;
    setAnswering({ requestId: pendingApproval.requestId, decision });
    void agentRuns.respond(chatKey(project.path, selectedSession.id), pendingApproval.requestId, decision).catch(() => {});
  }
```

5. In `executeSend`, a running turn no longer blocks sending. The first guard becomes:

```ts
    if ((!body && !images.length) || !state || !selectedWorktree || !project || preparing || imageDraft.loading) return;
```

   Then replace the block from the comment `// Read the state only now: …` to the `if (!target || !latest …) { … }` check with:

```ts
    if (!target || projectRef.current?.path !== project.path) {
      setPreparing(false);
      return;
    }
    // A message sent while this chat's turn runs steers it; the reply streamed so far is saved first,
    // so it stays above the new message.
    if (target.session) agentRuns.splitForSteer(chatKey(project.path, target.session.id));
    // Read the state only now: a turn in another chat may have finished while the target resolved.
    const latest = stateRef.current;
    if (!latest) {
      setPreparing(false);
      return;
    }
```

6. Replace `sendMessage`:

```ts
  async function sendMessage() {
    const body = draft.trim();
    if ((!body && !imageDraft.images.length) || !state || !selectedWorktree || !project || preparing || imageDraft.loading) return;
    await executeSend(body, permissionMode);
  }
```

7. Delete `approvePending` and `denyPending`.

8. Replace the Escape effect:

```ts
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      // A menu, picker or search that Escape closed has already consumed it.
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (view === "settings") {
        event.preventDefault();
        setView("chat");
        return;
      }
      if (run && project && selectedSession) {
        event.preventDefault();
        // Escape denies the open approval; once that's answered, Escape stops the turn.
        const pending = run.approvals[0];
        if (pending && answering?.requestId !== pending.requestId) answerApproval("deny");
        else void agentRuns.interrupt(chatKey(project.path, selectedSession.id));
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [run, answering, project?.path, selectedSession?.id, view]);
```

9. In the `<ChatComposer …>` props:
   - Add `sendBlocked={preparing}` after `isSending={isSending}`.
   - Replace the whole `approval={approvalPrompt ? ( … ) : undefined}` prop with:

```tsx
            approval={pendingApproval ? (
              <PermissionCard
                key={pendingApproval.requestId}
                request={pendingApproval}
                waiting={(run?.approvals.length ?? 1) - 1}
                answering={answering?.requestId === pendingApproval.requestId ? answering.decision : null}
                onAnswer={answerApproval}
              />
            ) : undefined}
```

- [ ] **Step 5: Keep Send enabled while a turn runs**

In `app/src/components/ChatComposer.tsx`:

1. In `ChatComposerProps`, after `isSending: boolean;`, add:

```ts
  /** Sending is briefly blocked while a message is being prepared; a running turn doesn't block it. */
  sendBlocked: boolean;
```

2. Destructure `sendBlocked` after `isSending`.

3. On `<PromptComposer>`, replace `isSending={isSending}` with:

```tsx
          sendBlocked={sendBlocked}
          running={isSending}
```

In `app/src/components/PromptComposer.tsx`:

1. In `PromptComposerProps`, replace `isSending: boolean;` with:

```ts
  sendBlocked: boolean;
  /** A turn is running in this chat; a message sent now steers it. */
  running?: boolean;
```

2. In the destructuring, replace `isSending` with `sendBlocked, running = false`.

3. On the Send button, replace `disabled={!canSend || isSending || imageDraft.loading}` with `disabled={!canSend || sendBlocked || imageDraft.loading}`. In its `style`, replace `canSend && !isSending` with `canSend && !sendBlocked`.

4. Replace the textarea's placeholder expression with:

```tsx
placeholder={listening ? "Listening…" : running ? "Steer the agent…" : "Prompt or tag a worktree with @"}
```

- [ ] **Step 6: Update the README**

In `README.md`:

1. In the feature list, in the sentence about agent sessions, replace `and Escape cancels a running turn.` with `a message sent while the agent works steers it, and Escape cancels a running turn.`

2. Replace the feature line `- Tool approval cards for file changes and other write operations.` with:

```markdown
- Approval cards that show the exact command or file change an agent wants to make, with Allow once, Always allow in this chat, and Deny.
```

3. In the slash-skill section, delete the sentence `In Ask approval mode, slash requests require confirmation before the agent runs.`

4. Replace the three bullets under `## Permission modes` with:

```markdown
- **Ask approval**: the agent stops before a file edit or command it isn't already allowed to run, and shows the exact command or change. Claude asks before edits and before commands outside its allow rules; Codex asks before any command it doesn't already trust.
- **Auto**: file edits inside the workspace go ahead. Claude still asks before commands outside its allow rules; Codex works inside its workspace sandbox and asks only to go beyond it.
- **Full**: no approvals, and Codex runs without its sandbox. Use only when you trust the prompt and the workspace.

Escape denies an open approval card. "Always allow in this chat" lasts until the chat's agent session closes, and never changes your Claude or Codex settings files.
```

- [ ] **Step 7: Typecheck, test and build**

Run: `npm run test:agent`
Expected: PASS.

Run: `npm run build`
Expected: no TypeScript errors, and `✓ built`. Then confirm the old flow is fully gone:

Run: `grep -n "requiresApproval\|approvalPrompt\|denyPending\|approvePending" -r app/src`
Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add app/src README.md
git commit -m "feat: show agent approval cards and steer turns from the composer" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 8: Verify with the real CLIs

**Files:** none committed. Scripts live in the session scratchpad.

This task is run by the controller, not a subagent. Use an isolated Electron instance:

- this branch's Vite dev server on a free port;
- `--remote-debugging-port` and `--user-data-dir` in the scratchpad;
- the working directory set to a throwaway git repository.

Drive it with Playwright over CDP. Use `claude-haiku-4-5` for Claude and `gpt-6-sol` for Codex (gpt-6-luna ignores steering). Every check below must pass, with no page errors.

Victor follows from his phone, so send each step's screenshots to him with `SendUserFile` as soon as they exist, including any failures.

- [ ] **Step 1: Claude in Ask mode**
  - Ask: "Create hello.txt containing hi."
  - Expected: a card titled "Write hello.txt?" with the diff `+hi`.
  - **Allow once** → the file exists and the reply confirms it.
  - In a second chat, **Deny** → no file, and the reply says it was denied.

- [ ] **Step 2: Codex in Ask mode**
  - Ask: "Run ls."
  - Expected: a "Run this command?" card showing `ls` (no `/bin/zsh -lc` wrapper) and the repo's folder.
  - **Always allow in this chat** → the reply lists the files.

- [ ] **Step 3: Escape**
  - With a card open, Escape denies it.
  - A second Escape while the turn still runs cancels the turn.

- [ ] **Step 4: Interrupt and reload**
  - With a card open, reload the window.
  - Expected: no card and no "Working" state. The next message in that chat starts a turn normally.

- [ ] **Step 5: Steering**
  - Claude:
    - Ask it to run `sleep 3 && echo one` and then `sleep 3 && echo two` and reply DONE.
    - While it works, send "Skip the second command and reply BANANA."
    - Expected: the reply ends with BANANA. The chat reads: first message, reply so far, steering message, rest of the reply.
  - Codex (gpt-6-sol): the same check.

- [ ] **Step 6: Auto and Full**
  - In Auto, Claude writes a file inside the repo without a card.
  - In Full, Codex runs `ls` without a card.

- [ ] **Step 7: No question tool**
  - In Ask mode, ask Claude to "ask me a multiple-choice question using your question tool".
  - Expected: a question in the reply and no card.

- [ ] **Step 8: Record the results** in the pull request's "How was it verified?" section, with screenshots of a Claude edit card and a Codex command card.
