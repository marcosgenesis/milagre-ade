// Normalised events every agent session emits. The main process forwards them to the
// renderer as { chatId, event }, where chatId is the chat key `${projectPath}#${sessionId}`:
//   { type: "session-started", nativeId }   provider session or thread id; the chat saves it
//   { type: "session-reset" }               the saved id can't be resumed; the chat forgets it
//   { type: "turn-started", turnId }        first event of every turn that starts, including turns the renderer
//                                           didn't start (a steering message that arrived as the last turn ended);
//                                           a turn that fails before starting ends with a terminal event and no turn-started
//   { type: "text-delta", messageId, text } reply text as it streams; messageId is the turn id
//   { type: "step-started", step }          a tool call began: step = { id, kind, title, detail? } (see steps.cjs)
//   { type: "step-output", id, text }       command output as it streams (Codex only), appended to the step
//   { type: "step-completed", id, status, title?, detail? }
//                                           the tool call ended; detail replaces anything streamed. A step still
//                                           running when its turn ends gets no step-completed
//   { type: "permission-request", ...request } and { type: "permission-resolved", requestId, decision }
//                                           an approval the turn waits on (see permissions.cjs)
//   { type: "question-request", ...request } and { type: "question-resolved", requestId, outcome }
//                                           questions the turn waits on (see questions.cjs)
//   { type: "turn-completed" } | { type: "turn-cancelled" } | { type: "turn-failed", message }
// Exactly one of the last three ends every turn.

const { claudeStep, claudeStepResult, codexStep, codexStepResult } = require("./steps.cjs");

const MILAGRE_INSTRUCTIONS = "You are an agent inside Milagre, an agent development environment. Answer the user concisely and humanly. Do not claim to have changed files unless you actually did. When you need the user to choose between options, ask with your question tool if you have one (AskUserQuestion or request_user_input); otherwise ask in your reply as a short numbered list.";
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
// streamed text. Each assistant message holds a finished content block: a tool_use block starts a
// step, and the tool_result in a later user message ends it. Subagent messages (parent_tool_use_id
// set) are not part of the reply: the Agent call that started them is the step.
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
  if (message.type === "result") {
    if (message.subtype === "success" && !message.is_error) events.push({ type: "turn-completed" });
    else events.push({ type: "turn-failed", message: (message.errors?.length ? message.errors.join("\n") : message.result) || "Claude could not finish this turn." });
  }
  return events;
}

// codex app-server notification -> events. Everything not listed is ignored on purpose:
// the server also reports MCP startup, hooks, rate limits, token usage and the turn's running diff.
function mapCodexNotification(method, params, state) {
  if (params.threadId && state.threadId && params.threadId !== state.threadId) return [];
  if (method === "turn/started") return [{ type: "turn-started", turnId: params.turn?.id ?? null }];
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
  if (method === "turn/completed") {
    const turn = params.turn ?? {};
    // A late completion for an earlier turn must not end the one running now.
    if (state.turnId && turn.id && turn.id !== state.turnId) return [];
    if (turn.status === "interrupted") return [{ type: "turn-cancelled" }];
    if (turn.status === "failed") return [{ type: "turn-failed", message: turn.error?.message || "Codex could not finish this turn." }];
    return [{ type: "turn-completed" }];
  }
  return [];
}

module.exports = { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, isTerminal, mapClaudeMessage, mapCodexNotification, missingCliMessage };
