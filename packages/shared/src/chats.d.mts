import type { AgentSession, ChatMessage } from "./model.ts";

export function chatTitle(session: AgentSession, messages: ChatMessage[]): string;
export function isHandoverChat(session: AgentSession | undefined): boolean;
export function isListedChat(session: AgentSession | undefined, messageCount: number): boolean;
