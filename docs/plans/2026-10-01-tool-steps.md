# Agent Sessions PR 3: Tool Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each command, file edit, read, search and other tool an agent runs appears as a compact row in its reply as it happens, for example "Ran `npm test`" or "Edited `App.tsx`". A row shows a spinner while the tool runs, then a check or "Failed". Clicking a row expands its output or diff. Rows sit in the reply where they happened, and saved replies keep them.

**Architecture:**

- **Step mapping.** A new pure module, `electron/agents/steps.cjs`, turns each agent's tool calls into steps:
  - `claudeStep` and `claudeStepResult` for Claude's `tool_use` and `tool_result` blocks;
  - `codexStep` and `codexStepResult` for Codex's `item/started` and `item/completed` items.
- **Event stream.** `events.cjs` emits `step-started`, `step-output` (Codex only) and `step-completed` from those mappers.
  - Claude: only top-level messages count. A subagent's own tool calls (`parent_tool_use_id` set) are dropped; the `Agent` call that started them is the step.
  - Codex: command output streams as `step-output`. `item/completed` then replaces it with the whole output.
- **Batching.** The session manager batches `step-output` per step the way it batches text, in 50 ms windows. Each batch keeps only its last 20,000 characters.
- **Approvals.** A `permission-request` names the step it is about (`stepId`). Both agents report a tool call before they ask, so the row appears first and says "Waiting for approval" while the card is open.
- **Renderer.**
  - Each chat's run keeps its steps. Each step records `offset`, the length of the reply text when it started.
  - When the turn ends, the steps are saved on the assistant message, with offsets into the saved (trimmed) body.
  - A pure `replyParts` splits a reply into text and step groups, and the chat renders them in order.
  - Steering: finished steps are saved with the reply so far. Running steps carry on in the rest of the reply.
  - A step still running when its turn ends is saved as done or failed with the turn. Codex sends no end for a command cut off by Stop.

**What the real CLIs send** (probed with Claude Code 2.1.287 through SDK 0.3.286 and codex-cli 0.158.0; details in the research report):

- **Claude, tool calls.**
  - Each assistant message carries one finished content block. A `tool_use` block arrives once its input is complete. The `stream_event` `content_block_start` for it has `input: {}`, and its input then streams as `input_json_delta`.
  - In Ask mode, `canUseTool` is called after the `tool_use` message.
  - The `tool_result` arrives in a later `user` message. Its `content` is a string or a list of blocks, and `is_error` is `true` on failure and absent or `false` otherwise.
  - The message also has `tool_use_result`, the tool's own output. Bash gives `{ stdout, stderr, interrupted }`; Edit and Write give `structuredPatch`. On failure it is a string like `"Error: …"`.
- **Claude, what never comes.** Bash output never streams: the result arrives whole when the command ends. `tool_progress` was never seen. The native 2.1.287 build has no `Grep` or `Glob` tool; Claude searches with `Bash` (`grep`, `find`).
- **Claude, special cases.**
  - Stop: a tool cut off by Stop gets a `tool_result` with `is_error: true` before the turn's `result`.
  - A denied approval comes back as `is_error: true` with content "Denied in Milagre".
  - Subagents: the `Agent` call's inner `tool_use` and `tool_result` messages carry `parent_tool_use_id`. A background agent's call completes at once with `tool_use_result.status: "async_launched"`. Its inner messages arrive after the turn's `result`, then Claude Code starts a new turn (opening with `system` `init`) to report.
- **Codex, the item lifecycle.**
  - `item/started` and `item/completed` wrap each item: `commandExecution`, `fileChange`, `mcpToolCall`, `webSearch`, and others.
  - In Ask mode `item/started` comes before the approval request for the same `itemId`.
  - `commandActions` classifies a command as `read`, `search`, `listFiles` or `unknown`.
  - A declined command completes with status `declined`.
  - A command running when the turn is interrupted gets no `item/completed`.
- **Codex, field quirks.**
  - `item/commandExecution/outputDelta` may skip the first chunk: a 4-line loop streamed lines 2 to 4. `aggregatedOutput` on completion has everything.
  - A `fileChange` `add` reports the new file's content as plain text, not a diff. An `update` is a unified hunk.
  - A `webSearch` starts with `query: ""` and only has its query on completion.

**Tech Stack:** Electron main process in CommonJS (`.cjs`), `@anthropic-ai/claude-agent-sdk@0.3.286`, `codex app-server` (codex-cli 0.158.0), React 19 + TypeScript renderer, Tailwind v4, `node --test`.

**Spec:** `docs/specs/002-agent-sessions.md`, delivery step 3 ("Tool steps"). The spec was amended in the same commit as this plan to match what the CLIs actually send:

- **Event stream.** `step-completed` gains `title?`, and its `detail` replaces anything streamed. A step still running when its turn ends gets no `step-completed`. `permission-request` gains `stepId?`. Step output is batched like text.
- **Mappings.**
  - The Claude mapping now says where blocks come from and adds `NotebookEdit` and `WebSearch`.
  - It notes that Claude Code has no `Grep`/`Glob` tool and how subagents and background agents show.
  - The Codex mapping covers every tool item type, `commandActions`, the output-delta caveat, failures, and the plain-text content of new and deleted files.
- **Persistence.** `ChatStep` gains `offset?`. A step running at the turn's end is saved as done or failed. Command output keeps its end when capped. A reply with steps and no text saves an empty body.
- **Renderer.** Rows sit where they happened, and a row waiting on the approval card says so. Steering saves finished steps with the reply so far.

Read the sections "Event stream", "Claude provider", "Codex provider", "Persistence" and "Renderer" before starting.

## Global Constraints

- **Main process.**
  - It stays CommonJS.
  - `@anthropic-ai/claude-agent-sdk` stays pinned to exactly `0.3.286`.
  - No new dependencies.
- **Step shape.**
  - Events carry `{ id, kind, title, detail? }` at the start and `{ id, status, title?, detail? }` at the end. Saved steps are `{ id, kind, title, status, detail?, offset? }`.
  - `kind` is exactly one of `shell`, `edit`, `read`, `search`, `other`. `status` is `running` (live only), `done` or `failed`.
  - Objects have no `undefined` fields.
- **Titles** are past tense, with code between backticks. The forms are exactly:
  - Claude:
    - Bash: "Ran `<command>`"; Read: "Read `<file>`"
    - Edit, MultiEdit, NotebookEdit: "Edited `<file>`"; Write: "Wrote `<file>`"
    - Grep: "Searched for `<pattern>`" plus " in `<path>`" when a path is given; Glob: "Found files matching `<pattern>`"
    - WebSearch: "Searched the web for `<query>`"; WebFetch: "Fetched `<url>`"
    - Agent and Task: "Ran an agent: <description>", or "Started an agent: <description>" when it launched in the background
    - TodoWrite: "Updated the to-do list"; `mcp__<server>__<tool>`: "Used `<tool>` from <server>"; anything else: "Used <name>"
  - Codex:
    - a command: "Ran `<command>`", "Read `<file>`", "Searched for `<query>`" (plus " in `<path>`"), "Listed files" or "Listed files in `<path>`"
    - a fileChange: "Created `<file>`", "Deleted `<file>`", "Edited `<file>`" or "Edited <n> files"
    - "Used `<tool>` from <server>" for MCP; "Used `<tool>`" for a dynamic tool
    - "Searched the web", then "Searched the web for `<query>`" on completion; "Viewed `<file>`" for an image
  - `<file>` is the base name. Text in backticks is one line of at most 80 characters, with whitespace collapsed and its own backticks turned into `'`.
- **Detail.**
  - A command's detail is `$ <command>\n<output>`, starting as `$ <command>\n`. It keeps its last 20,000 characters, after a `… truncated\n` line.
  - Diffs and other details keep their first 20,000 characters, followed by `\n… truncated` (the existing `capText`).
  - A read that worked keeps no detail.
  - `step-completed`'s detail replaces the streamed one; when it has none, the step keeps none.
- **Ordering.** Every non-delta event flushes pending text and output before it is sent, so a step's offset is exact.
- **Turn end.** Steps still running are saved as `done` when the turn completed, and `failed` when it failed or was cancelled.
- **Saved data.** `coordination.json` changes stay additive (`steps?`, `offset?`); older files load unchanged.
- **Tests.**
  - Agent tests live next to the code (`electron/agents/*.test.cjs`). Renderer logic tests are `app/src/lib/*.test.ts`.
  - `npm run test:agent` runs them all, and `npm run build` must stay clean (it includes `tsc --noEmit`).
- **Commits.** Use `/usr/bin/git`. Every commit message ends with the paragraph `Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5`.

## Review Focus

1. **A row in the wrong place.** The reply's text is trimmed when saved, and Claude and Codex insert `\n\n` between text blocks.
   - Expected: every row sits between the same sentences live and after a reload.
   - Pinned in Task 5 ("a finished reply saves its steps where they happened in the trimmed text") and Task 6 ("steps sit between the text around them, in order").
2. **Steering while a command runs.** The steered reply is split while a step is still running, and that step's end arrives after the split.
   - Expected: finished rows stay above the steering message. The running row continues below it and is saved once.
   - Pinned in Task 5 ("a steer saves finished steps with the reply so far; running ones carry on below the new message" and "a steer with only finished steps and no text still saves them").
3. **A spinner that never stops.** Codex sends no `item/completed` for a command cut off by Stop.
   - Expected: when the turn ends, no row is left running, live or saved.
   - Pinned in Task 3 ("a command still running when the turn is stopped gets no step-completed") and Task 5 ("a step still running when the turn ends is saved as done or failed with the turn").
4. **Subagent tool calls leaking into the reply.** They may also arrive after the turn has ended, from a background agent.
   - Expected: one row for the `Agent` call, showing the agent's report; nothing from inside the agent.
   - Pinned in Task 2 ("agents show their report, or that they started in the background") and Task 3 ("a subagent's own tool calls are not steps").
5. **Huge command output.** `cat` of a large file or a noisy build must not flood IPC, grow memory without bound, or bloat `coordination.json`.
   - Expected: at most 20,000 characters per step anywhere, keeping the end of command output.
   - Pinned in Task 2 ("command output keeps its end when it's long"), Task 4 ("a batch of command output keeps only its end") and Task 5 ("streamed output keeps its last 20,000 characters").

---

### Task 1: Approval requests name their step; Codex new-file diffs get `+` lines

**Files:**
- Modify: `electron/agents/permissions.cjs`
- Modify: `electron/agents/permissions.test.cjs`
- Modify: `electron/agents/fixtures/fake-app-server.cjs`
- Modify: `electron/agents/codex-provider.test.cjs`
- Modify: `electron/agents/claude-provider.test.cjs`

**Interfaces:**
- Produces, in `electron/agents/permissions.cjs`:
  - `codexChangesDiff(changes) → string`: diff text for Codex `FileUpdateChange`s. `add` content becomes `+` lines, `delete` content becomes `-` lines, and an `update` hunk is kept as is. Each change sits under a `--- <path>` header, and the result is capped with `capText`.
  - `claudeEditDiff(toolName, input) → string`, already there and now exported.
  - Requests gain `stepId`: `options.toolUseID` for Claude, `params.itemId` for Codex. It is absent when the agent gives none.

The probe showed a Codex `add` change's `diff` is the file's content (`"one\ntwo\n"`), not a diff. Today's card shows it without `+` markers, and the fake app-server's `"+hello\n"` was wrong.

- [ ] **Step 1: Write the failing tests**

In `electron/agents/permissions.test.cjs`:

1. Add `codexChangesDiff,` to the `require("./permissions.cjs")` list, after `claudeResult,`.

2. In "Claude: a shell command shows the command", replace the expected object with:

```js
  assert.deepEqual(request, { requestId: "r1", kind: "command", tool: "Bash", title: "Run this command?", command: "npm test", allowForChat: true, stepId: "t1" });
```

3. In "Codex: command requests", replace the first expected object's last line `requestId: "srv-1", … allowForChat: true,` with:

```js
    requestId: "srv-1", kind: "command", tool: "Shell", title: "Run this command?", command: "rm -rf build", cwd: "/repo", reason: "Clean the build", allowForChat: true, stepId: "c",
```

4. In "Codex: file requests show the changes Codex reported when the edit started", replace the `changes` line and the first `assert.deepEqual` with:

```js
  const changes = [{ path: "/repo/notes.txt", kind: { type: "add" }, diff: "hello\n" }];
  assert.deepEqual(codexFileRequest("srv-2", { itemId: "p", reason: "Write notes" }, changes), {
    requestId: "srv-2", kind: "edit", tool: "Edit files", title: "Edit notes.txt?", files: ["/repo/notes.txt"], diff: "--- /repo/notes.txt\n+hello", reason: "Write notes", allowForChat: true, stepId: "p",
  });
```

5. Add before `test("Codex: decisions", …)`:

```js
test("Codex: new and deleted files are whole contents; updates are already diffs", () => {
  assert.equal(codexChangesDiff([
    { path: "/repo/new.txt", kind: { type: "add" }, diff: "one\ntwo\n" },
    { path: "/repo/old.txt", kind: { type: "delete" }, diff: "gone\n" },
    { path: "/repo/app.js", kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-Hello\n+Hi\n" },
  ]), "--- /repo/new.txt\n+one\n+two\n--- /repo/old.txt\n-gone\n--- /repo/app.js\n@@ -1 +1 @@\n-Hello\n+Hi\n");
});
```

In `electron/agents/fixtures/fake-app-server.cjs`, in the `file-approval` scenario, change the change's `diff: "+hello\n"` to `diff: "hello\n"`.

In `electron/agents/codex-provider.test.cjs`:

1. In "asks before running a command and passes the answer back", the expected `permission-request` ends with `allowForChat: true, stepId: "cmd-1",`.
2. In "file changes show the diff Codex is about to apply", the expected `permission-request` is:

```js
    type: "permission-request", requestId: "srv-1", kind: "edit", tool: "Edit files", title: "Edit notes.txt?", files: ["/repo/notes.txt"], diff: "--- /repo/notes.txt\n+hello", reason: "Write notes", allowForChat: true, stepId: "patch-1",
```

In `electron/agents/claude-provider.test.cjs`, in "asks before a tool runs and passes the answer back", the expected `permission-request` ends with `allowForChat: true, stepId: "tool-1",`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test electron/agents/permissions.test.cjs electron/agents/codex-provider.test.cjs electron/agents/claude-provider.test.cjs`
Expected: FAIL. `codexChangesDiff is not a function`, and the request objects lack `stepId`.

- [ ] **Step 3: Implement**

In `electron/agents/permissions.cjs`:

1. Replace the header comment's request shape and the line after it:

```js
//   { requestId, kind: "command"|"edit"|"other", tool, title, description?, command?, cwd?,
//     diff?, files?, detail?, reason?, allowForChat, stepId? }
// where stepId names the tool step (see steps.cjs) the request is about,
// and a decision is "allow" | "allow-for-chat" | "deny", or "cancelled" when the turn stops first.
```

2. In `claudeRequest`'s `base`, add after the `allowForChat` line:

```js
    stepId: options.toolUseID || undefined,
```

3. In `codexCommandRequest`, add after `allowForChat: true,`:

```js
    stepId: params.itemId ?? undefined,
```

4. Add before the comment `// item/fileChange/requestApproval params -> request.`:

```js
// Codex reports a new file's whole content and a deleted file's old content as plain text, and an
// update as a unified diff hunk. Each becomes diff text under a `--- path` header.
function codexChangesDiff(changes) {
  return capText(changes.map((change) => {
    const text = String(change.diff ?? "");
    const type = change.kind?.type;
    const body = type === "add" ? prefixLines(text.replace(/\n$/, ""), "+") : type === "delete" ? prefixLines(text.replace(/\n$/, ""), "-") : text;
    return `--- ${change.path}\n${body}`;
  }).join("\n"));
}
```

5. In `codexFileRequest`, replace the `diff:` line and add `stepId` after `allowForChat: true,`:

```js
    diff: changes.length ? codexChangesDiff(changes) : undefined,
    reason: params.reason ?? undefined,
    allowForChat: true,
    stepId: params.itemId ?? undefined,
```

