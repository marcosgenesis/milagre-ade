const { cliName } = require("@milagre/shared/providers");
const { claudeSubagents, codexSubagents } = require("./subagents.cjs");
/** @typedef {import("@milagre/shared/model").AgentEvent} AgentEvent */
// The wire event contract lives in @milagre/shared/model. Exactly one terminal event ends each turn.
const { isTurnEnd: isTerminal } = require("@milagre/shared/agent-runs");

const { applyToolResult, applyToolUse, codexPlanTasks } = require("./tasks.cjs");
const { claudeStep, claudeStepResult, codexStep, codexStepResult, thinkingEnd, thinkingStep } = require("./steps.cjs");

const { bundledWritingInstructions } = require("../bundled-skills.cjs");
const TLDR_INSTRUCTIONS = bundledWritingInstructions();
const LINKS_INSTRUCTIONS = [
  "Links: the user can link this Chat's Worktree to Worktrees of other Projects on Milagre's canvas. When a turn's input starts with a <linked_worktrees> block, that is Milagre's summary of the linked side, not a message from the user.",
  "Read the linked side with the milagre tools: linked_overview, read_linked_chat, linked_git, read_linked_file and search_linked_files. They are read-only and need no approval.",
  "Never edit a linked Worktree's files yourself. Ask for changes with delegate: the agent of the Chat you pick there carries them out, and its Delegation report comes back to this Chat later, so end your turn instead of waiting. A message that starts with \"Delegation from\" comes from another Chat, not the user; your final reply goes back to it as the report.",
  "When both sides must agree on something first (an API shape, a contract), open a Negotiation with delegate(negotiation: true). Each report then starts the other side's next turn, for up to 10 rounds; call conclude_negotiation(summary) once you agree. A turn handling a Delegation can't delegate, except inside a Negotiation.",
].join(" ");

function milagreInstructions(tldrEnabled = true, workspaceInstructions = "") {
  return [
    "You are an agent inside Milagre, an agent development environment. Answer the user concisely and humanly. Do not claim to have changed files unless you actually did.",
    tldrEnabled ? TLDR_INSTRUCTIONS : "Automatic TLDR writing is disabled in Settings. Do not carry forward previously applied automatic TLDR rules. Explicit /tldr requests and the user's own writing preferences still apply.",
    "Milagre folds your thinking away and the user rarely opens it. Anything they need to read (an answer, findings, the reason behind a question) goes in your reply text, written before you ask a question or end the turn.",
    "When you need the user to choose between options, ask with your question tool if you have one (AskUserQuestion or request_user_input); otherwise ask in your reply as a short numbered list.",
    LINKS_INSTRUCTIONS,
    ...(workspaceInstructions ? [workspaceInstructions] : []),
  ].join("\n\n");
}
const MILAGRE_INSTRUCTIONS = milagreInstructions();
const RESUME_FAILED_MESSAGE = "Couldn't resume this chat's earlier agent session; it may have been deleted. Send your message again to continue in a fresh session.";

// What a turn fails with when an agent's CLI can't run it. Each names the fix; the next message checks again.
const INSTALL_COMMANDS = { claude: "curl -fsSL https://claude.ai/install.sh | bash", codex: "npm install -g @openai/codex" };
const UPDATE_COMMANDS = { claude: "claude update", codex: "codex update" };
const LOGIN_COMMANDS = { claude: "claude auth login", codex: "codex login" };

// A tracing log line: "2026-10-02T00:59:00.724526Z ERROR codex_core::tools::router: error=…". The prefix says
// nothing a reader needs.
const LOG_PREFIX = /^(?:\d{4}-\d\d-\d\dT[\d:.]+Z?\s+)?(?:TRACE|DEBUG|INFO|WARN|ERROR)(?:\s+|$)(?:[\w.-]+(?:::[\w.-]+)*:(?:\s+|$))?/;

// The last non-empty line a CLI printed, without terminal colours and without a log line's timestamp, level
// and module, and whether it was a log line.
function readLastLine(text) {
  // oxlint-disable-next-line no-control-regex -- the pattern matches terminal or control characters on purpose
  const raw = String(text ?? "").replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((item) => item.trim()).filter(Boolean).at(-1) ?? "";
  const logged = LOG_PREFIX.test(raw);
  const line = logged ? raw.replace(LOG_PREFIX, "") : raw;
  return { line: line.length > 300 ? `${line.slice(0, 299)}…` : line, logged };
}

// The last line a CLI printed, for an error message.
const lastLine = (text) => readLastLine(text).line;

const withoutPeriod = (text) => text.replace(/\.$/, "");

function missingCliMessage(name) {
  return `Milagre couldn't find ${cliName(name)}. Install it with \`${INSTALL_COMMANDS[name]}\`, then send your message again.`;
}

function cliTooOldMessage(name, version, minimum) {
  return `Milagre needs ${cliName(name)} ${minimum} or later, and you have ${version}. Run \`${UPDATE_COMMANDS[name]}\` in a terminal, then send your message again.`;
}

