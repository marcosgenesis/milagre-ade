import type { AgentSession, Subagent, SubagentTranscriptEntry } from "./model.ts";

export const TRANSCRIPT_TAIL: number;
export const TRANSCRIPT_LIMIT: number;
/** `agent` with only the last entries of its transcript; the same object for the same agent. */
export function withTranscriptTail<T extends Subagent>(agent: T): T;
/** `session` with each subagent's transcript cut to its tail; the same object for the same session. */
export function sessionWithTranscriptTails<T extends Pick<AgentSession, "subagents">>(session: T): T;
/** Whether `agent` carries only the tail of its transcript. */
export function hasTranscriptTail(agent: Pick<Subagent, "transcriptLength"> | undefined): boolean;
/** The whole transcript `held` brought up to date with `agent`'s; null when it must be read again. */
export function mergeTranscript(held: readonly SubagentTranscriptEntry[], agent: Subagent): SubagentTranscriptEntry[] | null;
