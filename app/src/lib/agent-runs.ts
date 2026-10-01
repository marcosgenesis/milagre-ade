import type { AgentEvent, ChatMessage, CoordinatorState, ModelOption, ModelProvider, PermissionDecision, PermissionRequest } from "../model";

/** A turn streaming in a chat, keyed by chat key (see `chatKey`). */
export interface AgentRun {
  text: string;
  model: string;
  /** Approval requests the turn waits on, oldest first. */
  approvals: PermissionRequest[];
  /** The answer sent for each approval request (by request id) until the agent takes it. */
  answered: Record<string, PermissionDecision>;
  /** A steering message split the reply, so a turn that ends with no more text saves nothing more. */
  split?: boolean;
}

export type AgentRuns = Record<string, AgentRun>;

/**
 * Names a chat for the agent host. Session ids are counters per project, so every project has
 * a chat 2; the key carries the project path so chats in different projects never share a session.
 */
export function chatKey(projectPath: string, sessionId: number): string {
  return `${projectPath}#${sessionId}`;
}

/** Session ids of the project's chats that wait on at least one approval, so the sidebar can mark them. */
export function chatsWaitingForApproval(runs: AgentRuns, projectPath: string): Set<number> {
  const waiting = new Set<number>();
  for (const [key, run] of Object.entries(runs)) {
    if (run.approvals.length > 0 && chatInProject(projectPath, key)) waiting.add(sessionIdFromKey(key));
  }
  return waiting;
}

/** The session id at the end of a chat key (after the last `#`), or NaN. */
export function sessionIdFromKey(key: string): number {
  const match = /#(\d+)$/.exec(key);
  return match ? Number(match[1]) : Number.NaN;
}

/** Whether a chat key names a chat of the project at `projectPath`, and not of a path that merely starts with it. */
export function chatInProject(projectPath: string, key: string): boolean {
  return key === chatKey(projectPath, sessionIdFromKey(key));
}

export function startRun(runs: AgentRuns, chatId: string, model: string): AgentRuns {
  return { ...runs, [chatId]: { text: "", model, approvals: [], answered: {} } };
}

/** Records the answer the user sent for a chat's approval request. Kept on the run, so another chat's request with the same id is untouched. */
export function markAnswered(runs: AgentRuns, chatId: string, requestId: string, decision: PermissionDecision): AgentRuns {
  const run = runs[chatId];
  if (!run) return runs;
  return { ...runs, [chatId]: { ...run, answered: { ...run.answered, [requestId]: decision } } };
}

/** Forgets an answer, so the card is pending again (the answer didn't reach the agent). */
export function clearAnswered(runs: AgentRuns, chatId: string, requestId: string): AgentRuns {
  const run = runs[chatId];
  if (!run || !(requestId in run.answered)) return runs;
  const { [requestId]: _forgotten, ...answered } = run.answered;
  return { ...runs, [chatId]: { ...run, answered } };
}

/**
 * Folds one agent event into the saved state (the project at `projectPath`) and the in-memory
 * runs. `changed` is true when `state` changed and must be saved; streamed text only lives in
 * `runs` until the turn ends. Events for another project's chats, or for a session this state
 * doesn't have, change nothing.
 */
export function applyAgentEvent(state: CoordinatorState, runs: AgentRuns, projectPath: string, chatId: string, event: AgentEvent): { state: CoordinatorState; runs: AgentRuns; changed: boolean } {
  const sessionId = sessionIdFromKey(chatId);
  const session = state.sessions[sessionId];
  if (!chatInProject(projectPath, chatId) || !session) return { state, runs, changed: false };
  const run = runs[chatId];
  switch (event.type) {
    case "session-started": {
      if (session.native_session_id === event.nativeId) return { state, runs, changed: false };
      return { state: { ...state, sessions: { ...state.sessions, [sessionId]: { ...session, native_session_id: event.nativeId } } }, runs, changed: true };
    }
    case "session-reset": {
      if (!session.native_session_id) return { state, runs, changed: false };
      const { native_session_id: _forgotten, ...rest } = session;
      return { state: { ...state, sessions: { ...state.sessions, [sessionId]: rest } }, runs, changed: true };
    }
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
      const { [event.requestId]: _answered, ...answered } = run.answered;
      if (approvals.length === run.approvals.length && !(event.requestId in run.answered)) return { state, runs, changed: false };
      return { state, runs: { ...runs, [chatId]: { ...run, approvals, answered } }, changed: false };
    }
    case "text-delta": {
      if (!run) return { state, runs, changed: false };
      return { state, runs: { ...runs, [chatId]: { ...run, text: run.text + event.text } }, changed: false };
    }
    case "turn-completed":
    case "turn-cancelled":
    case "turn-failed": {
      if (!run) return { state, runs, changed: false };
      const { [chatId]: _finished, ...remaining } = runs;
      // The reply so far was saved when a steering message split it; there is nothing left to say.
      if (event.type === "turn-completed" && run.split && !run.text.trim()) return { state, runs: remaining, changed: false };
      const message: ChatMessage = {
        id: state.next_id,
        session_id: sessionId,
        body: replyBody(run.text, event),
        context: null,
        role: "assistant",
        model: run.model,
        outcome: event.type === "turn-completed" ? "completed" : event.type === "turn-cancelled" ? "cancelled" : "failed",
      };
      return { state: { ...state, next_id: state.next_id + 1, messages: [...state.messages, message] }, runs: remaining, changed: true };
    }
    // Event types added by later steps are not turn endings.
    default:
      return { state, runs, changed: false };
  }
}

function replyBody(text: string, event: AgentEvent) {
  const reply = text.trim();
  if (event.type === "turn-failed") return reply ? `${reply}\n\nAgent error: ${event.message}` : `Agent error: ${event.message}`;
  if (event.type === "turn-cancelled") return reply ? `${reply}\n\nAgent run cancelled.` : "Agent run cancelled.";
  return reply || "The agent finished without a reply.";
}

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
    runs: { ...runs, [chatId]: { ...run, text: "", split: true } },
    changed: true,
  };
}

/** The model to use for a chat. A chat bound to a provider never runs another provider's model. */
export function modelForChat(selected: ModelOption, provider: ModelProvider | undefined, messages: ChatMessage[], catalog: ModelOption[]): ModelOption {
  if (!provider || selected.provider === provider) return selected;
  const lastUsed = [...messages].reverse().find((message) => catalog.some((option) => option.id === message.model && option.provider === provider));
  return catalog.find((option) => option.id === lastUsed?.model) ?? catalog.find((option) => option.provider === provider) ?? selected;
}