function cliBrokenMessage(name, command, detail) {
  const reason = lastLine(detail);
  return `${cliName(name)} (${command}) didn't start${reason ? `: ${withoutPeriod(reason)}` : ""}. Check that it runs in a terminal, then send your message again.`;
}

function loginMessage(name) {
  return `${cliName(name)} isn't logged in. Run \`${LOGIN_COMMANDS[name]}\` in a terminal, then send your message again.`;
}

// The reason is the last line, with a log line's prefix dropped. A process the OS killed with nothing left to
// say gets its signal instead.
function crashMessage(name, detail, { signal } = {}) {
  const { line } = readLastLine(detail);
  const reason = signal && !line ? `${cliName(name)} exited with signal ${signal}` : line;
  return `${cliName(name)} stopped unexpectedly${reason ? `: ${withoutPeriod(reason)}` : ""}. Send your message again to continue this chat.`;
}

// Codex passes some API errors on as raw JSON: {"type":"error","status":400,"error":{"message":"…"}}.
function codexErrorText(error) {
  const message = error?.message || "Codex could not finish this turn.";
  try {
    return JSON.parse(message)?.error?.message || message;
  } catch {
    return message;
  }
}

// A turn failure made of one of Milagre's own messages; the renderer shows it without an "Agent error:" prefix.
const failedWith = (message, extra = {}) => ({ type: "turn-failed", message, notice: true, ...extra });

// A turn Codex couldn't authenticate: codexErrorInfo is "unauthorized", or an HTTP failure with status 401.
function codexUnauthorized(error) {
  const info = error?.codexErrorInfo;
  return info === "unauthorized" || (Boolean(info) && typeof info === "object" && Object.values(info).some((detail) => detail?.httpStatusCode === 401));
}


// The mapper's clock; tests set state.now.
const now = (state) => (state.now ?? Date.now)();

function textDelta(state, text) {
  state.hasText = true;
  return { type: "text-delta", messageId: state.turnId, text };
}

// Claude Agent SDK message -> events. Partial messages (includePartialMessages) carry the
// streamed text and thinking: a thinking block is a step from its start to its stop. Each assistant
// message holds a finished content block: a tool_use block starts a step, and the tool_result in a
// later user message ends it. Child messages go to the subagent track; only the Agent
// call that started them is a step in the parent reply.
function mapClaudeMessage(message, state) {
  const events = claudeSubagents(message, state);
  // Claude Code answers a turn it can't authenticate with a reply of its own ("Not logged in · Please run
  // /login") marked authentication_failed, then a failed result.
  if (message.type === "assistant" && message.error === "authentication_failed") state.authFailed = true;
  if (message.type === "system" && message.subtype === "init" && message.session_id && message.session_id !== state.sessionId) {
    state.sessionId = message.session_id;
    events.push({ type: "session-started", nativeId: message.session_id });
  }
  if (message.type === "stream_event" && message.parent_tool_use_id == null) {
    const event = message.event ?? {};
    if (event.type === "content_block_start" && event.content_block?.type === "text" && state.hasText) events.push(textDelta(state, "\n\n"));
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) events.push(textDelta(state, event.delta.text));
    if (event.type === "content_block_start" && (event.content_block?.type === "thinking" || event.content_block?.type === "redacted_thinking")) {
      // The thinking block streaming now; ids count up for the provider's life, so they stay unique in a reply.
      state.thinkingCount = (state.thinkingCount ?? 0) + 1;
      state.thinking = { id: `thinking-${state.thinkingCount}`, index: event.index, text: "", startedAt: now(state) };
      events.push({ type: "step-started", step: thinkingStep(state.thinking.id) });
    }
    const thinking = state.thinking;
    if (thinking && event.index === thinking.index && event.type === "content_block_delta" && event.delta?.type === "thinking_delta" && event.delta.thinking) {
      thinking.text += event.delta.thinking;
      events.push({ type: "step-output", id: thinking.id, text: event.delta.thinking });
    }
    if (thinking && event.index === thinking.index && event.type === "content_block_stop") {
      state.thinking = null;
      events.push({ type: "step-completed", ...thinkingEnd(thinking.id, now(state) - thinking.startedAt, thinking.text) });
    }
  }
  if (message.type === "assistant" && message.parent_tool_use_id == null) {
    for (const block of message.message?.content ?? []) {
      // The question card already shows AskUserQuestion, so it gets no row (and its result is ignored).
      if (block?.type !== "tool_use" || block.name === "AskUserQuestion") continue;
      // Tool calls waiting for their result, by tool_use id.
      state.tools ??= new Map();
      state.tools.set(block.id, block);
      events.push({ type: "step-started", step: claudeStep(block.id, block.name, block.input) });
      // The list lives for the provider session, so it carries across turns.
      state.tasks ??= new Map();
      const tasks = applyToolUse(state.tasks, block.name, block.input);
      if (tasks) events.push({ type: "tasks-updated", tasks });
    }
  }
  if (message.type === "user" && message.parent_tool_use_id == null && Array.isArray(message.message?.content)) {
    const results = message.message.content.filter((block) => block?.type === "tool_result");
    for (const block of results) {
      const call = state.tools?.get(block.tool_use_id);
      if (!call) continue;
      state.tools.delete(block.tool_use_id);
      // tool_use_result belongs to the message, so it can only be matched to a lone result.
      const structured = results.length === 1 ? message.tool_use_result : undefined;
      events.push({ type: "step-completed", ...claudeStepResult(call, block, structured) });
      state.tasks ??= new Map();
      const tasks = applyToolResult(state.tasks, call, block, structured);
      if (tasks) events.push({ type: "tasks-updated", tasks });
    }
  }
  if (message.type === "result") {
    if (message.subtype === "success" && !message.is_error) events.push({ type: "turn-completed" });
    else if (state.authFailed) events.push(failedWith(loginMessage("claude"), { login: true }));
    else events.push({ type: "turn-failed", message: (message.errors?.length ? message.errors.join("\n") : message.result) || "Claude could not finish this turn." });
    state.authFailed = false;
  }
  return events;
}