6. In `module.exports`, add `claudeEditDiff,` after `capText,` and `codexChangesDiff,` after `claudeResult,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test electron/agents/permissions.test.cjs electron/agents/codex-provider.test.cjs electron/agents/claude-provider.test.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add electron/agents/permissions.cjs electron/agents/permissions.test.cjs electron/agents/fixtures/fake-app-server.cjs electron/agents/codex-provider.test.cjs electron/agents/claude-provider.test.cjs
/usr/bin/git commit -m "fix: show new Codex files as added lines, and tie approval requests to their tool call" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 2: Step mapping

**Files:**
- Create: `electron/agents/steps.cjs`
- Test: `electron/agents/steps.test.cjs`

**Interfaces:**
- Consumes: `capText`, `claudeEditDiff`, `codexChangesDiff`, `unwrapShell` from `permissions.cjs` (Task 1).
- Produces, in `electron/agents/steps.cjs`:
  - `claudeStep(id, name, input) → { id, kind, title, detail? }`
  - `claudeStepResult(call, block, structured) → { id, status, title?, detail? }`. `call` is the `tool_use` block `{ id, name, input }`, `block` is its `tool_result` block, and `structured` is the message's `tool_use_result`.
  - `codexStep(item) → { id, kind, title, detail? } | null`. It returns null for items that aren't tool calls.
  - `codexStepResult(item) → { id, status, title?, detail? }`
  - `capOutput(text) → string`: keeps the last 20,000 characters after a `… truncated\n` line.
  - `MAX_OUTPUT` (20,000)

- [ ] **Step 1: Write the failing tests**

Create `electron/agents/steps.test.cjs`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { capOutput, claudeStep, claudeStepResult, codexStep, codexStepResult } = require("./steps.cjs");

// Shapes recorded from Claude Code 2.1.287 and codex-cli 0.158.0.
const ok = (content, extra = {}) => ({ type: "tool_result", tool_use_id: "t", content, ...extra });

test("Claude: commands, reads and edits get a title and a kind", () => {
  assert.deepEqual(claudeStep("t1", "Bash", { command: "npm test", description: "Run tests" }), { id: "t1", kind: "shell", title: "Ran `npm test`", detail: "$ npm test\n" });
  assert.deepEqual(claudeStep("t2", "Read", { file_path: "/repo/src/App.tsx" }), { id: "t2", kind: "read", title: "Read `App.tsx`" });
  assert.deepEqual(claudeStep("t3", "Edit", { file_path: "/repo/src/App.tsx", old_string: "a", new_string: "b" }), { id: "t3", kind: "edit", title: "Edited `App.tsx`" });
  assert.deepEqual(claudeStep("t4", "Write", { file_path: "/repo/notes.txt", content: "hi" }), { id: "t4", kind: "edit", title: "Wrote `notes.txt`" });
  assert.equal(claudeStep("t5", "NotebookEdit", { notebook_path: "/repo/a.ipynb" }).title, "Edited `a.ipynb`");
  assert.deepEqual(claudeStep("t6", "Grep", { pattern: "greet", path: "src" }), { id: "t6", kind: "search", title: "Searched for `greet` in `src`" });
  assert.deepEqual(claudeStep("t7", "Glob", { pattern: "**/*.js" }), { id: "t7", kind: "search", title: "Found files matching `**/*.js`" });
  assert.deepEqual(claudeStep("t8", "WebSearch", { query: "IANA example domain" }), { id: "t8", kind: "search", title: "Searched the web for `IANA example domain`" });
});

test("Claude: other tools say what they used", () => {
  assert.deepEqual(claudeStep("t1", "WebFetch", { url: "https://example.com", prompt: "x" }), { id: "t1", kind: "other", title: "Fetched `https://example.com`" });
  assert.deepEqual(claudeStep("t2", "Agent", { description: "List files", prompt: "Run ls", subagent_type: "general-purpose" }), { id: "t2", kind: "other", title: "Ran an agent: List files" });
  assert.equal(claudeStep("t3", "TodoWrite", { todos: [] }).title, "Updated the to-do list");
  assert.equal(claudeStep("t4", "mcp__argent__list-devices", {}).title, "Used `list-devices` from argent");
  assert.equal(claudeStep("t5", "ToolSearch", { query: "select:Glob" }).title, "Used ToolSearch");
});

test("Claude: long or multi-line commands become one short line, without stray backticks", () => {
  const step = claudeStep("t1", "Bash", { command: "cat <<'EOF' > a.txt\nhello `world`\nEOF" });
  assert.equal(step.title, "Ran `cat <<'EOF' > a.txt hello 'world' EOF`");
  assert.equal(step.detail, "$ cat <<'EOF' > a.txt\nhello `world`\nEOF\n");
  const long = claudeStep("t2", "Bash", { command: "x".repeat(200) }).title;
  assert.equal(long, `Ran \`${"x".repeat(79)}…\``);
});

test("Claude: a command's result is its output; a failure is marked failed", () => {
  const bash = { id: "t1", name: "Bash", input: { command: "echo out" } };
  assert.deepEqual(claudeStepResult(bash, ok("out", { is_error: false }), { stdout: "out", stderr: "", interrupted: false }), { id: "t1", status: "done", detail: "$ echo out\nout" });
  const missing = { id: "t2", name: "Bash", input: { command: "cat missing.txt" } };
  assert.deepEqual(claudeStepResult(missing, ok("Exit code 1\ncat: missing.txt: No such file or directory", { is_error: true }), "Error: Exit code 1"), {
    id: "t2", status: "failed", detail: "$ cat missing.txt\nExit code 1\ncat: missing.txt: No such file or directory",
  });
  const denied = claudeStepResult({ id: "t3", name: "Write", input: { file_path: "/a", content: "x" } }, ok("Denied in Milagre", { is_error: true }), "Error: Denied in Milagre");
  assert.deepEqual(denied, { id: "t3", status: "failed", detail: "Denied in Milagre" });
});

test("Claude: a read keeps no output unless it failed", () => {
  const read = { id: "t1", name: "Read", input: { file_path: "/repo/a.js" } };
  assert.deepEqual(claudeStepResult(read, ok("1\texport const a = 1;\n")), { id: "t1", status: "done" });
  assert.deepEqual(claudeStepResult(read, ok("File does not exist.", { is_error: true })), { id: "t1", status: "failed", detail: "File does not exist." });
});

test("Claude: edits show Claude Code's own patch, or the change from the input", () => {
  const edit = { id: "t1", name: "Edit", input: { file_path: "/repo/app.js", old_string: "  return `Hello ${name}`;", new_string: "  return `Hi ${name}`;" } };
  const structured = { filePath: "/repo/app.js", structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [" export function greet(name) {", "-  return `Hello ${name}`;", "+  return `Hi ${name}`;", " }"] }] };
  assert.deepEqual(claudeStepResult(edit, ok("The file /repo/app.js has been updated successfully."), structured), {
    id: "t1", status: "done", detail: "@@ -1,3 +1,3 @@\n export function greet(name) {\n-  return `Hello ${name}`;\n+  return `Hi ${name}`;\n }",
  });
  const write = { id: "t2", name: "Write", input: { file_path: "/repo/notes.txt", content: "one\ntwo" } };
  assert.deepEqual(claudeStepResult(write, ok("File created successfully at: /repo/notes.txt"), { type: "create", structuredPatch: [], originalFile: null }), { id: "t2", status: "done", detail: "+one\n+two" });
});

test("Claude: agents show their report, or that they started in the background", () => {
  const agent = { id: "t1", name: "Agent", input: { description: "List files", prompt: "Run ls" } };
  const report = { status: "completed", content: [{ type: "text", text: "README.md and src." }], totalToolUseCount: 2 };
  assert.deepEqual(claudeStepResult(agent, ok([{ type: "text", text: "[Subagent hand-back] …" }]), report), { id: "t1", status: "done", detail: "README.md and src." });
  const launched = { isAsync: true, status: "async_launched", agentId: "a1", description: "List files", prompt: "Run ls", outputFile: "/tmp/a1.output" };
  assert.deepEqual(claudeStepResult(agent, ok([{ type: "text", text: "Async agent launched successfully." }]), launched), { id: "t1", status: "done", title: "Started an agent: List files" });
});

test("Claude: other results show their text; to-do lists show the items", () => {
  assert.deepEqual(claudeStepResult({ id: "t1", name: "WebFetch", input: {} }, ok([{ type: "text", text: "Page text" }, { type: "image" }])), { id: "t1", status: "done", detail: "Page text\n[image]" });
  assert.deepEqual(claudeStepResult({ id: "t2", name: "ToolSearch", input: {} }, ok("")), { id: "t2", status: "done" });
  const todos = { id: "t3", name: "TodoWrite", input: { todos: [{ content: "Write tests", status: "completed" }, { content: "Ship", status: "in_progress" }, { content: "Celebrate", status: "pending" }] } };
  assert.deepEqual(claudeStepResult(todos, ok("Todos have been modified successfully.")), { id: "t3", status: "done", detail: "[x] Write tests\n[~] Ship\n[ ] Celebrate" });
});

const command = (overrides = {}) => ({
  type: "commandExecution", id: "exec-1", command: "/bin/zsh -lc 'npm test'", cwd: "/repo", processId: null, source: "agent", status: "inProgress",
  commandActions: [{ type: "unknown", command: "npm test" }], aggregatedOutput: null, exitCode: null, durationMs: null, ...overrides,
});

test("Codex: commands show the command without the shell wrapper", () => {
  assert.deepEqual(codexStep(command()), { id: "exec-1", kind: "shell", title: "Ran `npm test`", detail: "$ npm test\n" });
  assert.deepEqual(codexStepResult(command({ status: "completed", aggregatedOutput: "ok 1\nok 2\n", exitCode: 0 })), { id: "exec-1", status: "done", detail: "$ npm test\nok 1\nok 2\n" });
  assert.deepEqual(codexStepResult(command({ status: "failed", aggregatedOutput: "1 failing\n", exitCode: 1 })), { id: "exec-1", status: "failed", detail: "$ npm test\n1 failing\n" });
  assert.deepEqual(codexStepResult(command({ status: "declined" })), { id: "exec-1", status: "failed", detail: "$ npm test\nDeclined." });
});

test("Codex: reads, searches and listings Codex recognised get their own kind", () => {
  const read = command({ command: "/bin/zsh -lc 'cat src/app.js'", commandActions: [{ type: "read", command: "cat src/app.js", name: "app.js", path: "/repo/src/app.js" }] });
  assert.deepEqual(codexStep(read), { id: "exec-1", kind: "read", title: "Read `app.js`", detail: "$ cat src/app.js\n" });
  assert.deepEqual(codexStepResult({ ...read, status: "completed", exitCode: 0, aggregatedOutput: "export function greet() {}\n" }), { id: "exec-1", status: "done" });
  assert.deepEqual(codexStepResult({ ...read, status: "failed", exitCode: 1, aggregatedOutput: "cat: src/app.js: No such file or directory\n" }), { id: "exec-1", status: "failed", detail: "$ cat src/app.js\ncat: src/app.js: No such file or directory\n" });

  const search = command({ command: "/bin/zsh -lc 'rg -n greet src'", commandActions: [{ type: "search", command: "rg -n greet src", query: "greet", path: "src" }] });
  assert.deepEqual(codexStep(search), { id: "exec-1", kind: "search", title: "Searched for `greet` in `src`", detail: "$ rg -n greet src\n" });
  const list = command({ command: "/bin/zsh -lc ls", commandActions: [{ type: "listFiles", command: "ls", path: null }] });
  assert.deepEqual(codexStep(list), { id: "exec-1", kind: "search", title: "Listed files", detail: "$ ls\n" });
  const both = command({ command: "/bin/zsh -lc 'cat a && cat b'", commandActions: [{ type: "read", command: "cat a", name: "a", path: "/a" }, { type: "read", command: "cat b", name: "b", path: "/b" }] });
  assert.equal(codexStep(both).kind, "shell");
});

test("Codex: file changes show what changed and the diff", () => {
  const created = { type: "fileChange", id: "exec-2", status: "inProgress", changes: [{ path: "/repo/notes.txt", kind: { type: "add" }, diff: "one\ntwo\n" }] };
  assert.deepEqual(codexStep(created), { id: "exec-2", kind: "edit", title: "Created `notes.txt`" });
  assert.deepEqual(codexStepResult({ ...created, status: "completed" }), { id: "exec-2", status: "done", title: "Created `notes.txt`", detail: "--- /repo/notes.txt\n+one\n+two" });
  const edited = { type: "fileChange", id: "exec-3", status: "declined", changes: [{ path: "/repo/app.js", kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-a\n+b\n" }, { path: "/repo/old.js", kind: { type: "delete" }, diff: "gone\n" }] };
  assert.deepEqual(codexStep(edited).title, "Edited 2 files");
  assert.deepEqual(codexStepResult(edited), { id: "exec-3", status: "failed", title: "Edited 2 files", detail: "--- /repo/app.js\n@@ -1 +1 @@\n-a\n+b\n\n--- /repo/old.js\n-gone" });
});

test("Codex: MCP tools, web searches and images", () => {
  const mcp = { type: "mcpToolCall", id: "exec-4", server: "argent", tool: "list-devices", status: "inProgress", arguments: {}, result: null, error: null };
  assert.deepEqual(codexStep(mcp), { id: "exec-4", kind: "other", title: "Used `list-devices` from argent" });
  assert.deepEqual(codexStepResult({ ...mcp, status: "completed", result: { content: [{ type: "text", text: "{\"devices\":[]}" }], structuredContent: null } }), { id: "exec-4", status: "done", detail: "{\"devices\":[]}" });
  assert.deepEqual(codexStepResult({ ...mcp, status: "failed", error: { message: "server not running" } }), { id: "exec-4", status: "failed", detail: "server not running" });

  // Codex only knows the query once the search is done.
  const search = { type: "webSearch", id: "exec-5", query: "", action: null, results: null };
  assert.deepEqual(codexStep(search), { id: "exec-5", kind: "search", title: "Searched the web" });
  const found = { ...search, query: "IANA example domain", action: { type: "search", query: "IANA example domain", queries: null }, results: [{ type: "text_result", title: "Example Domains", url: "https://www.iana.org/help/example-domains", snippet: "…" }] };
  assert.deepEqual(codexStepResult(found), { id: "exec-5", status: "done", title: "Searched the web for `IANA example domain`", detail: "Example Domains\nhttps://www.iana.org/help/example-domains" });

  assert.deepEqual(codexStep({ type: "imageView", id: "exec-6", path: "/repo/shot.png" }), { id: "exec-6", kind: "read", title: "Viewed `shot.png`" });
  assert.deepEqual(codexStep({ type: "dynamicToolCall", id: "exec-7", tool: "lookup", arguments: {}, status: "inProgress" }), { id: "exec-7", kind: "other", title: "Used `lookup`" });
});

test("Codex: messages, reasoning and other items are not steps", () => {
  for (const type of ["agentMessage", "reasoning", "userMessage", "plan", "contextCompaction", "somethingNew"]) assert.equal(codexStep({ type, id: "x" }), null);
});

test("command output keeps its end when it's long", () => {
  assert.equal(capOutput("short"), "short");
  const capped = capOutput(`${"a".repeat(5_000)}${"b".repeat(20_000)}`);
  assert.equal(capped, `… truncated\n${"b".repeat(20_000)}`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test electron/agents/steps.test.cjs`
Expected: FAIL with `Cannot find module './steps.cjs'`.

- [ ] **Step 3: Implement `steps.cjs`**

Create `electron/agents/steps.cjs`:

```js
const path = require("node:path");
const { capText, claudeEditDiff, codexChangesDiff, unwrapShell } = require("./permissions.cjs");

// Tool steps: each command, edit, read, search or other tool call an agent makes, as the rows of
// its reply. A step starts as { id, kind, title, detail? } and ends as { id, status, title?, detail? }:
//   kind    "shell" | "edit" | "read" | "search" | "other"
//   title   what it did, past tense, with code between backticks: "Ran `npm test`", "Edited `App.tsx`"
//   status  "done" | "failed"
//   detail  a command and its output ("$ npm test\n…"), a unified diff, or the tool's result text.
//           The detail a step ends with replaces anything streamed into it. A read that worked keeps none.
// A title given at the end replaces the first one, for agents that only know it then.

const MAX_OUTPUT = 20_000;
const TRUNCATED = "… truncated";
const CLAUDE_EDIT_TOOLS = new Set(["Edit", "MultiEdit", "NotebookEdit"]);
const CLAUDE_AGENT_TOOLS = new Set(["Agent", "Task"]);

// Command output keeps its end, where results and errors are; diffs and other details keep their start.
function capOutput(text) {
  return text.length > MAX_OUTPUT ? `${TRUNCATED}\n${text.slice(-MAX_OUTPUT)}` : text;
}

// Text shown as code in a title: one line of at most 80 characters, with no backticks of its own.
function code(text, max = 80) {
  const flat = String(text ?? "").trim().replace(/`/g, "'").replace(/\s+/g, " ");
  return `\`${flat.length > max ? `${flat.slice(0, max - 1)}…` : flat}\``;
}

const fileName = (file) => (file ? code(path.basename(String(file))) : "a file");

// Drops undefined fields so steps stay plain and compare cleanly.
function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

// A tool result's content is a string or a list of blocks.
function blocksText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (block?.type === "text" ? block.text : block?.type ? `[${block.type}]` : "")).filter(Boolean).join("\n");
}

// --- Claude ---

function claudeStep(id, name, input = {}) {
  const step = (kind, title, detail) => compact({ id: String(id), kind, title, detail });
  if (name === "Bash") return step("shell", `Ran ${code(input.command)}`, `$ ${input.command ?? ""}\n`);
  if (name === "Read") return step("read", `Read ${fileName(input.file_path)}`);
  if (CLAUDE_EDIT_TOOLS.has(name)) return step("edit", `Edited ${fileName(input.file_path ?? input.notebook_path)}`);
  if (name === "Write") return step("edit", `Wrote ${fileName(input.file_path)}`);
  if (name === "Grep") return step("search", `Searched for ${code(input.pattern)}${input.path ? ` in ${code(input.path)}` : ""}`);
  if (name === "Glob") return step("search", `Found files matching ${code(input.pattern)}`);
  if (name === "WebSearch") return step("search", `Searched the web for ${code(input.query)}`);
  if (name === "WebFetch") return step("other", `Fetched ${code(input.url)}`);
  if (CLAUDE_AGENT_TOOLS.has(name)) return step("other", `Ran an agent: ${input.description || "a subtask"}`);
  if (name === "TodoWrite") return step("other", "Updated the to-do list");
  const mcp = /^mcp__(.+?)__(.+)$/.exec(String(name));
  if (mcp) return step("other", `Used ${code(mcp[2])} from ${mcp[1]}`);
  return step("other", `Used ${name}`);
}

// Claude's structured patch (Edit and Write results) as unified diff hunks.
function patchDiff(result) {
  const hunks = result?.structuredPatch;
  if (!Array.isArray(hunks) || !hunks.length) return undefined;
  return capText(hunks.map((hunk) => [`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...(hunk.lines ?? [])].join("\n")).join("\n"));
}

const TODO_MARKS = { completed: "[x]", in_progress: "[~]", pending: "[ ]" };

// call: the tool_use block { id, name, input }; block: its tool_result; structured: the message's
// tool_use_result, the tool's own output object.
function claudeStepResult(call, block, structured) {
  const { name, input = {} } = call;
  const failed = block.is_error === true;
  const text = blocksText(block.content);
  const end = (extra = {}) => compact({ id: String(call.id), status: failed ? "failed" : "done", ...extra });
  if (name === "Bash") return end({ detail: capOutput(`$ ${input.command ?? ""}\n${text}`) });
  if (failed) return end({ detail: text ? capText(text) : undefined });
  if (name === "Read") return end();
  if (CLAUDE_EDIT_TOOLS.has(name) || name === "Write") return end({ detail: patchDiff(structured) ?? claudeEditDiff(name, input) });
  if (CLAUDE_AGENT_TOOLS.has(name) && structured?.status === "async_launched") return end({ title: `Started an agent: ${input.description || "a subtask"}` });
  if (CLAUDE_AGENT_TOOLS.has(name) && Array.isArray(structured?.content)) return end({ detail: capText(blocksText(structured.content)) || undefined });
  if (name === "TodoWrite" && Array.isArray(input.todos)) return end({ detail: input.todos.map((todo) => `${TODO_MARKS[todo.status] ?? "[ ]"} ${todo.content}`).join("\n") });
  return end({ detail: text ? capText(text) : undefined });
}

// --- Codex ---

// A command Codex recognised as one read, search or listing shows as that; anything else is a shell step.
function commandAction(item) {
  const actions = item.commandActions ?? [];
  return actions.length === 1 && actions[0]?.type !== "unknown" ? actions[0] : null;
}

function changeTitle(changes) {
  if (changes.length !== 1) return changes.length ? `Edited ${changes.length} files` : "Edited files";
  const type = changes[0].kind?.type;
  return `${type === "add" ? "Created" : type === "delete" ? "Deleted" : "Edited"} ${fileName(changes[0].path)}`;
}

function webSearchTitle(item) {
  const action = item.action ?? {};
  if (action.type === "openPage" && action.url) return `Opened ${code(action.url)}`;
  if (action.type === "findInPage" && action.url) return `Searched ${code(action.url)}${action.pattern ? ` for ${code(action.pattern)}` : ""}`;
  const query = item.query || action.query || action.queries?.[0];
  return query ? `Searched the web for ${code(query)}` : "Searched the web";
}

function webResults(results) {
  if (!Array.isArray(results)) return undefined;
  const lines = results.map((result) => [result?.title, result?.url].filter((part) => typeof part === "string" && part).join("\n")).filter(Boolean);
  return lines.length ? capText(lines.join("\n\n")) : undefined;
}

// item/started item -> step, or null for items that aren't tool calls (messages, reasoning, plans…).
function codexStep(item) {
  const step = (kind, title, detail) => compact({ id: String(item.id), kind, title, detail });
  switch (item.type) {
    case "commandExecution": {
      const command = unwrapShell(String(item.command ?? ""));
      const action = commandAction(item);
      const detail = `$ ${command}\n`;
      if (action?.type === "read") return step("read", `Read ${code(action.name || path.basename(String(action.path ?? command)))}`, detail);
      if (action?.type === "search") return step("search", action.query ? `Searched for ${code(action.query)}${action.path ? ` in ${code(action.path)}` : ""}` : `Searched ${code(action.path || command)}`, detail);
      if (action?.type === "listFiles") return step("search", action.path ? `Listed files in ${code(action.path)}` : "Listed files", detail);
      return step("shell", `Ran ${code(command)}`, detail);
    }
    case "fileChange":
      return step("edit", changeTitle(item.changes ?? []));
    case "mcpToolCall":
      return step("other", `Used ${code(item.tool)} from ${item.server}`);
    case "dynamicToolCall":
      return step("other", `Used ${code(item.tool)}`);
    case "webSearch":
      return step("search", webSearchTitle(item));
    case "imageView":
      return step("read", `Viewed ${fileName(item.path)}`);
    default:
      return null;
  }
}

// item/completed item -> the end of its step.
function codexStepResult(item) {
  const id = String(item.id);
  switch (item.type) {
    case "commandExecution": {
      const failed = item.status !== "completed" || (item.exitCode ?? 0) !== 0;
      const status = failed ? "failed" : "done";
      if (!failed && commandAction(item)?.type === "read") return { id, status };
      const output = item.status === "declined" ? "Declined." : item.aggregatedOutput ?? "";
      return { id, status, detail: capOutput(`$ ${unwrapShell(String(item.command ?? ""))}\n${output}`) };
    }
    case "fileChange": {
      const changes = item.changes ?? [];
      return compact({ id, status: item.status === "completed" ? "done" : "failed", title: changeTitle(changes), detail: changes.length ? codexChangesDiff(changes) : undefined });
    }
    case "mcpToolCall":
      return compact({ id, status: item.status === "completed" ? "done" : "failed", detail: capText(item.error?.message ?? blocksText(item.result?.content)) || undefined });
    case "dynamicToolCall": {
      const text = (item.contentItems ?? []).map((content) => (typeof content?.text === "string" ? content.text : "")).filter(Boolean).join("\n");
      return compact({ id, status: item.status === "completed" && item.success !== false ? "done" : "failed", detail: text ? capText(text) : undefined });
    }
    case "webSearch":
      return compact({ id, status: "done", title: webSearchTitle(item), detail: webResults(item.results) });
    default:
      return { id, status: item.status === "failed" ? "failed" : "done" };
  }
}

module.exports = { MAX_OUTPUT, capOutput, claudeStep, claudeStepResult, codexStep, codexStepResult };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test electron/agents/steps.test.cjs`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add electron/agents/steps.cjs electron/agents/steps.test.cjs
/usr/bin/git commit -m "feat: map Claude and Codex tool calls to tool steps" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 3: Steps in the event stream

**Files:**
- Modify: `electron/agents/events.cjs`
- Modify: `electron/agents/events.test.cjs`
- Modify: `electron/agents/codex-provider.cjs`
- Modify: `electron/agents/fixtures/fake-app-server.cjs`
- Modify: `electron/agents/codex-provider.test.cjs`
- Modify: `electron/agents/claude-provider.test.cjs`

**Interfaces:**
- Consumes: `claudeStep`, `claudeStepResult`, `codexStep`, `codexStepResult` (Task 2).
- Produces events: `{ type: "step-started", step }`, `{ type: "step-output", id, text }`, `{ type: "step-completed", id, status, title?, detail? }`.
- State:
  - Claude's mapper state gains `tools`, a lazily created `Map` of tool_use id → block.
  - Codex's gains `steps`, a `Set` of running step ids. `CodexSession` creates it, and clears it when a turn ends.
- `ClaudeSession` needs no change: its existing `readMessages` forwards every non-terminal event.

- [ ] **Step 1: Write the failing event tests**

Append to `electron/agents/events.test.cjs`:

```js
const toolUse = (id, name, input, parent = null) => ({ type: "assistant", parent_tool_use_id: parent, message: { content: [{ type: "tool_use", id, name, input }] } });
const toolResult = (id, content, { parent = null, structured, ...block } = {}) => ({
  type: "user", parent_tool_use_id: parent, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, ...block }] }, ...(structured ? { tool_use_result: structured } : {}),
});

test("Claude: a tool call starts a step and its result ends it", () => {
  const state = claudeState();
  assert.deepEqual(mapClaudeMessage(toolUse("t1", "Bash", { command: "npm test" }), state), [
    { type: "step-started", step: { id: "t1", kind: "shell", title: "Ran `npm test`", detail: "$ npm test\n" } },
  ]);
  assert.deepEqual(mapClaudeMessage(toolResult("t1", "ok", { is_error: false }), state), [{ type: "step-completed", id: "t1", status: "done", detail: "$ npm test\nok" }]);
  // A second result for the same call, or one for a call this state never saw, changes nothing.
  assert.deepEqual(mapClaudeMessage(toolResult("t1", "again"), state), []);
  assert.deepEqual(mapClaudeMessage(toolResult("unknown", "x"), state), []);
});

test("Claude: a subagent's own tool calls are not steps", () => {
  const state = claudeState();
  assert.equal(mapClaudeMessage(toolUse("agent-1", "Agent", { description: "List files", prompt: "ls" }), state).length, 1);
  assert.deepEqual(mapClaudeMessage(toolUse("t2", "Bash", { command: "ls" }, "agent-1"), state), []);
  assert.deepEqual(mapClaudeMessage(toolResult("t2", "README.md", { parent: "agent-1" }), state), []);
  const report = { status: "completed", content: [{ type: "text", text: "Found README.md" }] };
  assert.deepEqual(mapClaudeMessage(toolResult("agent-1", [{ type: "text", text: "[Subagent hand-back] …" }], { structured: report }), state), [
    { type: "step-completed", id: "agent-1", status: "done", detail: "Found README.md" },
  ]);
});

test("Claude: text, thinking and plain user messages are not steps", () => {
  const state = claudeState();
  assert.deepEqual(mapClaudeMessage({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Hi" }, { type: "thinking", thinking: "" }] } }, state), []);
  assert.deepEqual(mapClaudeMessage({ type: "user", parent_tool_use_id: null, message: { role: "user", content: "Steer this" } }, state), []);
  assert.deepEqual(mapClaudeMessage({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] } }, state), []);
});

const shell = (overrides = {}) => ({ type: "commandExecution", id: "exec-1", command: "/bin/zsh -lc 'npm test'", status: "inProgress", commandActions: [{ type: "unknown", command: "npm test" }], aggregatedOutput: null, exitCode: null, ...overrides });
const itemEvent = (method, item, state, extra = {}) => mapCodexNotification(method, { threadId: "thread-1", turnId: "t-1", item, ...extra }, state);
const output = (delta, state) => mapCodexNotification("item/commandExecution/outputDelta", { threadId: "thread-1", turnId: "t-1", itemId: "exec-1", delta }, state);

test("Codex: a command streams its output and ends with the whole of it", () => {
  const state = { ...codexState(), turnId: "t-1" };
  assert.deepEqual(itemEvent("item/started", shell(), state), [{ type: "step-started", step: { id: "exec-1", kind: "shell", title: "Ran `npm test`", detail: "$ npm test\n" } }]);
  assert.deepEqual(itemEvent("item/started", shell(), state), []);
  assert.deepEqual(output("ok 2\n", state), [{ type: "step-output", id: "exec-1", text: "ok 2\n" }]);
  assert.deepEqual(itemEvent("item/completed", shell({ status: "completed", exitCode: 0, aggregatedOutput: "ok 1\nok 2\n" }), state), [
    { type: "step-completed", id: "exec-1", status: "done", detail: "$ npm test\nok 1\nok 2\n" },
  ]);
  // Output for an item that isn't a running step is dropped.
  assert.deepEqual(output("late", state), []);
});

test("Codex: items that aren't tool calls, or belong to another turn, are not steps", () => {
  const state = { ...codexState(), turnId: "t-2" };
  assert.deepEqual(itemEvent("item/started", { type: "agentMessage", id: "msg-1", text: "" }, state, { turnId: "t-2" }), []);
  assert.deepEqual(itemEvent("item/started", { type: "reasoning", id: "rs-1" }, state, { turnId: "t-2" }), []);
  assert.deepEqual(itemEvent("item/started", shell(), state), []);
  assert.deepEqual(itemEvent("item/started", shell(), state, { threadId: "thread-9", turnId: "t-2" }), []);
});

test("Codex: an item that completes without having started still shows", () => {
  const state = { ...codexState(), turnId: "t-1" };
  const search = { type: "webSearch", id: "ws-1", query: "IANA", action: { type: "search", query: "IANA", queries: null }, results: [] };
  assert.deepEqual(itemEvent("item/completed", search, state), [
    { type: "step-started", step: { id: "ws-1", kind: "search", title: "Searched the web for `IANA`" } },
    { type: "step-completed", id: "ws-1", status: "done", title: "Searched the web for `IANA`" },
  ]);
});
```

- [ ] **Step 2: Add the fake app-server scenarios**

In `electron/agents/fixtures/fake-app-server.cjs`:

1. In the header comment, replace `late-approval (like slow-stop, and Codex asks for a command approval while the turn is stopping).` with:

```js
// late-approval (like slow-stop, and Codex asks for a command approval while the turn is stopping),
// steps (a command with streamed output and a new file, then a reply), running-step (a command
// starts and the turn waits until it's interrupted).
```

2. In `turn/start`, add right after the `if (scenario === "slow") { … }` block:

```js
      if (scenario === "steps" || scenario === "running-step") {
        const command = { type: "commandExecution", id: "exec-1", command: "/bin/zsh -lc 'npm test'", cwd: "/repo", status: "inProgress", commandActions: [{ type: "unknown", command: "npm test" }], aggregatedOutput: null, exitCode: null };
        notify("item/started", { threadId, turnId, item: command });
        if (scenario === "running-step") {
          pendingTurn = { threadId, turnId };
          return undefined;
        }
        notify("item/commandExecution/outputDelta", { threadId, turnId, itemId: "exec-1", delta: "ok 2\n" });
        notify("item/completed", { threadId, turnId, item: { ...command, status: "completed", aggregatedOutput: "ok 1\nok 2\n", exitCode: 0 } });
        notify("item/started", { threadId, turnId, item: { type: "reasoning", id: "rs-1", summary: [], content: [] } });
        const patch = { type: "fileChange", id: "exec-2", status: "inProgress", changes: [{ path: "/repo/notes.txt", kind: { type: "add" }, diff: "hello\n" }] };
        notify("item/started", { threadId, turnId, item: patch });
        notify("item/completed", { threadId, turnId, item: { ...patch, status: "completed" } });
        notify("item/agentMessage/delta", { threadId, turnId, itemId: "msg-1", delta: "Done" });
        return completeTurn(threadId, turnId, "completed");
      }
```

- [ ] **Step 3: Write the failing provider tests**

In `electron/agents/codex-provider.test.cjs`, add before `test("an unknown permission mode uses Ask's policy", …)`:

```js
test("commands and file changes become steps, in order with the reply", async (t) => {
  const { session, events } = codex(t, { scenario: "steps" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events.slice(2), [
    { type: "step-started", step: { id: "exec-1", kind: "shell", title: "Ran `npm test`", detail: "$ npm test\n" } },
    { type: "step-output", id: "exec-1", text: "ok 2\n" },
    { type: "step-completed", id: "exec-1", status: "done", detail: "$ npm test\nok 1\nok 2\n" },
    { type: "step-started", step: { id: "exec-2", kind: "edit", title: "Created `notes.txt`" } },
    { type: "step-completed", id: "exec-2", status: "done", title: "Created `notes.txt`", detail: "--- /repo/notes.txt\n+hello" },
    { type: "text-delta", messageId: "turn-1", text: "Done" },
    { type: "turn-completed" },
  ]);
});

test("a command still running when the turn is stopped gets no step-completed", async (t) => {
  const { session, events } = codex(t, { scenario: "running-step" });
  await session.startTurn(TURN);
  await waitUntil(() => events.some((event) => event.type === "step-started"));
  await session.interrupt();
  await ended(events);
  assert.equal(events.some((event) => event.type === "step-completed"), false);
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
  assert.equal(session.state.steps.size, 0);
});
```

In `electron/agents/claude-provider.test.cjs`:

1. Add to `scripts`, after `sdkAbortsAlready`:

```js
  // Claude Code sends the finished tool_use block, then asks, then sends the tool's result.
  async *runsTools({ options, signal }) {
    yield init;
    yield delta("Checking.");
    yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "npm test" } }] } };
    const answer = await options.canUseTool("Bash", { command: "npm test" }, { signal, requestId: "req-1", toolUseID: "tool-1" });
    const allowed = answer.behavior === "allow";
    yield { type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: allowed ? "ok" : answer.message, is_error: !allowed }] }, tool_use_result: allowed ? { stdout: "ok", stderr: "" } : `Error: ${answer.message}` };
    yield delta("All green.");
    yield success;
  },
```

2. Add before `test("an answer for an unknown request changes nothing", …)`:

```js
test("a tool call shows as a step before its approval, and ends with its result", async (t) => {
  const { session, events } = claude(t, { script: scripts.runsTools });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  const request = events.find((event) => event.type === "permission-request");
  const started = events.find((event) => event.type === "step-started");
  assert.deepEqual(started, { type: "step-started", step: { id: "tool-1", kind: "shell", title: "Ran `npm test`", detail: "$ npm test\n" } });
  assert.equal(request.stepId, started.step.id);
  assert.ok(events.indexOf(started) < events.indexOf(request));
  session.respondToPermission("req-1", "allow");
  await ended(events);
  assert.deepEqual(events.filter((event) => event.type !== "permission-request").map((event) => event.type), [
    "turn-started", "session-started", "text-delta", "step-started", "permission-resolved", "step-completed", "text-delta", "turn-completed",
  ]);
  assert.deepEqual(events.find((event) => event.type === "step-completed"), { type: "step-completed", id: "tool-1", status: "done", detail: "$ npm test\nok" });
});

test("a denied tool call ends as a failed step", async (t) => {
  const { session, events } = claude(t, { script: scripts.runsTools });
  await session.startTurn({ ...TURN, permissionMode: "ask" });
  await asked(events);
  session.respondToPermission("req-1", "deny");
  await ended(events);
  assert.deepEqual(events.find((event) => event.type === "step-completed"), { type: "step-completed", id: "tool-1", status: "failed", detail: "$ npm test\nDenied in Milagre" });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node --test electron/agents/events.test.cjs electron/agents/codex-provider.test.cjs electron/agents/claude-provider.test.cjs`
Expected: FAIL. No `step-started` events are emitted, and `session.state.steps` is undefined.

- [ ] **Step 5: Map steps in `events.cjs`**

In `electron/agents/events.cjs`:

1. In the header comment, add after the `text-delta` line:

```js
//   { type: "step-started", step }          a tool call began: step = { id, kind, title, detail? } (see steps.cjs)
//   { type: "step-output", id, text }       command output as it streams (Codex only), appended to the step
//   { type: "step-completed", id, status, title?, detail? }
//                                           the tool call ended; detail replaces anything streamed. A step still
//                                           running when its turn ends gets no step-completed
```

2. Add after the header comment:

```js
const { claudeStep, claudeStepResult, codexStep, codexStepResult } = require("./steps.cjs");
```

3. Replace the comment above `mapClaudeMessage` with:

```js
// Claude Agent SDK message -> events. Partial messages (includePartialMessages) carry the
// streamed text. Each assistant message holds a finished content block: a tool_use block starts a
// step, and the tool_result in a later user message ends it. Subagent messages (parent_tool_use_id
// set) are not part of the reply: the Agent call that started them is the step.
```

4. In `mapClaudeMessage`, add before `if (message.type === "result") {`:

```js
  if (message.type === "assistant" && message.parent_tool_use_id == null) {
    for (const block of message.message?.content ?? []) {
      if (block?.type !== "tool_use") continue;
      // Tool calls waiting for their result, by tool_use id.
      state.tools ??= new Map();
      state.tools.set(block.id, block);
      events.push({ type: "step-started", step: claudeStep(block.id, block.name, block.input) });
    }
  }
  if (message.type === "user" && message.parent_tool_use_id == null && Array.isArray(message.message?.content)) {
    const results = message.message.content.filter((block) => block?.type === "tool_result");
    for (const block of results) {
      const call = state.tools?.get(block.tool_use_id);
      if (!call) continue;
      state.tools.delete(block.tool_use_id);
      // tool_use_result belongs to the message, so it can only be matched to a lone result.
      events.push({ type: "step-completed", ...claudeStepResult(call, block, results.length === 1 ? message.tool_use_result : undefined) });
    }
  }
```

5. Replace the comment above `mapCodexNotification` with:

```js
// codex app-server notification -> events. Everything not listed is ignored on purpose:
// the server also reports MCP startup, hooks, rate limits, token usage and the turn's running diff.
```

6. In `mapCodexNotification`, add after the `turn/started` line:

```js
  if ((method === "item/started" || method === "item/completed") && params.item) {
    // An item from an earlier turn is not part of this reply.
    if (state.turnId && params.turnId && params.turnId !== state.turnId) return [];
    const step = codexStep(params.item);
    if (!step) return [];
    // Steps started and not yet completed, by item id.
    state.steps ??= new Set();
    if (method === "item/started") {
      if (state.steps.has(step.id)) return [];
      state.steps.add(step.id);
      return [{ type: "step-started", step }];
    }
    // An item that completes without having started still shows, as a step that starts and ends at once.
    const started = state.steps.delete(step.id) ? [] : [{ type: "step-started", step }];
    return [...started, { type: "step-completed", ...codexStepResult(params.item) }];
  }
  // The deltas are a preview: the first chunk can be missing, and item/completed carries the whole output.
  if (method === "item/commandExecution/outputDelta" && params.delta && state.steps?.has(String(params.itemId))) return [{ type: "step-output", id: String(params.itemId), text: params.delta }];
```

- [ ] **Step 6: Keep Codex's running steps per turn in `codex-provider.cjs`**

1. In the constructor, replace the `this.state = …` line with:

```js
    // steps: ids of the tool steps started in this turn and not yet completed.
    this.state = { threadId: resumeId ?? null, turnId: null, lastItemId: null, hasText: false, steps: new Set() };
```

2. In `finishTurn`, add after `this.fileChanges.clear();`:

```js
    // A command still running when the turn stopped never completes; the renderer closes its step.
    this.state.steps.clear();
```

- [ ] **Step 7: Run all agent tests**

Run: `npm run test:agent`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add electron/agents/events.cjs electron/agents/events.test.cjs electron/agents/codex-provider.cjs electron/agents/fixtures/fake-app-server.cjs electron/agents/codex-provider.test.cjs electron/agents/claude-provider.test.cjs
/usr/bin/git commit -m "feat: stream tool steps from Claude and Codex sessions" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 4: Batch step output

**Files:**
- Modify: `electron/agents/session-manager.cjs`
- Modify: `electron/agents/session-manager.test.cjs`

**Interfaces:**
- Consumes: `capOutput` (Task 2).
- Behaviour:
  - `step-output` is batched per step id, in the same 50 ms window and single per-chat buffer as text.
  - A change of stream (another turn's text, another step's output, or text after output) flushes the buffer first.
  - Each batch of output is kept to its last 20,000 characters.

- [ ] **Step 1: Write the failing tests**

In `electron/agents/session-manager.test.cjs`, add after "an approval request is sent right after the text before it":

```js
test("command output is batched per step, in order with the reply around it", async (t) => {
  const { manager, sent, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  const step = { id: "exec-1", kind: "shell", title: "Ran `npm test`", detail: "$ npm test\n" };
  created[0].emit({ type: "text-delta", messageId: "t1", text: "Testing." });
  created[0].emit({ type: "step-started", step });
  created[0].emit({ type: "step-output", id: "exec-1", text: "ok 1\n" });
  created[0].emit({ type: "step-output", id: "exec-1", text: "ok 2\n" });
  created[0].emit({ type: "step-output", id: "exec-2", text: "other\n" });
  assert.deepEqual(sent.map((item) => item.event), [
    { type: "text-delta", messageId: "t1", text: "Testing." },
    { type: "step-started", step },
    { type: "step-output", id: "exec-1", text: "ok 1\nok 2\n" },
  ]);
  created[0].emit({ type: "step-completed", id: "exec-1", status: "done", detail: "$ npm test\nok 1\nok 2\n" });
  assert.deepEqual(sent.slice(3).map((item) => item.event), [
    { type: "step-output", id: "exec-2", text: "other\n" },
    { type: "step-completed", id: "exec-1", status: "done", detail: "$ npm test\nok 1\nok 2\n" },
  ]);
});

test("a batch of command output keeps only its end", async (t) => {
  const { manager, sent, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].emit({ type: "step-output", id: "exec-1", text: "a".repeat(15_000) });
  created[0].emit({ type: "step-output", id: "exec-1", text: "b".repeat(15_000) });
  await waitUntil(() => sent.length === 1);
  assert.equal(sent[0].event.text, `… truncated\n${"a".repeat(5_000)}${"b".repeat(15_000)}`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test electron/agents/session-manager.test.cjs`
Expected: FAIL. Each `step-output` is sent on its own, without batching.

- [ ] **Step 3: Implement**

In `electron/agents/session-manager.cjs`:

1. Replace the two `require` lines and the constants with:

```js
const { isTerminal } = require("./events.cjs");
const { USER_DECISIONS } = require("./permissions.cjs");
const { capOutput } = require("./steps.cjs");

const IDLE_MS = 10 * 60 * 1000;
const BATCH_MS = 50;

// Streamed events that are batched: reply text per turn, and command output per step.
function streamKey(event) {
  if (event.type === "text-delta") return `text:${event.messageId}`;
  if (event.type === "step-output") return `step:${event.id}`;
  return null;
}
```

2. In the class comment, replace `// Text deltas are batched so fast streams don't flood IPC. Replacing and closing a chat's` with:

```js
// Text deltas and command output are batched so fast streams don't flood IPC; a batch of output
// keeps only the end the renderer would keep. Replacing and closing a chat's
```

3. In `forward`, replace the `if (event.type === "text-delta") { … }` block with:

```js
    const key = streamKey(event);
    if (key) {
      const buffer = this.buffers.get(chatId);
      if (buffer && buffer.key !== key) this.flush(chatId);
      let next = this.buffers.get(chatId);
      if (!next) {
        next = { key, event, text: "", timer: setTimeout(() => this.flush(chatId), this.batchMs) };
        next.timer.unref?.();
        this.buffers.set(chatId, next);
      }
      next.text = event.type === "step-output" ? capOutput(next.text + event.text) : next.text + event.text;
      return;
    }
```

4. In `flush`, replace the `send` line with:

```js
    if (buffer.text) this.send(chatId, { ...buffer.event, text: buffer.text });
```

- [ ] **Step 4: Run all agent tests**

Run: `npm run test:agent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add electron/agents/session-manager.cjs electron/agents/session-manager.test.cjs
/usr/bin/git commit -m "feat: batch streamed command output like reply text" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 5: Steps in each chat's run, saved with the reply

**Files:**
- Modify: `app/src/model.ts`
- Modify: `app/src/lib/agent-runs.ts`
- Modify: `app/src/lib/agent-runs.test.ts`

**Interfaces:**
- Consumes: the step events from Task 3.
- Produces:
  - In `model.ts`:
    - `StepKind`, `ChatStep`, and `ChatMessage.steps?`
    - `PermissionRequest.stepId?`
    - three new `AgentEvent` members: `step-started`, `step-output` and `step-completed`.
  - In `agent-runs.ts`:
    - `AgentRun.steps: ChatStep[]`, with `startRun` giving `steps: []`.
    - `capOutput(text) → string`, the same cap as the main process.
    - `applyAgentEvent` handles the step events and saves steps when a turn ends.
    - `splitRunForSteer` saves finished steps with the reply so far.

- [ ] **Step 1: Add the types**

In `app/src/model.ts`:

1. In `ChatMessage`, add after `outcome?: …;`:

```ts
  /** The tool calls the agent made in this reply, in the order they started. */
  steps?: ChatStep[];
