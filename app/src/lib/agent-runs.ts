import type { AgentEvent, ChatMessage, CoordinatorState, ModelOption, ModelProvider } from "../model";

/** A turn streaming in a chat, keyed by chat key (see `chatKey`). */
export interface AgentRun {
  text: string;
  model: string;
}

export type AgentRuns = Record<string, AgentRun>;

/**
 * Names a chat for the agent host. Session ids are counters per project, so every project has
 * a chat 2; the key carries the project path so chats in different projects never share a session.
 */
export function chatKey(projectPath: string, sessionId: number): string {
  return `${projectPath}#${sessionId}`;
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
  return { ...runs, [chatId]: { text: "", model } };
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
    case "text-delta": {
      if (!run) return { state, runs, changed: false };
      return { state, runs: { ...runs, [chatId]: { ...run, text: run.text + event.text } }, changed: false };
    }
    case "turn-completed":
    case "turn-cancelled":
    case "turn-failed": {
      if (!run) return { state, runs, changed: false };
      const { [chatId]: _finished, ...remaining } = runs;
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

/** The model to use for a chat. A chat bound to a provider never runs another provider's model. */
export function modelForChat(selected: ModelOption, provider: ModelProvider | undefined, messages: ChatMessage[], catalog: ModelOption[]): ModelOption {
  if (!provider || selected.provider === provider) return selected;
  const lastUsed = [...messages].reverse().find((message) => catalog.some((option) => option.id === message.model && option.provider === provider));
  return catalog.find((option) => option.id === lastUsed?.model) ?? catalog.find((option) => option.provider === provider) ?? selected;
}
