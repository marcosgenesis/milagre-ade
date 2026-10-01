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