```

2. Add after the `ChatMessage` interface:

```ts
export type StepKind = "shell" | "edit" | "read" | "search" | "other";

/** One tool call in an agent's reply: a command, an edit, a read, a search or another tool. */
export interface ChatStep {
  id: string;
  kind: StepKind;
  /** What it did, e.g. "Ran `npm test`"; text between backticks is code. */
  title: string;
  /** Saved steps are done or failed; only a reply still streaming has running ones. */
  status: "running" | "done" | "failed";
  /** The command and its output, or a unified diff, capped at 20,000 characters. */
  detail?: string;
  /** Where the step sits in the reply: the length of the reply's text when it started. */
  offset?: number;
}
```

3. In `PermissionRequest`, add after `allowForChat: boolean;`:

```ts
  /** The tool step this request is about. */
  stepId?: string;
```

4. In `AgentEvent`, add after the `text-delta` member:

```ts
  | { type: "step-started"; step: Pick<ChatStep, "id" | "kind" | "title" | "detail"> }
  | { type: "step-output"; id: string; text: string }
  | { type: "step-completed"; id: string; status: "done" | "failed"; title?: string; detail?: string }
```

- [ ] **Step 2: Write the failing tests**

In `app/src/lib/agent-runs.test.ts`:

1. Replace the two import lines from `../model` and `./agent-runs.ts` with:

```ts
import type { AgentEvent, ChatStep, CoordinatorState, ModelOption, PermissionRequest } from "../model";
import { applyAgentEvent, capOutput, chatInProject, chatKey, clearAnswered, markAnswered, modelForChat, sessionIdFromKey, startRun, splitRunForSteer } from "./agent-runs.ts";
```

2. Runs now always carry `steps`. Replace every `answered: {}` in this file with `answered: {}, steps: []` (10 places, in run literals and expected runs). For example:

```ts
  const runs = { [key(1)]: { text: "Half an answer", model: "gpt-6-sol", approvals: [], answered: {}, steps: [] } };
