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

Both emit one normalised event stream. The renderer starts turns, answers approval requests and agent questions, and interrupts turns over IPC. It renders the stream as it arrives: reply text, compact tool steps, approval cards and question cards.

The approach follows [Paseo](https://github.com/getpaseo/paseo) (Apache-2.0), which drives the same two agents this way. Milagre reuses the ideas, not the code.

## User Stories

1. As a user, I want a chat to remember earlier turns, including after I restart Milagre, so I can build on previous answers.
2. As a user, I want the reply to appear as the agent writes it, so I can follow progress and stop a run that is going the wrong way.
3. As a user, I want long tasks to run as long as they need, so work is not cut off at two minutes.
4. As a user, I want to see each command, file edit and search the agent performs as a short row, and expand it for the raw output or diff.
5. As a user in Ask mode, I want the agent to stop and show me the exact command or change before it runs, and to allow it once, allow it for the rest of the chat, or deny it.
6. As a user, I want Cancel (or Escape) to stop the current turn without losing the chat.
7. As a user, I want to send a message while the agent works, so I can steer it without stopping the turn.
8. As a user, I want two chats to run agents at the same time.
9. As a user, I want the model picker to list the Codex models my account can actually use.
10. As a user who opens Milagre from Finder, I want it to find the `claude` and `codex` CLIs installed in my shell.
11. As a user, I want a clear message when a CLI is missing, not logged in, or crashes, and the next message to recover on its own.
12. As a user, when an agent asks me to choose between options, I want to tap an option on a card, type my own answer, or dismiss the question, and have the agent carry on from my answer in the same turn.

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

- `startTurn({ prompt, images, model, permissionMode })`, which resolves to `{ turnId, steered }`. When the chat already has a turn running, the message steers that turn instead of starting a new one (see Steering).
- `respondToPermission(requestId, decision)`, where `decision` is `"allow" | "allow-for-chat" | "deny"`
- `answerQuestion(requestId, answers)`, where `answers` maps question ids to the labels picked and any typed answer, or is `null` to dismiss the question (see Questions)
- `interrupt()`
- `close()`
- `nativeId`: the Claude session id or the Codex thread id

### Event stream

Main sends `agent:event` messages `{ chatId, event }` to the renderer. Event types:

- `session-started { nativeId }`: the renderer saves it on the chat.
- `turn-started { turnId }`: the first event of every turn. The renderer already shows a turn it started itself; this event matters for turns it didn't start, such as a steering message that arrived just after the previous turn ended.
- `text-delta { messageId, text }`
- `step-started { step }`, where `step = { id, kind, title, detail? }`:
  - `kind` is one of `shell`, `edit`, `read`, `search`, `other`.
  - `title` says what the step did, in the past tense, with code between backticks: "Ran `npm test`", "Edited `App.tsx`".
  - A command's `detail` starts as `$ <command>`.
- `step-output { id, text }`: streamed command output, appended to the step. Only Codex streams output; Claude Code reports a command's output when it ends.
- `step-completed { id, status, title?, detail? }`, where `status` is `done` or `failed`.
  - `detail` holds the command and its output, a unified diff, or the tool's result. It replaces anything streamed into the step.
  - `title`, when present, replaces the first one. Some steps only learn it at the end: a Codex web search learns its query, and a Claude agent turns out to run in the background.
  - A step still running when its turn ends gets no `step-completed`. Codex sends none for a command cut off by an interrupt, so the renderer closes such steps when the turn ends.
- `permission-request { requestId, kind, tool, title, description?, command?, cwd?, diff?, files?, detail?, reason?, allowForChat, stepId? }`, where `kind` is `command`, `edit` or `other`. `allowForChat` says whether "Always allow in this chat" can be offered. `stepId` names the step the request is about. `diff` and `detail` are capped at 20 KB.
- `permission-resolved { requestId, decision }`, where `decision` is `allow`, `allow-for-chat`, `deny` or `cancelled`. A request is cancelled when its turn is interrupted or ends, or when the agent withdraws it.
- `question-request { requestId, questions }`, where each question is `{ id, header, question, options, multiSelect, allowOther, secret }` and each option is `{ label, description? }` (see Questions).
- `question-resolved { requestId, outcome }`, where `outcome` is `answered`, `dismissed` or `cancelled`.
- `turn-completed`, `turn-failed { message }`, `turn-cancelled`
- `session-reset`: the saved native id can't be resumed (transcript or thread deleted). The renderer forgets it and the next message starts a fresh session.

Text deltas and step output are batched in main into 50 ms windows before sending, to keep IPC traffic low during fast streaming. A batch of step output keeps only its last 20 KB, as the renderer does.

### IPC contract

Renderer to main:

- `agent:start-turn { chatId, provider, model, cwd, permissionMode, prompt, images, resumeId? }`. It resolves once the turn starts; results arrive as events.
- `agent:respond-permission { chatId, requestId, decision }`
- `agent:answer-question { chatId, requestId, answers }`. It resolves to whether the question was still open.
- `agent:interrupt { chatId }`
- `agent:models`: returns `{ codex: ModelOption[], claude: ModelOption[] }`.

`agent:send` and `agent:cancel` are removed.

### Session lifecycle

- **Creation.** A session is created on a chat's first turn. When the chat has a saved `native_session_id`, the session resumes it: `resume` for Claude, `thread/resume` for Codex.
- **Provider lock.** A chat is bound to the provider it started with. The model picker disables the other provider's tab for a chat that has messages, with a hint to start a new chat. Switching models within a provider is allowed: Claude via `setModel`, Codex per turn on `turn/start`.
- **Permission mode.** Changes apply from the next turn: Claude via `setPermissionMode`, Codex via the per-turn `approvalPolicy` and `sandboxPolicy`.
- **Timeouts.** Turns, permission waits and question waits have none. Claude Code's dialog deadline (`dialogExpiry`, `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS`) doesn't apply to `canUseTool`: a question held there for 15 s under a 3 s deadline stayed open. Only control calls are bounded: the `turn/start` acknowledgement at 90 s, and interrupt at 3 s before falling back to a tree-kill.
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
  - Assistant `tool_use` blocks become `step-started`.
    - The block comes from the assistant message, which carries it once its input is complete. The streamed `input_json_delta` is not used.
    - `Bash` maps to `shell`; `Edit`, `Write`, `MultiEdit` and `NotebookEdit` to `edit`; `Read` to `read`; `Grep`, `Glob` and `WebSearch` to `search`; everything else to `other`.
    - Claude Code 2.1.287 has no `Grep` or `Glob` tool: it searches through `Bash` (`grep`, `find`), and those show as `shell`.
  - The matching `tool_result` becomes `step-completed`.
    - The step fails when `is_error` is true: a tool error, a denied approval, or a tool cut off by Stop.
    - Edit and Write diffs come from the message's `tool_use_result.structuredPatch`, or from the input when there is none.
    - A read that worked keeps no detail.
  - **Subagents.** Messages with `parent_tool_use_id` set are not shown; the `Agent` call that started them is one step.
    - Its detail is the agent's report, from `tool_use_result.content`.
    - Claude often starts agents in the background. Then the step completes at launch, titled "Started an agent: …". The report arrives after the turn ends, in a turn Claude Code starts by itself (see Steering).
  - `result` becomes `turn-completed`, or `turn-failed` when `is_error`.
- **Approvals.** `canUseTool` emits `permission-request` and returns a pending promise:
  - `allow`: `{ behavior: "allow" }`
  - `allow-for-chat`: `{ behavior: "allow", updatedPermissions: <the suggestions the SDK passed in> }`
  - `deny`: `{ behavior: "deny", message: "Denied in Milagre" }`

  Pending requests are rejected when the turn is interrupted, with `interrupt: true`, or when the SDK aborts them.
- **Always allow in this chat.** The SDK's suggestions are applied with every `destination` rewritten to `session`, so nothing is written to the user's settings files. The option is hidden when there are no suggestions or the SDK sets `suppressAlwaysAllowRule`.
- **Card text.** The SDK's `title`, `displayName` and `description` are used when present; otherwise Milagre builds them from the tool name and input.
- **Questions.** `AskUserQuestion` reaches `canUseTool` in every permission mode, Full included, and becomes a question card (see Questions). No tool is passed in `disallowedTools`.
- **Mode mapping.** Ask is `default`, Auto is `acceptEdits`, Full is `bypassPermissions`. Full needs `allowDangerouslySkipPermissions: true`.

### Codex provider

- **Startup.** Spawn `codex app-server` detached. Send `initialize { clientInfo: { name: "milagre", version } }`, then the `initialized` notification.
- **Threads.** The first turn calls `thread/start { model, cwd, approvalPolicy, sandbox, developerInstructions, config }`. Later turns reuse the thread. After a restart the provider calls `thread/resume` with the same parameters, with `thread/unarchive` as a fallback. `config` is `{ features: { default_mode_request_user_input: true } }`, which lets Codex ask questions outside Plan mode (see Questions).
- **Turns.** `turn/start { threadId, input, model, approvalPolicy, sandboxPolicy, cwd }`. Images are written to a temporary file and sent as `{ type: "localImage", path }`. The file is deleted when the turn ends.
- **Mapping.**
  - `item/agentMessage/delta` becomes `text-delta`.
  - `item/started` for a tool item becomes `step-started`:
    - `commandExecution`. A command that Codex's `commandActions` names as one read, search or file listing maps to `read` or `search`; any other command is `shell`.
    - `fileChange` is `edit`; `mcpToolCall` and `dynamicToolCall` are `other`; `webSearch` is `search`; `imageView` is `read`.
    - Messages, reasoning, plans and other items are not steps.
  - `item/commandExecution/outputDelta` becomes `step-output`. It is only a preview: the first chunk can be missing, and `item/completed` carries the whole `aggregatedOutput`.
  - `item/completed` becomes `step-completed`.
    - The step fails for status `failed` or `declined`, or a non-zero `exitCode`.
    - A `webSearch` only has its query at this point.
    - An item that completes without having started still shows.
  - A command running when the turn is interrupted gets no `item/completed`.
  - A `fileChange` reports a new or deleted file's content as plain text and an update as a diff hunk. Milagre turns added and removed content into `+` and `-` lines, in steps and approval cards alike.
  - `turn/completed` becomes `turn-completed`, `turn-failed` or `turn-cancelled`.
  - Unknown notifications are ignored.
- **Approvals.** The server requests `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` become `permission-request`. The reply is `accept`, `acceptForSession` or `decline`, and `cancel` for requests still open when the turn is interrupted or ends.
  - File-change requests carry no diff, so the provider keeps the `changes` of each `fileChange` item from `item/started` and shows those.
  - Shell commands arrive wrapped (`/bin/zsh -lc '…'`); the card shows the inner command.
  - `serverRequest/resolved` withdraws a request the user hasn't answered; it resolves as `cancelled`.
  - `item/permissions/requestApproval` is declined with `{ permissions: {}, scope: "turn" }`. `item/tool/requestUserInput` becomes a question card (see Questions). Other server requests get an error reply.
- **Mode mapping.**

  | Milagre mode | `approvalPolicy` | `sandbox` |
  | --- | --- | --- |
  | Ask | `untrusted` | `workspace-write` |
  | Auto | `on-request` | `workspace-write` |
  | Full | `never` | `danger-full-access` |

  The exact behaviour of `untrusted` and `on-request` for file changes is verified against the CLI during implementation.
- **Interrupt.** `turn/interrupt { threadId, turnId }`.
- **Protocol types.** Only the subset of the app-server protocol used here is relied on, and it is documented in `codex-rpc.cjs`. Field access is defensive, because the protocol is marked experimental. The minimum supported Codex version is 0.158.0, checked with `codex --version`.

### Steering

A message sent while the chat's turn is running joins that turn instead of waiting for it to end. Model and permission-mode changes apply from the next turn.

- **Claude.** The message is pushed into the running query's streaming input, with no `priority`. Probing Claude Code 2.1.286 showed that a message pushed during a tool call is picked up at the next tool boundary, inside the same turn. One pushed while the final text streams ends that turn as usual, and Claude Code then starts a new turn for it on its own. That turn opens with a `system` `init` message while the session is idle, so the provider starts an implicit turn and emits `turn-started`.
- **Codex.** `turn/steer { threadId, expectedTurnId, input }`. A message sent before `turn/start` has returned waits for the turn id. If Codex refuses because the turn has already ended, the message starts the next turn once the current one is over.
- **Weaker models may ignore it.** gpt-6-sol followed a steering message in testing; gpt-6-luna received it and carried on with the original task.

### Questions

When an agent asks the user to choose, the turn waits on a question card instead of ending with a question in its reply. Behaviour below was verified against Claude Code 2.1.287 (SDK 0.3.286) and codex-cli 0.158.0.

- **Own events, not permission requests.** Questions get `question-request`, `question-resolved` and `agent:answer-question` instead of a `question` kind on the permission events.
  - A question's payload (up to four questions, options, multi-select, typed answers) and its answer (text per question) share nothing with an approval's three decisions.
  - Folding them in would loosen the strict check on `agent:respond-permission` and give approval fields (`allowForChat`, `command`, `diff`) no meaning for half the requests.
  - The bookkeeping, `PendingQuestions` in `electron/agents/questions.cjs`, mirrors `PendingPermissions`: each question is settled exactly once.
- **Shapes.**
  - A request is `{ requestId, questions: [{ id, header, question, options: [{ label, description? }], multiSelect, allowOther, secret }] }`. One request can hold several questions, answered together.
  - Answers are `{ [questionId]: string[] }`: the labels picked, in option order, then the typed answer. `null` dismisses the question.
  - Answers to ids the request didn't ask, and blank strings, are dropped. If nothing is left, the question is dismissed.
  - The main process accepts `null`, or at most 10 ids with at most 20 strings each, each at most 10,000 characters. It rejects anything else.
- **Claude.**
  - `AskUserQuestion` carries 1–4 questions, each `{ question, header, options, multiSelect }` with 2–4 options of `{ label, description, preview? }`. Claude Code validates the input before `canUseTool` sees it.
  - `canUseTool` gets it in `default`, `acceptEdits` and `bypassPermissions` alike, with `requiresUserInteraction: true` and no suggestions. Question ids are positions (`"0"` to `"3"`). An option's `preview` is not shown.
  - Answered: `{ behavior: "allow", updatedInput: { ...input, answers } }`. `answers` maps each question's text to its answers joined with `", "`, as Claude Code's own dialog sends them. A typed answer goes the same way, and Claude Code tells the model to read it carefully. Answers under any other key reach Claude as "The user did not answer the questions."
  - Dismissed: `{ behavior: "deny", message: "The user closed the question without picking an answer. If they sent a message instead, follow it; otherwise carry on without the answer, or ask in your reply if you can't." }`. Claude then asks in its reply rather than with the tool again.
  - Cancelled: `{ behavior: "deny", message: "The turn was cancelled in Milagre.", interrupt: true }`, as for approvals.
  - Input Milagre can't show gets no card: `{ behavior: "deny", message: "Milagre couldn't show this question. Ask it in your reply instead." }`.
- **Codex.**
  - Codex's `request_user_input` tool exists only in Plan mode unless the `default_mode_request_user_input` feature is on. Milagre turns the feature on per thread through `config` (see Codex provider). An unknown feature name there is ignored, while `codex app-server --enable` with an unknown name refuses to start, so Milagre never uses `--enable`.
  - `item/tool/requestUserInput { threadId, turnId, itemId, questions, isBlocking, autoResolutionMs }` becomes `question-request` under the request's JSON-RPC id. Each question is `{ id, header, question, isOther, isSecret, options: [{ label, description }] | null }`.
  - Codex has no multi-select. `allowOther` is `isOther`, or true when there are no options; `secret` is `isSecret`.
  - Answered: `{ answers: { [questionId]: { answers: string[] } } }`. Dismissed, cancelled, or a request Milagre can't show: `{ answers: {} }`, which Codex reads as "no answer, carry on".
  - Requests with `isBlocking: false` still wait for the answer.
  - `serverRequest/resolved` withdraws an open question, which resolves as `cancelled`. Codex also sends it after every answer, where it changes nothing.
- **Cancel.**
  - Open questions are cancelled when their turn is interrupted, ends or fails, when the session closes, and on reload, which interrupts every turn.
  - A question asked once its turn has stopped is answered at once without a card: `cancelled` for Claude, no answers for Codex.
- **Steering.** A message sent while a question is open dismisses it, then joins the turn as usual. Approvals are not dismissed by steering.
  - Claude Code holds a steering message until the question it waits on is settled. Without the dismissal, the message would sit unseen behind the card.
  - The agent reads the message as the user's reply. In testing, both agents answered "Green. Also end your reply with the word BANANA." sent after a dismissal with "CHOSEN=Green BANANA".
- **Card.**
  - A run keeps `questions` next to `approvals`, oldest first. The card slot above the composer shows the oldest approval, or the oldest question when no approval waits.
  - The card is built like the approval card. Each question shows its header and its options as rows: radio rows, or checkbox rows where the agent allows several. A text field takes the user's own answer when the question allows one; for a secret it hides the text.
  - "Send answer" is enabled once every question has an answer, and "Dismiss" dismisses. A card with one single-choice question sends on the first tap.
  - The card shows the answer as sending until `question-resolved` arrives. It goes back to waiting if the question was already gone.
  - Answers are not saved in the chat; the agent's reply carries on from them.
- **Escape.** Escape denies an open approval first, otherwise dismisses an open question, otherwise interrupts the turn. In the card's text field, Escape first clears a typed answer.
- **Instructions.** `MILAGRE_INSTRUCTIONS` ends with: "When you need the user to choose between options, ask with your question tool if you have one (AskUserQuestion or request_user_input); otherwise ask in your reply as a short numbered list."
- **Recommendation cards stay as they are.** They turn a numbered list in a finished reply into tappable options that send a new message.
  - They remain the path for agents that ask in their reply: a Codex without the question tool, or a model that prefers text.
  - Question cards answer a tool call in the middle of a turn. The two share no code, and neither replaces the other.

### Models

- **Codex.** `agent:models` lists Codex models through `model/list` on a short-lived `codex app-server`. The result is cached for the app session and falls back to the current hardcoded list on failure.
- **Claude.** Models stay a maintained list in `app/src/model.ts`.
- **Picker.** The model picker reads both lists from `agent:models`.

### Persistence

The changes to `coordination.json` are additive, so older files load unchanged.

- `AgentSession` gains `provider?: "codex" | "claude"` and `native_session_id?: string`.
- Assistant `ChatMessage`s gain:
  - `steps?: ChatStep[]`, with `ChatStep = { id, kind, title, status, detail?, offset? }`, in the order the steps started.
    - A saved `status` is `done` or `failed`. A step still running when its turn ends is saved as `done` if the turn completed, and `failed` if it failed or was cancelled.
    - `offset` is the length of the reply's text when the step started, measured in the saved (trimmed) body. The step is shown at that point in the text.
    - Each step's `detail` is capped at 20 KB, with a truncation note. Command output keeps its end, where results and errors are; diffs and other details keep their start.
    - A reply with steps but no text saves an empty body.
  - `outcome?: "completed" | "failed" | "cancelled"`
- Streaming state lives in memory. The finished assistant message (text plus steps) is saved when the turn ends. A turn still running when the last window closes or the app quits is interrupted; the user's message is already saved, but its partial reply and steps are not.

### Renderer

- **Run state.** Each chat has its own run state, replacing the single `isSending`. Escape denies the open chat's pending approval, or dismisses its open question, and otherwise interrupts its turn.
- **Steering.** Send stays enabled while a turn runs, and a message sent then steers the turn. The text and finished steps streamed so far are saved as their own assistant message, then the new user message, and the reply continues below it. Steps still running continue at the top of the rest of the reply. A message sent while a question is open dismisses the question first.
- **Reload.** Reloading the renderer interrupts every running turn, so no turn is left waiting on an approval card that no longer exists.
- **Live message.** The live assistant message shows streamed text with tool rows where they happened. Saved replies show their rows the same way.
  - A row has an icon for its kind and a title such as "Ran `npm test`" or "Edited `App.tsx`".
  - It ends with a spinner while the step runs, then a check or "Failed".
  - A row whose step waits on the open approval card says "Waiting for approval". Both agents report a tool call before asking about it, so the row appears first.
  - Clicking a row that has output or a diff expands it.
- **Approval card.** The existing `ToolApproval` card appears inline when the open chat has a pending request. Its buttons are Allow once, Always allow in this chat, and Deny.
- **Question card.** It takes the approval card's place when the open chat's turn waits on a question and no approval (see Questions).
- **Removed.** The prompt regex (`requiresApproval`), the pre-run approval flow and the slash-command confirmation in Ask mode are removed.
- **Docs.** The README's permission-mode and slash-skill sections are updated to match.

### Delivery

The work ships as five stacked pull requests, each usable on its own:

1. **Sessions and streaming text.** Session manager, both providers without approvals, the event stream, resume, cancel, and the persistence fields. Ask keeps today's pre-run check in this step, so it never becomes less strict.
2. **Real approvals and steering.** Permission requests, the approval card, the mode mapping, removal of the prompt regex, and steering a running turn.
3. **Tool steps.** Step events, tool rows, and saving steps.
4. **Models and environment.** `model/list`, login-shell `PATH`, version checks, and missing-CLI errors.
5. **Question cards.** `AskUserQuestion` and Codex's `request_user_input` become question cards: the question events, `agent:answer-question`, the Codex thread `config`, cancel and steering rules, the card, Escape, and the new instructions. It builds on step 2 and needs neither step 3 nor step 4.

## Testing Decisions

- **`codex-rpc.cjs`.** Unit-tested against a fake app-server: a Node script that speaks the JSON-RPC subset. The tests cover request/response matching, notifications, server-to-client approval requests, process exit mid-turn, and interrupt.
- **`codex-provider.cjs`.** Tested with recorded notification fixtures, mapped to Milagre events.
- **`claude-provider.cjs`.** Tested with an injected fake `query()` that yields recorded SDK messages and calls `canUseTool`. The tests cover streaming, resume options, permission round-trips and interrupt.
- **`session-manager.cjs`.** Tested with fake providers, covering lazy creation, one session per chat, concurrent chats, idle close, crash recovery and shutdown.
- **`events.cjs`.** The mapping functions are pure and tested directly.
- **Questions.**
  - `questions.cjs` is pure and tested directly: the mapping both ways for each agent, the bookkeeping, and the answer check.
  - The providers are tested with the fake `query()` and the fake app-server: answering, dismissing, interrupting, withdrawal, steering, and a question asked after the turn stopped.
  - The card's answer rules live in `app/src/lib/question-answers.ts` and are tested with Node.
- **Renderer.** Headless Chromium checks with a stubbed bridge that emits event sequences. They cover streaming, tool rows, the approval card, cancel, and two chats running at once.
- **Manual.** Before each pull request is merged, run a real Claude and a real Codex turn in Electron covering resume after restart, an approval in Ask mode, a question card, and cancel.

## Out of Scope

- Plan mode, rewind, fork and checkpoints.
- Codex's asynchronous questions (`agentMessage` items that carry `questions`), option previews on `AskUserQuestion`, and saving questions and answers in the chat.
- Showing reasoning, token usage or cost.
- MCP server configuration from Milagre.
- Other providers (OpenCode, ACP agents).
- Importing sessions started outside Milagre.

## Further Notes

- **Protocol stability.** The Codex app-server protocol is experimental. Pinning a minimum version and reading fields defensively limits breakage. A version check failure must explain what to update.
- **Claude version skew.** Using the user's Claude binary with a pinned SDK can drift when the CLI updates. The version check catches a CLI that is too old. A newer CLI is expected to stay compatible within the same major version.
- **Session transcripts.** Claude Code and Codex keep their own session transcripts (under `~/.claude` and `~/.codex`). Resuming depends on them, so Milagre does not delete them.
- **Attribution.** Codex is initialised with `clientInfo.name = "milagre"`, so its usage is attributed honestly.
- **Codex's question tool is a feature under development.** `default_mode_request_user_input` is listed as "under development" in codex-cli 0.158.0. If a later Codex drops or renames it, the thread `config` is ignored, Codex asks in its reply again, and recommendation cards still apply.
