import type { AgentSession, ChatMessage, ChatSummary } from "./model.ts";

/** A line the commit dialog saved in the chat, as opposed to an agent's reply. */
export function isGitNote(message: ChatMessage | undefined): boolean;
/** A line Milagre saved in the chat that isn't a reply: a commit dialog note, or a Link reaching the Chat. */
export function isNote(message: ChatMessage | undefined): boolean;
/** The summary of a Chat whose messages, in the Project's order, are `messages`. */
export function summarizeChat(messages: readonly ChatMessage[]): ChatSummary;
/** Whether two summaries say the same, so an unchanged Chat keeps its object. */
export function sameSummary(a: ChatSummary | undefined, b: ChatSummary | undefined): boolean;
/** The Chat's summary: the one the host keeps, else one made from its messages (an older host keeps none). */
export function chatSummary(session: Pick<AgentSession, "summary"> | undefined, messages?: readonly ChatMessage[]): ChatSummary;