```

3. Append:

```ts
const npmTest = { id: "s1", kind: "shell" as const, title: "Ran `npm test`", detail: "$ npm test\n" };

/** Folds events into one chat's run, starting from a fresh run unless `runs` is given. */
function fold(events: AgentEvent[], runs: AgentRuns = startRun({}, key(1), "gpt-6-sol"), state = base()) {
  let result = { state, runs, changed: false };
  for (const event of events) result = applyAgentEvent(result.state, result.runs, PROJECT, key(1), event);
  return result;
}

test("a step starts where the reply's text has got to, streams its output, and ends with its own detail", () => {
  const { runs } = fold([
    { type: "text-delta", messageId: "t", text: "Testing." },
    { type: "step-started", step: npmTest },
    { type: "step-output", id: "s1", text: "ok 2\n" },
  ]);
  assert.deepEqual(runs[key(1)].steps, [{ ...npmTest, status: "running", offset: 8, detail: "$ npm test\nok 2\n" }]);

  const ended = fold([{ type: "step-completed", id: "s1", status: "failed", detail: "$ npm test\nok 1\nok 2\n1 failing\n" }], runs).runs;
  assert.deepEqual(ended[key(1)].steps, [{ ...npmTest, status: "failed", offset: 8, detail: "$ npm test\nok 1\nok 2\n1 failing\n" }]);
  // Output after the end, or for a step the run doesn't have, changes nothing.
  assert.equal(fold([{ type: "step-output", id: "s1", text: "late" }], ended).runs, ended);
  assert.equal(fold([{ type: "step-completed", id: "nope", status: "done" }], ended).runs, ended);
});

