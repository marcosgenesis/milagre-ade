import type { AgentSession, ChatMessage, ModelOption, ModelProvider } from "../model";
import { modelForChat } from "./agent-runs.ts";
import { chatTitle } from "./chat-list.ts";

export const otherProvider = (provider: ModelProvider): ModelProvider => (provider === "codex" ? "claude" : "codex");
export const providerLabel = (provider: ModelProvider) => (provider === "codex" ? "Codex" : "Claude");

/** Why the handover row is disabled, or null. A running turn would leave work out of the brief. */
export function handoverBlocker({ running, cli }: { running: boolean; cli: string | null }): string | null {
  if (running) return "Stop the turn or wait for it to finish to hand over.";
  return cli;
}

/** The model a handover to `provider` runs on: the last one used on that provider in the project, else its first. Undefined when the catalog has none. */
export function handoverModel(selected: ModelOption, provider: ModelProvider, projectMessages: ChatMessage[], models: ModelOption[]): ModelOption | undefined {
  const model = modelForChat(selected, provider, projectMessages, models);
  return model.provider === provider ? model : undefined;
}

export type HandoverLinks = { to?: { id: number; title: string; provider: ModelProvider }; from?: { id: number; title: string }; pending: boolean };

/** The chats a chat was handed over to and from, by title; a link to a chat no longer in the project is dropped. */
export function handoverLinks(session: AgentSession | undefined, state: { sessions: Record<number, AgentSession>; messages: ChatMessage[] }): HandoverLinks {
  const links: HandoverLinks = { pending: Boolean(session?.handoverPending) };
  const titleOf = (other: AgentSession) => chatTitle(other, state.messages.filter((message) => message.session_id === other.id));
  const to = session?.handedOverTo != null ? state.sessions[session.handedOverTo] : undefined;
  const from = session?.handedOverFrom != null ? state.sessions[session.handedOverFrom] : undefined;
  if (to?.provider) links.to = { id: to.id, title: titleOf(to), provider: to.provider };
  if (from) links.from = { id: from.id, title: titleOf(from) };
  return links;
}

/** The id of the handover brief: the first user message of a chat that was handed over to, else undefined. */
export function handoverBriefId(messages: ChatMessage[], handedOverFrom: number | undefined): number | undefined {
  if (handedOverFrom == null) return undefined;
  return messages.find((message) => message.role === "user")?.id;
}
