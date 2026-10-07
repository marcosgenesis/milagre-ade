import type { ChatMessage, HandoffContext, ModelProvider, TranscriptState } from "./model.ts";

type HandoffState = Pick<TranscriptState, "sessions" | "messages">;

export function isHandoff(message: ChatMessage | undefined): message is ChatMessage & { context: HandoffContext };
export function lastTurnProvider(state: HandoffState, sessionId: number): ModelProvider | undefined;
export function catchUpStart(state: HandoffState, sessionId: number, provider: ModelProvider): number | null;
export function handoffKind(state: HandoffState, sessionId: number, provider: ModelProvider): "switch" | "restore" | null;