test("a step that ends without a detail keeps none, and a new title replaces the first", () => {
  const read = { id: "r1", kind: "read" as const, title: "Read `app.js`", detail: "$ cat app.js\n" };
  const { runs } = fold([
    { type: "step-started", step: read },
    { type: "step-output", id: "r1", text: "export const a = 1;\n" },
    { type: "step-completed", id: "r1", status: "done" },
    { type: "step-started", step: { id: "w1", kind: "search", title: "Searched the web" } },
    { type: "step-completed", id: "w1", status: "done", title: "Searched the web for `IANA`" },
  ]);
  assert.deepEqual(runs[key(1)].steps, [
    { id: "r1", kind: "read", title: "Read `app.js`", status: "done", offset: 0 },
    { id: "w1", kind: "search", title: "Searched the web for `IANA`", status: "done", offset: 0 },
  ]);
});

test("streamed output keeps its last 20,000 characters", () => {
  const { runs } = fold([
    { type: "step-started", step: { ...npmTest, detail: "" } },
    { type: "step-output", id: "s1", text: "a".repeat(15_000) },
    { type: "step-output", id: "s1", text: "b".repeat(15_000) },
  ]);
  assert.equal(runs[key(1)].steps[0].detail, `… truncated\n${"a".repeat(5_000)}${"b".repeat(15_000)}`);
  assert.equal(capOutput("short"), "short");
});

test("step events for a chat with nothing running change nothing", () => {
  const state = base();
  for (const event of [{ type: "step-started", step: npmTest }, { type: "step-output", id: "s1", text: "x" }, { type: "step-completed", id: "s1", status: "done" }] as AgentEvent[]) {
    assert.deepEqual(applyAgentEvent(state, {}, PROJECT, key(1), event), { state, runs: {}, changed: false });
  }
});

test("a finished reply saves its steps where they happened in the trimmed text", () => {
  const { state } = fold([
    { type: "text-delta", messageId: "t", text: "\n  Testing." },
    { type: "step-started", step: npmTest },
    { type: "step-completed", id: "s1", status: "done", detail: "$ npm test\nok\n" },
    { type: "text-delta", messageId: "t", text: "\n\nAll green. " },
    { type: "turn-completed" },
  ]);
  const saved = state.messages.at(-1);
  assert.equal(saved?.body, "Testing.\n\nAll green.");
  assert.deepEqual(saved?.steps, [{ ...npmTest, status: "done", offset: 8, detail: "$ npm test\nok\n" }]);
});

test("a step still running when the turn ends is saved as done or failed with the turn", () => {
  const running = fold([{ type: "text-delta", messageId: "t", text: "Testing." }, { type: "step-started", step: npmTest }, { type: "step-output", id: "s1", text: "ok 1\n" }]).runs;
  const cancelled = fold([{ type: "turn-cancelled" }], running).state.messages.at(-1);
  assert.equal(cancelled?.body, "Testing.\n\nAgent run cancelled.");
  assert.deepEqual(cancelled?.steps, [{ ...npmTest, status: "failed", offset: 8, detail: "$ npm test\nok 1\n" }]);
  assert.equal(fold([{ type: "turn-failed", message: "boom" }], running).state.messages.at(-1)?.steps?.[0].status, "failed");
  assert.equal(fold([{ type: "turn-completed" }], running).state.messages.at(-1)?.steps?.[0].status, "done");
});

test("a reply with steps and no text saves an empty body; one with neither says so", () => {
  const withSteps = fold([{ type: "step-started", step: npmTest }, { type: "step-completed", id: "s1", status: "done", detail: "$ npm test\n" }, { type: "turn-completed" }]).state.messages.at(-1);
  assert.equal(withSteps?.body, "");
  assert.deepEqual(withSteps?.steps?.map((step: ChatStep) => step.offset), [0]);
  const empty = fold([{ type: "turn-completed" }]).state.messages.at(-1);
  assert.equal(empty?.body, "The agent finished without a reply.");
  assert.equal(empty && "steps" in empty, false);
});

test("a steer saves finished steps with the reply so far; running ones carry on below the new message", () => {
  const { runs, state } = fold([
    { type: "text-delta", messageId: "t", text: "Testing." },
    { type: "step-started", step: { id: "r1", kind: "read", title: "Read `a.js`" } },
    { type: "step-completed", id: "r1", status: "done" },
    { type: "step-started", step: npmTest },
  ]);
  const split = splitRunForSteer(state, runs, PROJECT, key(1));
  assert.deepEqual(split.state.messages.at(-1)?.steps, [{ id: "r1", kind: "read", title: "Read `a.js`", status: "done", offset: 8 }]);
  assert.deepEqual(split.runs[key(1)].steps, [{ ...npmTest, status: "running", offset: 0 }]);
  assert.equal(split.runs[key(1)].text, "");

  // The running step finishes after the steer and is saved with the rest of the reply.
  const rest = fold([{ type: "step-completed", id: "s1", status: "done", detail: "$ npm test\nok\n" }, { type: "turn-completed" }], split.runs, split.state).state.messages.at(-1);
  assert.equal(rest?.body, "");
  assert.deepEqual(rest?.steps, [{ ...npmTest, status: "done", offset: 0, detail: "$ npm test\nok\n" }]);
});

