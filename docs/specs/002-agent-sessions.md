# Agent Sessions — Specification

## Problem Statement

Milagre runs each chat message as a one-shot child process: `claude --print …` or `codex exec --ephemeral …`. It waits for the process to exit and shows its whole stdout as the reply. This has five consequences.

- **No memory.** Every message starts a new agent, so a chat cannot refer to earlier turns.
- **No progress.** Nothing appears until the run ends, and a 120 s timeout kills longer tasks.
- **Noisy replies.** CLI log lines (hook notices, warnings, raw JSON errors) end up in the reply.
- **Guessed approvals.** Ask approval is a regular expression run on the prompt before the agent starts. The agent cannot ask about the actual command or edit it wants to make.
- **One run at a time.** A single global process handle means one agent can run across all chats.

## Solution

Keep one long-lived agent session per chat in the Electron main process, behind a small provider interface with two implementations:

- **Claude** through the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) with streaming input.
- **Codex** through `codex app-server`, a JSON-RPC process over stdio.

Both emit one normalised event stream. The renderer starts turns, answers approval requests and interrupts turns over IPC, and renders the stream as it arrives: reply text, compact tool steps, and approval cards.

The approach follows [Paseo](https://github.com/getpaseo/paseo) (Apache-2.0), which drives the same two agents this way. Milagre reuses the ideas, not the code.

## User Stories

1. As a user, I want a chat to remember earlier turns, including after I restart Milagre, so I can build on previous answers.
2. As a user, I want the reply to appear as the agent writes it, so I can follow progress and stop a run that is going the wrong way.
3. As a user, I want long tasks to run as long as they need, so work is not cut off at two minutes.
4. As a user, I want to see each command, file edit and search the agent performs as a short row, and expand it for the raw output or diff.
5. As a user in Ask mode, I want the agent to stop and show me the exact command or change before it runs, and to allow it once, allow it for the rest of the chat, or deny it.
6. As a user, I want Cancel (or Escape) to stop the current turn without losing the chat.
7. As a user, I want two chats to run agents at the same time.
8. As a user, I want the model picker to list the Codex models my account can actually use.
9. As a user who opens Milagre from Finder, I want it to find the `claude` and `codex` CLIs installed in my shell.
10. As a user, I want a clear message when a CLI is missing, not logged in, or crashes, and the next message to recover on its own.

## Implementation Decisions

### Placement and modules

The agent host lives in the Electron main process, which already owns processes and filesystem access. New CommonJS modules go under `electron/agents/`:

- `session-manager.cjs`: owns one session per chat id, creates sessions lazily, routes IPC calls, forwards events to the window, and closes idle sessions.
- `claude-provider.cjs`: Claude Agent SDK session. The SDK is ESM-only and is loaded with a dynamic `import()`.
- `codex-provider.cjs`: Codex session on top of `codex-rpc.cjs`.
- `codex-rpc.cjs`: newline-delimited JSON-RPC client for `codex app-server`. It handles requests, notifications and server-to-client requests.
- `events.cjs`: the event shapes (JSDoc) plus pure functions that map each provider's raw messages to Milagre events.
- `environment.cjs`: imports the login-shell `PATH` at startup and resolves the `claude` and `codex` binaries.
- `process-tree.cjs`: tree-kills a session's process group, sending SIGTERM and then SIGKILL after 2 s.

`electron/agent-runner.cjs` and the CLI-argument half of `electron/image-input.cjs` are removed once both providers are in place. Image validation (`decodeImages`) stays.

### Provider interface

Each provider session exposes:

- `startTurn({ prompt, images, model, permissionMode })`
- `respondToPermission(requestId, decision)`, where `decision` is `"allow" | "allow-for-chat" | "deny"`
- `interrupt()`
- `close()`
- `nativeId`: the Claude session id or the Codex thread id

### Event stream

Main sends `agent:event` messages `{ chatId, event }` to the renderer. Event types:

- `session-started { nativeId }`: the renderer saves it on the chat.
- `text-delta { messageId, text }`
- `step-started { step }`, where `step = { id, kind, title, detail? }`. `kind` is one of `shell`, `edit`, `read`, `search`, `other`.
- `step-output { id, text }`: streamed command output, appended to the step.
- `step-completed { id, status, detail? }`, where `status` is `done` or `failed`. `detail` holds the raw output or a unified diff.
- `permission-request { requestId, kind, title, command?, cwd?, diff?, files? }`, where `kind` is `command`, `edit` or `other`.
- `permission-resolved { requestId, decision }`
- `turn-completed`, `turn-failed { message }`, `turn-cancelled`

Text deltas are batched in main into 50 ms windows before sending, to keep IPC traffic low during fast streaming.

### IPC contract

Renderer to main:

- `agent:start-turn { chatId, provider, model, cwd, permissionMode, prompt, images, resumeId? }`. It resolves once the turn starts; results arrive as events.
- `agent:respond-permission { chatId, requestId, decision }`
- `agent:interrupt { chatId }`
- `agent:models`: returns `{ codex: ModelOption[], claude: ModelOption[] }`.

`agent:send` and `agent:cancel` are removed.

### Session lifecycle

- **Creation.** A session is created on a chat's first turn. When the chat has a saved `native_session_id`, the session resumes it: `resume` for Claude, `thread/resume` for Codex.
- **Provider lock.** A chat is bound to the provider it started with. The model picker disables the other provider's tab for a chat that has messages, with a hint to start a new chat. Switching models within a provider is allowed: Claude via `setModel`, Codex per turn on `turn/start`.
- **Permission mode.** Changes apply from the next turn: Claude via `setPermissionMode`, Codex via the per-turn `approvalPolicy` and `sandboxPolicy`.
- **Timeouts.** Turns and permission waits have none. Only control calls are bounded: the `turn/start` acknowledgement at 90 s, and interrupt at 3 s before falling back to a tree-kill.
- **Idle sessions.** A session with no turn for 10 minutes is closed. Its saved native id lets the next message resume it.
- **Shutdown.** On app quit every session is closed and its process tree killed. The renderer saves finished turns, so closing the last window on macOS (where the app stays open) also interrupts running turns and closes the sessions. They resume on the next message.
- **Crashes.** If an agent process exits mid-turn, the session emits `turn-failed` and is dropped. The next message starts a new process that resumes the saved native id.

### Claude provider

- `query()` gets an async-iterable prompt. Each turn pushes one user message into the running query.
- **Options:**
  - `cwd`, `model`, `permissionMode`, `canUseTool`, `includePartialMessages: true`, `resume`
  - `pathToClaudeCodeExecutable`: the resolved user binary, so Milagre uses the same CLI and login as the terminal
  - `systemPrompt: { type: "preset", preset: "claude_code", append }`, where `append` is the instruction text Milagre prepends to every prompt today ("You are an agent inside Milagre…")
  - `settingSources: ["user", "project", "local"]`, so CLAUDE.md and settings still apply
- **Version.** The SDK is pinned to an exact version whose minor matches the supported Claude Code CLI (SDK `0.3.x` goes with CLI `2.1.x`). At session start, Milagre checks `claude --version` and reports a clear error below the minimum.
- **Images.** Images are sent as base64 `image` content blocks, as today.
- **Mapping.**
  - `stream_event` `text_delta` becomes `text-delta`.
  - Assistant `tool_use` blocks become `step-started`. `Bash` maps to `shell`; `Edit`, `Write` and `MultiEdit` to `edit`; `Read` to `read`; `Grep` and `Glob` to `search`; everything else to `other`.
  - The matching `tool_result` becomes `step-completed`.
  - `result` becomes `turn-completed`, or `turn-failed` when `is_error`.
- **Approvals.** `canUseTool` emits `permission-request` and returns a pending promise:
  - `allow`: `{ behavior: "allow" }`
  - `allow-for-chat`: `{ behavior: "allow", updatedPermissions: <the suggestions the SDK passed in> }`
  - `deny`: `{ behavior: "deny", message: "Denied in Milagre" }`

  Pending requests are rejected when the turn is interrupted.
- **Mode mapping.** Ask is `default`, Auto is `acceptEdits`, Full is `bypassPermissions`. Full needs `allowDangerouslySkipPermissions: true`.

### Codex provider

- **Startup.** Spawn `codex app-server` detached. Send `initialize { clientInfo: { name: "milagre", version } }`, then the `initialized` notification.
- **Threads.** The first turn calls `thread/start { model, cwd, approvalPolicy, sandbox, developerInstructions }`. Later turns reuse the thread. After a restart the provider calls `thread/resume`, with `thread/unarchive` as a fallback.
- **Turns.** `turn/start { threadId, input, model, approvalPolicy, sandboxPolicy, cwd }`. Images are written to a temporary file and sent as `{ type: "localImage", path }`. The file is deleted when the turn ends.
- **Mapping.**
  - `item/agentMessage/delta` becomes `text-delta`.
  - `item/started` for `commandExecution` or `fileChange` becomes `step-started`.
  - `item/commandExecution/outputDelta` becomes `step-output`.
  - `item/completed` becomes `step-completed`.
  - `turn/completed` becomes `turn-completed`, `turn-failed` or `turn-cancelled`.
  - Unknown notifications are ignored.
- **Approvals.** The server requests `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` become `permission-request`. The reply is `accept`, `acceptForSession` or `decline`.
- **Mode mapping.**

  | Milagre mode | `approvalPolicy` | `sandbox` |
  | --- | --- | --- |
  | Ask | `untrusted` | `workspace-write` |
  | Auto | `on-request` | `workspace-write` |
  | Full | `never` | `danger-full-access` |

  The exact behaviour of `untrusted` and `on-request` for file changes is verified against the CLI during implementation.
- **Interrupt.** `turn/interrupt { threadId, turnId }`.
- **Protocol types.** Only the subset of the app-server protocol used here is relied on, and it is documented in `codex-rpc.cjs`. Field access is defensive, because the protocol is marked experimental. The minimum supported Codex version is 0.158.0, checked with `codex --version`.

### Models

- **Codex.** `agent:models` lists Codex models through `model/list` on a short-lived `codex app-server`. The result is cached for the app session and falls back to the current hardcoded list on failure.
- **Claude.** Models stay a maintained list in `app/src/model.ts`.
- **Picker.** The model picker reads both lists from `agent:models`.

### Persistence

The changes to `coordination.json` are additive, so older files load unchanged.

- `AgentSession` gains `provider?: "codex" | "claude"` and `native_session_id?: string`.
- Assistant `ChatMessage`s gain:
  - `steps?: ChatStep[]`, with `ChatStep = { id, kind, title, status, detail? }`. Each step's `detail` is capped at 20 KB, with a truncation note.
  - `outcome?: "completed" | "failed" | "cancelled"`
- Streaming state lives in memory. The finished assistant message (text plus steps) is saved when the turn ends. A turn interrupted by quitting the app is saved with `outcome: "cancelled"`.

### Renderer

- **Run state.** Each chat has its own run state, replacing the single `isSending`. Escape interrupts the turn in the open chat.
- **Live message.** The live assistant message shows streamed text, then tool rows: an icon, a title such as "Ran `npm test`" or "Edited `App.tsx`", and a spinner or status. Clicking a row expands the output or diff.
- **Approval card.** The existing `ToolApproval` card appears inline when the open chat has a pending request. Its buttons are Allow once, Always allow in this chat, and Deny.
- **Removed.** The prompt regex (`requiresApproval`), the pre-run approval flow and the slash-command confirmation in Ask mode are removed.
- **Docs.** The README's permission-mode and slash-skill sections are updated to match.

### Delivery

The work ships as four stacked pull requests, each usable on its own:

1. **Sessions and streaming text.** Session manager, both providers without approvals, the event stream, resume, cancel, and the persistence fields. Ask keeps today's pre-run check in this step, so it never becomes less strict.
2. **Real approvals.** Permission requests, the approval card, the mode mapping, and removal of the prompt regex.
3. **Tool steps.** Step events, tool rows, and saving steps.
4. **Models and environment.** `model/list`, login-shell `PATH`, version checks, and missing-CLI errors.

## Testing Decisions

- **`codex-rpc.cjs`.** Unit-tested against a fake app-server: a Node script that speaks the JSON-RPC subset. The tests cover request/response matching, notifications, server-to-client approval requests, process exit mid-turn, and interrupt.
- **`codex-provider.cjs`.** Tested with recorded notification fixtures, mapped to Milagre events.
- **`claude-provider.cjs`.** Tested with an injected fake `query()` that yields recorded SDK messages and calls `canUseTool`. The tests cover streaming, resume options, permission round-trips and interrupt.
- **`session-manager.cjs`.** Tested with fake providers, covering lazy creation, one session per chat, concurrent chats, idle close, crash recovery and shutdown.
- **`events.cjs`.** The mapping functions are pure and tested directly.
- **Renderer.** Headless Chromium checks with a stubbed bridge that emits event sequences. They cover streaming, tool rows, the approval card, cancel, and two chats running at once.
- **Manual.** Before each pull request is merged, run a real Claude and a real Codex turn in Electron covering resume after restart, an approval in Ask mode, and cancel.

## Out of Scope

- Steering a running turn with a new message, which is queued until the turn ends instead.
- Plan mode, `AskUserQuestion`, rewind, fork and checkpoints.
- Showing reasoning, token usage or cost.
- MCP server configuration from Milagre.
- Other providers (OpenCode, ACP agents).
- Importing sessions started outside Milagre.

## Further Notes

- **Protocol stability.** The Codex app-server protocol is experimental. Pinning a minimum version and reading fields defensively limits breakage. A version check failure must explain what to update.
- **Claude version skew.** Using the user's Claude binary with a pinned SDK can drift when the CLI updates. The version check catches a CLI that is too old. A newer CLI is expected to stay compatible within the same major version.
- **Session transcripts.** Claude Code and Codex keep their own session transcripts (under `~/.claude` and `~/.codex`). Resuming depends on them, so Milagre does not delete them.
- **Attribution.** Codex is initialised with `clientInfo.name = "milagre"`, so its usage is attributed honestly.