// codex app-server notification -> events. Everything not listed is ignored on purpose:
// the server also reports MCP startup, hooks, rate limits, token usage and the turn's running diff.
function mapCodexNotification(method, params, state) {
  const children = codexSubagents(method, params, state);
  if (children.length) return children;
  if (params.threadId && state.threadId && params.threadId !== state.threadId) return [];
  if (method === "turn/started") return [{ type: "turn-started", turnId: params.turn?.id ?? null }];
  if ((method === "item/started" || method === "item/completed") && params.item) {
    // An item from an earlier turn is not part of this reply.
    if (state.turnId && params.turnId && params.turnId !== state.turnId) return [];
    if (params.item.type === "reasoning") return codexReasoning(method, params.item, state);
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
  if (method === "item/reasoning/summaryTextDelta" && params.delta && state.steps?.has(String(params.itemId))) return [{ type: "step-output", id: String(params.itemId), text: params.delta }];
  // A new summary part is a new paragraph.
  if (method === "item/reasoning/summaryPartAdded" && params.summaryIndex > 0 && state.steps?.has(String(params.itemId))) return [{ type: "step-output", id: String(params.itemId), text: "\n\n" }];
  // The deltas are a preview: the first chunk can be missing, and item/completed carries the whole output.
  if (method === "item/commandExecution/outputDelta" && params.delta && state.steps?.has(String(params.itemId))) return [{ type: "step-output", id: String(params.itemId), text: params.delta }];
  if (method === "item/agentMessage/delta" && params.delta) {
    // Late text from an earlier turn is not part of this reply, and must not take over turnId.
    if (state.turnId && params.turnId && params.turnId !== state.turnId) return [];
    const events = [];
    state.turnId = params.turnId ?? state.turnId;
    if (state.hasText && state.lastItemId && params.itemId !== state.lastItemId) events.push(textDelta(state, "\n\n"));
    state.lastItemId = params.itemId;
    events.push(textDelta(state, params.delta));
    return events;
  }
  if (method === "turn/plan/updated") {
    if (state.turnId && params.turnId && params.turnId !== state.turnId) return [];
    const tasks = codexPlanTasks(params.plan);
    return tasks ? [{ type: "tasks-updated", tasks }] : [];
  }
  if (method === "turn/completed") {
    const turn = params.turn ?? {};
    // A late completion for an earlier turn must not end the one running now.
    if (state.turnId && turn.id && turn.id !== state.turnId) return [];
    if (turn.status === "interrupted") return [{ type: "turn-cancelled" }];
    // A 401 means "log in" only where OpenAI auth is required (state.requiresOpenaiAuth, from account/read); on an
    // API key or a custom provider it is that provider's own error.
    if (turn.status === "failed") return [codexUnauthorized(turn.error) && state.requiresOpenaiAuth === true ? failedWith(loginMessage("codex"), { login: true }) : { type: "turn-failed", message: codexErrorText(turn.error) }];
    return [{ type: "turn-completed" }];
  }
  return [];
}

// A reasoning item is a thinking step: its summary streams in, and item/completed carries all of it.
function codexReasoning(method, item, state) {
  const id = String(item.id);
  state.steps ??= new Set();
  state.thinkingStarts ??= new Map();
  if (method === "item/started") {
    if (state.steps.has(id)) return [];
    state.steps.add(id);
    state.thinkingStarts.set(id, now(state));
    return [{ type: "step-started", step: thinkingStep(id) }];
  }
  const started = state.steps.delete(id) ? [] : [{ type: "step-started", step: thinkingStep(id) }];
  const startedAt = state.thinkingStarts.get(id);
  state.thinkingStarts.delete(id);
  const summary = (item.summary ?? []).filter((part) => typeof part === "string" && part).join("\n\n");
  return [...started, { type: "step-completed", ...thinkingEnd(id, startedAt === undefined ? undefined : now(state) - startedAt, summary) }];
}

module.exports = { MILAGRE_INSTRUCTIONS, milagreInstructions, RESUME_FAILED_MESSAGE, cliBrokenMessage, failedWith, cliTooOldMessage, crashMessage, isTerminal, lastLine, loginMessage, mapClaudeMessage, mapCodexNotification, missingCliMessage };