test("a steer with only finished steps and no text still saves them", () => {
  const { runs, state } = fold([{ type: "step-started", step: npmTest }, { type: "step-completed", id: "s1", status: "done", detail: "$ npm test\n" }]);
  const split = splitRunForSteer(state, runs, PROJECT, key(1));
  assert.equal(split.changed, true);
  assert.equal(split.state.messages.at(-1)?.body, "");
  assert.equal(split.state.messages.at(-1)?.steps?.length, 1);
  // Nothing new after the split: the turn saves no second reply.
  const done = fold([{ type: "turn-completed" }], split.runs, split.state);
  assert.equal(done.changed, false);
  // Only a running step and no text: nothing to save yet.
  const onlyRunning = fold([{ type: "step-started", step: npmTest }]);
  assert.equal(splitRunForSteer(onlyRunning.state, onlyRunning.runs, PROJECT, key(1)).changed, false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test app/src/lib/agent-runs.test.ts`
Expected: FAIL with `does not provide an export named 'capOutput'`.

- [ ] **Step 4: Implement the fold**

In `app/src/lib/agent-runs.ts`:

1. Replace the `../model` import, `AgentRun` and `AgentRuns` with:

```ts
import type { AgentEvent, ChatMessage, ChatStep, CoordinatorState, ModelOption, ModelProvider, PermissionDecision, PermissionRequest } from "../model";

/** A turn streaming in a chat, keyed by chat key (see `chatKey`). */
export interface AgentRun {
  text: string;
  model: string;
  /** Tool steps in the order they started; each one's offset is where it sits in `text`. */
  steps: ChatStep[];
  /** Approval requests the turn waits on, oldest first. */
  approvals: PermissionRequest[];
  /** The answer sent for each approval request (by request id) until the agent takes it. */
  answered: Record<string, PermissionDecision>;
  /** A steering message split the reply, so a turn that ends with nothing more to show saves nothing more. */
  split?: boolean;
}

export type AgentRuns = Record<string, AgentRun>;

const MAX_OUTPUT = 20_000;

/** Command output keeps its end, where results and errors are (as the main process does). */
export function capOutput(text: string): string {
  return text.length > MAX_OUTPUT ? `… truncated\n${text.slice(-MAX_OUTPUT)}` : text;
}
```

2. Replace `startRun` and add the step helpers after it:

```ts
export function startRun(runs: AgentRuns, chatId: string, model: string): AgentRuns {
  return { ...runs, [chatId]: { text: "", model, steps: [], approvals: [], answered: {} } };
}

/** The run with one step changed, or null when it has no such step or `update` declines. */
function updateStep(run: AgentRun, id: string, update: (step: ChatStep) => ChatStep | null): AgentRun | null {
  const index = run.steps.findIndex((step) => step.id === id);
  const next = index === -1 ? null : update(run.steps[index]);
  return next ? { ...run, steps: run.steps.map((step, position) => (position === index ? next : step)) } : null;
}

/** The detail a step ends with replaces what streamed into it; a step that ends without one keeps none. */
function endStep({ detail: _streamed, ...step }: ChatStep, end: { status: "done" | "failed"; title?: string; detail?: string }): ChatStep {
  return { ...step, status: end.status, title: end.title ?? step.title, ...(end.detail === undefined ? {} : { detail: end.detail }) };
}

/**
 * Steps as saved with a reply: none left running, and offsets into the reply's trimmed text.
 * A step still running when the turn ends is saved as `closeAs`.
 */
function savedSteps(text: string, steps: ChatStep[], closeAs: "done" | "failed"): { steps?: ChatStep[] } {
  if (!steps.length) return {};
  const lead = text.length - text.trimStart().length;
  const length = text.trim().length;
  return {
    steps: steps.map((step) => ({ ...step, status: step.status === "running" ? closeAs : step.status, offset: Math.min(Math.max((step.offset ?? text.length) - lead, 0), length) })),
  };
}
```

3. In `applyAgentEvent`, add after the `text-delta` case:

```ts
    case "step-started": {
      if (!run) return { state, runs, changed: false };
      const step: ChatStep = { ...event.step, status: "running", offset: run.text.length };
      return { state, runs: { ...runs, [chatId]: { ...run, steps: [...run.steps.filter((item) => item.id !== step.id), step] } }, changed: false };
    }
    case "step-output": {
      const next = run && updateStep(run, event.id, (step) => (step.status === "running" ? { ...step, detail: capOutput((step.detail ?? "") + event.text) } : null));
      return next ? { state, runs: { ...runs, [chatId]: next }, changed: false } : { state, runs, changed: false };
    }
    case "step-completed": {
      const next = run && updateStep(run, event.id, (step) => endStep(step, event));
      return next ? { state, runs: { ...runs, [chatId]: next }, changed: false } : { state, runs, changed: false };
    }
```

4. In the turn-ending case, replace from the `// The reply so far was saved …` comment through the `const message: ChatMessage = { … };` statement with:

```ts
      // The reply so far was saved when a steering message split it; there is nothing left to show.
      if (event.type === "turn-completed" && run.split && !run.text.trim() && !run.steps.length) return { state, runs: remaining, changed: false };
      const message: ChatMessage = {
        id: state.next_id,
        session_id: sessionId,
        body: replyBody(run.text, event, run.steps.length > 0),
        context: null,
        role: "assistant",
        model: run.model,
        outcome: event.type === "turn-completed" ? "completed" : event.type === "turn-cancelled" ? "cancelled" : "failed",
        // Codex sends no end for a command still running when a turn stops, so the turn's end closes it.
        ...savedSteps(run.text, run.steps, event.type === "turn-completed" ? "done" : "failed"),
      };
```

5. Replace `replyBody` and `splitRunForSteer` with:

```ts
function replyBody(text: string, event: AgentEvent, hasSteps: boolean) {
  const reply = text.trim();
  if (event.type === "turn-failed") return reply ? `${reply}\n\nAgent error: ${event.message}` : `Agent error: ${event.message}`;
  if (event.type === "turn-cancelled") return reply ? `${reply}\n\nAgent run cancelled.` : "Agent run cancelled.";
  return reply || (hasSteps ? "" : "The agent finished without a reply.");
}

/**
 * Before a steering message joins a running turn, the reply streamed so far is saved as its own
 * message, so the chat reads in order: the reply so far, the new message, then the rest of the reply.
 * Finished steps are saved with it; steps still running carry on at the start of the rest of the reply.
 */
export function splitRunForSteer(state: CoordinatorState, runs: AgentRuns, projectPath: string, chatId: string): { state: CoordinatorState; runs: AgentRuns; changed: boolean } {
  const sessionId = sessionIdFromKey(chatId);
  const run = runs[chatId];
  if (!chatInProject(projectPath, chatId) || !state.sessions[sessionId] || !run) return { state, runs, changed: false };
  const body = run.text.trim();
  const finished = run.steps.filter((step) => step.status !== "running");
  if (!body && !finished.length) return { state, runs, changed: false };
  const message: ChatMessage = { id: state.next_id, session_id: sessionId, body, context: null, role: "assistant", model: run.model, ...savedSteps(run.text, finished, "done") };
  const running = run.steps.filter((step) => step.status === "running").map((step) => ({ ...step, offset: 0 }));
  return {
    state: { ...state, next_id: state.next_id + 1, messages: [...state.messages, message] },
    runs: { ...runs, [chatId]: { ...run, text: "", steps: running, split: true } },
    changed: true,
  };
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `node --test app/src/lib/agent-runs.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors. Every new type is optional where the app already builds messages and runs.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add app/src/model.ts app/src/lib/agent-runs.ts app/src/lib/agent-runs.test.ts
/usr/bin/git commit -m "feat: keep tool steps in each chat's run and save them with the reply" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 6: Splitting a reply into text and steps

**Files:**
- Create: `app/src/lib/reply-parts.ts`
- Test: `app/src/lib/reply-parts.test.ts`

**Interfaces:**
- Produces:
  - `ReplyPart = { type: "text"; text: string } | { type: "steps"; steps: ChatStep[] }`
  - `replyParts(body, steps?) → ReplyPart[]`
  - `titleSpans(title) → Array<{ text: string; code: boolean }>`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/reply-parts.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { ChatStep } from "../model";
import { replyParts, titleSpans } from "./reply-parts.ts";

const step = (id: string, offset?: number): ChatStep => ({ id, kind: "shell", title: `Ran \`${id}\``, status: "done", ...(offset === undefined ? {} : { offset }) });

test("steps sit between the text around them, in order", () => {
  const body = "Checking.\n\nNow editing.\n\nDone.";
  assert.deepEqual(replyParts(body, [step("a", 9), step("b", 9), step("c", 23)]), [
    { type: "text", text: "Checking." },
    { type: "steps", steps: [step("a", 9), step("b", 9)] },
    { type: "text", text: "\n\nNow editing." },
    { type: "steps", steps: [step("c", 23)] },
    { type: "text", text: "\n\nDone." },
  ]);
});

test("a reply without steps is its text; steps alone are one group", () => {
  assert.deepEqual(replyParts("Hello"), [{ type: "text", text: "Hello" }]);
  assert.deepEqual(replyParts("", [step("a", 0), step("b", 0)]), [{ type: "steps", steps: [step("a", 0), step("b", 0)] }]);
  assert.deepEqual(replyParts("", []), []);
});

test("whitespace between steps doesn't split their group", () => {
  assert.deepEqual(replyParts("Go.\n\n", [step("a", 3), step("b", 5)]), [{ type: "text", text: "Go." }, { type: "steps", steps: [step("a", 3), step("b", 5)] }]);
});

test("offsets past the text, missing or out of order still keep every step once", () => {
  assert.deepEqual(replyParts("Hi", [step("a", 99), step("b")]), [{ type: "text", text: "Hi" }, { type: "steps", steps: [step("a", 99), step("b")] }]);
  assert.deepEqual(replyParts("abcdef", [step("a", 4), step("b", 1)]), [{ type: "text", text: "abcd" }, { type: "steps", steps: [step("a", 4), step("b", 1)] }, { type: "text", text: "ef" }]);
});

test("titles split into text and code", () => {
  assert.deepEqual(titleSpans("Ran `npm test`"), [{ text: "Ran ", code: false }, { text: "npm test", code: true }]);
  assert.deepEqual(titleSpans("Searched for `greet` in `src`"), [{ text: "Searched for ", code: false }, { text: "greet", code: true }, { text: " in ", code: false }, { text: "src", code: true }]);
  assert.deepEqual(titleSpans("Updated the to-do list"), [{ text: "Updated the to-do list", code: false }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test app/src/lib/reply-parts.test.ts`
Expected: FAIL with `Cannot find module` for `./reply-parts.ts`.

- [ ] **Step 3: Implement**

Create `app/src/lib/reply-parts.ts`:

```ts
import type { ChatStep } from "../model";

export type ReplyPart = { type: "text"; text: string } | { type: "steps"; steps: ChatStep[] };

/**
 * A reply's text and tool steps in the order they happened. Each step sits at its offset (the
 * length of the reply's text when it started); steps next to each other form one group, and a step
 * without an offset goes after the text. Text that is only whitespace is left out.
 */
export function replyParts(body: string, steps: ChatStep[] = []): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let cursor = 0;
  for (const step of steps) {
    const at = Math.min(Math.max(step.offset ?? body.length, cursor), body.length);
    const text = body.slice(cursor, at);
    cursor = at;
    if (text.trim()) parts.push({ type: "text", text });
    const last = parts.at(-1);
    if (last?.type === "steps") last.steps.push(step);
    else parts.push({ type: "steps", steps: [step] });
  }
  const rest = body.slice(cursor);
  if (rest.trim()) parts.push({ type: "text", text: rest });
  return parts;
}

/** A step title split into plain text and code: "Ran `npm test`" → "Ran ", then the code "npm test". */
export function titleSpans(title: string): Array<{ text: string; code: boolean }> {
  return title.split("`").map((text, index) => ({ text, code: index % 2 === 1 })).filter((span) => span.text);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test app/src/lib/reply-parts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/src/lib/reply-parts.ts app/src/lib/reply-parts.test.ts
/usr/bin/git commit -m "feat: split a reply into its text and tool steps" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 7: Rows in the chat

**Files:**
- Create: `app/src/components/agents/StepRow.tsx`
- Modify: `app/src/components/ChatComposer.tsx`
- Modify: `app/src/App.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes:
  - `AgentRun.steps` and `PermissionRequest.stepId` (Task 5);
  - `replyParts` and `titleSpans` (Task 6);
  - the existing `CodeBlock` (fences `console` and `diff` are known languages).
- Produces:
  - `StepRow({ step, waiting? })`
  - `ChatComposer` gains `streamingSteps?: ChatStep[]` and `waitingStepIds?: string[]`.

There is no renderer test harness, so this task is checked by the typecheck and the build, then in Electron in Task 8.

- [ ] **Step 1: Create the row**

Create `app/src/components/agents/StepRow.tsx`:

```tsx
import { useState } from "react";
import type { ComponentProps } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, ArrowDown01Icon, CommandLineIcon, File01Icon, Loading03Icon, PencilEdit02Icon, Search01Icon, Tick02Icon, Wrench01Icon } from "@hugeicons/core-free-icons";
import type { ChatStep, StepKind } from "../../model";
import { titleSpans } from "../../lib/reply-parts";
import { CodeBlock } from "../markdown/CodeBlock";

type IconData = ComponentProps<typeof HugeiconsIcon>["icon"];

const KIND_ICONS: Record<StepKind, IconData> = { shell: CommandLineIcon, edit: PencilEdit02Icon, read: File01Icon, search: Search01Icon, other: Wrench01Icon };
// Commands show as a terminal session ("$ command", then output), edits as diffs.
const DETAIL_FENCES: Partial<Record<StepKind, string>> = { shell: "console", edit: "diff" };

function Icon({ icon, size = 14 }: { icon: IconData; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} color="currentColor" />;
}

/** One tool call in a reply: what it did and how it went. A row with output or a diff opens to show it. */
export function StepRow({ step, waiting = false }: { step: ChatStep; waiting?: boolean }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(step.detail);
  const state = waiting ? "Waiting for approval" : step.status === "running" ? "Running" : step.status === "failed" ? "Failed" : "Done";
  return (
    <div data-slot="step" data-status={step.status} className="min-w-0">
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen((value) => !value)}
        className="group flex w-full min-w-0 items-center gap-2 rounded-[8px] px-1.5 py-1 text-left text-[12.5px] leading-[1.4] text-ink-2 transition-colors enabled:hover:bg-hover enabled:hover:text-ink disabled:cursor-default"
      >
        <span className={`shrink-0 ${step.status === "failed" ? "text-red" : "text-ink-3"}`}><Icon icon={KIND_ICONS[step.kind] ?? Wrench01Icon} /></span>
        <span className="min-w-0 flex-1 truncate">
          {titleSpans(step.title).map((span, index) => (span.code
            ? <code key={index} className="rounded-[4px] bg-field px-1 py-px font-mono text-[0.92em] text-ink">{span.text}</code>
            : <span key={index}>{span.text}</span>))}
        </span>
        <span className="sr-only">{state}</span>
        {waiting ? (
          <span className="shrink-0 text-[11.5px] text-ink-3">Waiting for approval</span>
        ) : step.status === "running" ? (
          <span aria-hidden className="shrink-0 text-ink-3 motion-safe:animate-spin"><Icon icon={Loading03Icon} size={13} /></span>
        ) : step.status === "failed" ? (
          <span aria-hidden className="flex shrink-0 items-center gap-1 text-[11.5px] text-red"><Icon icon={Alert02Icon} size={13} />Failed</span>
        ) : (
          <span aria-hidden className="shrink-0 text-ink-3"><Icon icon={Tick02Icon} size={13} /></span>
        )}
        {expandable && <span aria-hidden className={`shrink-0 text-ink-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}><Icon icon={ArrowDown01Icon} size={12} /></span>}
      </button>
      {open && step.detail && (
        <div className="max-h-96 overflow-y-auto pl-6">
          <CodeBlock code={step.detail} fence={DETAIL_FENCES[step.kind]} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Show the rows in replies**

In `app/src/components/ChatComposer.tsx`:

1. Add `ChatStep,` to the `../model` type import, after `ChatMessage as AppChatMessage,`.

2. Add the imports, after the `recommendation-card` import and after the `streaming-markdown` import respectively:

```ts
import { StepRow } from "./agents/StepRow";
```

```ts
import { replyParts } from "../lib/reply-parts";
```

3. Replace the `MessageSection` signature, from `function MessageSection({` through `const recommendation = …;`, with:

```tsx
function StepGroup({ steps, waitingStepIds }: { steps: ChatStep[]; waitingStepIds: string[] }) {
  return <div className="-mx-1.5 my-1 flex flex-col">{steps.map((step) => <StepRow key={step.id} step={step} waiting={waitingStepIds.includes(step.id)} />)}</div>;
}

/** A reply's text with its tool steps where they happened. */
function ReplyContent({ body, steps, streaming, waitingStepIds }: { body: string; steps: ChatStep[]; streaming: boolean; waitingStepIds: string[] }) {
  return (
    <>
      {replyParts(body, steps).map((part, index) => (part.type === "text"
        ? <Markdown key={index} text={streaming ? closeOpenMarkdown(part.text) : part.text} />
        : <StepGroup key={index} steps={part.steps} waitingStepIds={waitingStepIds} />))}
    </>
  );
}

function MessageSection({
  message,
  session,
  isUser,
  modelName,
  onRecommendationSelect,
  streaming = false,
  waitingStepIds = [],
}: {
  message: AppChatMessage;
  session?: AgentSession;
  isUser: boolean;
  modelName: string;
  onRecommendationSelect: (option: string) => void;
  streaming?: boolean;
  /** Steps whose approval card is open. */
  waitingStepIds?: string[];
}) {
  const recommendation = !isUser ? parseRecommendation(message.body) : null;
  const steps = message.steps ?? [];
```

4. Replace the reply branch:

```tsx
        ) : recommendation ? (
          <RecommendationCard question={recommendation.question} options={recommendation.options} onSelect={(option) => onRecommendationSelect(option.label)} />
        ) : (
          <Markdown text={streaming ? closeOpenMarkdown(message.body) : message.body} />
        )}
```

with:

```tsx
        ) : recommendation ? (
          <>
            {steps.length > 0 && <StepGroup steps={steps} waitingStepIds={waitingStepIds} />}
            <RecommendationCard question={recommendation.question} options={recommendation.options} onSelect={(option) => onRecommendationSelect(option.label)} />
          </>
        ) : (
          <ReplyContent body={message.body} steps={steps} streaming={streaming} waitingStepIds={waitingStepIds} />
        )}
```

5. In `ChatComposerProps`, add after `streamingText?: string;`:

```ts
  /** The running turn's tool steps, where they happened in `streamingText`. */
  streamingSteps?: ChatStep[];
  /** Steps of the running turn whose approval card is open. */
  waitingStepIds?: string[];
```

6. In `ChatComposer`'s destructured props, add `streamingSteps,` and `waitingStepIds,` after `streamingText,`.

7. Replace the `autoScrollKey` prop with:

```tsx
        autoScrollKey={`${messages.length}-${isSending}-${streamingText?.length ?? 0}-${streamingSteps?.length ?? 0}`}
```

8. Replace the live reply, `{isSending && streamingText && ( <MessageSection … streaming /> )}`, with:

```tsx
            {isSending && (streamingText || streamingSteps?.length) ? (
              <MessageSection
                message={{ id: -1, session_id: messages.at(-1)?.session_id ?? -1, body: streamingText ?? "", context: null, role: "assistant", steps: streamingSteps }}
                session={sessions[String(messages.at(-1)?.session_id)]}
                isUser={false}
                modelName={workingModelName}
                onRecommendationSelect={onRecommendationSelect}
                streaming
                waitingStepIds={waitingStepIds}
              />
            ) : null}
```

- [ ] **Step 3: Pass the run's steps from `App.tsx`**

In `app/src/App.tsx`, in the `<ChatComposer …>` props, add after `streamingText={run?.text}`:

```tsx
            streamingSteps={run?.steps}
            waitingStepIds={run?.approvals.flatMap((request) => (request.stepId ? [request.stepId] : []))}
```

- [ ] **Step 4: Update the README**

In `README.md`'s feature list, add after the line that starts `- Approval cards that show the exact command`:

```markdown
- Each command, file edit, read and search an agent runs shows as a row in its reply, such as "Ran `npm test`", with a spinner while it runs. Click a row for its output or diff. Saved replies keep their rows.
```

- [ ] **Step 5: Typecheck, test and build**

Run: `npm run test:agent`
Expected: PASS.

Run: `npm run build`
Expected: no TypeScript errors, and `✓ built`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add app/src/components/agents/StepRow.tsx app/src/components/ChatComposer.tsx app/src/App.tsx README.md
/usr/bin/git commit -m "feat: show each tool step as a row in the agent's reply" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 8: Verify with the real CLIs

**Files:** none committed. Scripts live in the session scratchpad.

The controller runs this task, not a subagent. Use an isolated Electron instance:

- this branch's Vite dev server on a free port;
- `--remote-debugging-port` and `--user-data-dir` in the scratchpad;
- the working directory set to a throwaway git repository containing:
  - `src/app.js` with `export function greet(name) {\n  return \`Hello ${name}\`;\n}\n`
  - `README.md` with `# Demo\n\nA tiny demo project.\n`

Drive it with Playwright over CDP. Use `claude-haiku-4-5` for Claude and `gpt-6-sol` for Codex. Every check below must pass, with no page errors. In each check, "rows" means the `[data-slot=step]` elements of the reply, read in DOM order.

Victor follows from his phone, so send each step's screenshots to him with `SendUserFile` as soon as they exist, including any failures.

- [ ] **Step 1: Claude, Full mode**
  - Ask: "Do these in order, one tool call each: read README.md; change Hello to Hi in src/app.js; run `ls`; run `cat missing.txt`; run `sleep 3 && echo done`. Then reply DONE."
  - While `sleep 3` runs, a row "Ran `sleep 3 && echo done`" shows a spinner (`data-status="running"`).
  - When it ends, the rows in order are:
    - "Read `README.md`": done, and not clickable.
    - "Edited `app.js`": done. Expanded, it shows a diff with `-  return \`Hello ${name}\`;` and `+  return \`Hi ${name}\`;`.
    - "Ran `ls`": done; its output lists `README.md` and `src`.
    - "Ran `cat missing.txt`": shows "Failed"; its output says `No such file or directory`.
    - "Ran `sleep 3 && echo done`": done; its output ends with `done`.
  - Text the agent wrote between tool calls appears between the rows it came between. "DONE" is last.

- [ ] **Step 2: Codex, Full mode**
  - Ask: "Do these in order, one tool call each: run `cat README.md`; change Hello to Hi in src/app.js with your patch tool; run `ls`; run `cat missing.txt`; run `for i in 1 2 3 4; do echo line $i; sleep 1; done`. Then reply DONE."
  - While the loop runs, expand its row: the output grows line by line.
  - When it ends, the rows in order are:
    - "Read `README.md`": done, and not clickable.
    - "Edited `app.js`": done; its diff shows the `-`/`+` lines.
    - "Listed files": done, with the listing.
    - "Read `missing.txt`": Failed; its output says `No such file or directory`.
    - "Ran `for i in 1 2 3 4; …`": done. Its output has all four lines, including `line 1`, which the deltas skip.

- [ ] **Step 3: Codex new and deleted files**
  - Ask: "With your patch tool, create notes.txt containing the lines one and two. Then, with your patch tool, delete notes.txt. Reply DONE."
  - Expected rows:
    - "Created `notes.txt`", whose diff is `+one` and `+two`;
    - "Deleted `notes.txt`", whose diff is `-one` and `-two`.
  - If the deleted file's lines show as `--one`, Codex sends a delete as a diff, not as content. Record it, and change the `delete` branch of `codexChangesDiff` to keep the text as is.

- [ ] **Step 4: Approvals in Ask mode**
  - Claude:
    - Ask: "Run `touch a.txt`." While the card is open, the row "Ran `touch a.txt`" says "Waiting for approval".
    - Deny. The row shows "Failed", and its output ends with `Denied in Milagre`.
  - Codex:
    - Ask: "Run `touch b.txt`." The row says "Waiting for approval".
    - Allow once. The row ends done, and `b.txt` exists.

- [ ] **Step 5: Stop mid-command**
  - Codex: ask "Run `sleep 30`". Once its row shows a spinner, press Escape.
    - The reply ends "Agent run cancelled.".
    - The row is saved with "Failed".
    - No row is left with a spinner.
  - Claude: the same check.

- [ ] **Step 6: Steering**
  - Claude: ask "Run `sleep 5 && echo one`, then `sleep 5 && echo two`, then reply DONE." While the first command runs, send "Skip the second command and reply BANANA."
  - The chat reads, in order:
    1. the first message;
    2. the reply so far, holding any rows that had finished;
    3. the steering message;
    4. the rest of the reply. A row still running at the split appears here once.
  - No row appears twice, and none still spins after the turn ends. The reply ends with BANANA.

- [ ] **Step 7: Subagents**
  - Ask Claude: "Use the Agent tool to run `ls` and tell me the files."
  - Expected: one row, "Ran an agent: …" (or "Started an agent: …" if Claude ran it in the background). There is no "Ran `ls`" row from inside the agent.
  - When the agent finishes, its report appears in the reply. For a background agent, it arrives in a reply Claude starts by itself.

- [ ] **Step 8: Saved replies**
  - Reload the window after the turns above end. Every reply shows the same rows, in the same places and states.
  - In `.milagre/coordination.json`:
    - assistant messages have `steps` with `offset`;
    - no step has `status: "running"`;
    - no `detail` is longer than 20,012 characters.
  - Open a project whose `coordination.json` was written by `main`, with no `steps`. Its chats load and render unchanged.

- [ ] **Step 9: Large output**
  - Ask Codex: "Run `seq 1 200000`."
  - The window stays responsive while it runs.
  - The expanded row starts with `… truncated` and ends with `200000`.
  - The saved detail is at most 20,012 characters.

- [ ] **Step 10: Record the results** in the pull request's "How was it verified?" section, with screenshots of a Claude reply and a Codex reply with rows, one row expanded in each.
