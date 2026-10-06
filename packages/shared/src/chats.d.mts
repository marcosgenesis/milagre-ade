import type { AgentSession, LinkChatSession, ChatMessage } from "./model.ts";

export function chatTitle(session: AgentSession | LinkChatSession, messages: ChatMessage[]): string;
export function isHandoverChat(session: AgentSession | LinkChatSession | undefined): boolean;
export function isListedChat(session: AgentSession | LinkChatSession | undefined, messageCount: number): boolean;
