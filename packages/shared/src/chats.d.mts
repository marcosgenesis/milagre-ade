import type { AgentSession, LinkChatSession, ChatMessage, CoordinatorState, ImageAttachment, ModelProvider } from "./model.ts";

export function chatTitle(session: AgentSession | LinkChatSession, messages: ChatMessage[]): string;
export function isHandoverChat(session: AgentSession | LinkChatSession | undefined): boolean;
export function isListedChat(session: AgentSession | LinkChatSession | undefined, messageCount: number): boolean;

export function comparePins(a: Pick<AgentSession, "pinned" | "pin_order">, b: Pick<AgentSession, "pinned" | "pin_order">): number;
export function pinOrderAt(orders: number[], index: number): number;

export type PendingChat = { session: AgentSession; message: ChatMessage; startedAt: number; sortId: number; targetSessionId: number | null; acceptedSessionId?: number };
export function createPendingChat(input: { state: CoordinatorState; worktreeId: number; sessionId?: number | null; body: string; images?: ImageAttachment[]; files?: string[]; model: string; provider: ModelProvider }): PendingChat;
export function pendingChatSessionId(state: CoordinatorState, pending: PendingChat | null | undefined): number | null;
export function withPendingChat(state: CoordinatorState, pending: PendingChat | null | undefined): CoordinatorState;
