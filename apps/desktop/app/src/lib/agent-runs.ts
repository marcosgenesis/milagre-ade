import { subagentActive } from "./subagents.ts";
import type { ChatMessage, CoordinatorState, ModelOption, ModelProvider, PermissionDecision } from "../model";
import { chatInProject, sessionIdFromKey } from "@milagre/shared/agent-runs";
import { computerOfKey } from "@milagre/shared/chat-scopes";
import type { AgentRun, AgentRuns, SentAnswer } from "@milagre/shared/agent-runs";

export type { AgentRun, AgentRuns, SentAnswer } from "@milagre/shared/agent-runs";
export { applyRunEvent, chatInProject, chatKey, lastUserModel, projectOfKey, sessionIdFromKey } from "@milagre/shared/agent-runs";

/** Session ids of the project's chats that wait on at least one approval or question, so the sidebar can mark them. */
export function chatsWaitingForUser(runs: AgentRuns, projectPath: string): Set<number> {
  const waiting = new Set<number>();
  for (const [key, run] of Object.entries(runs)) {
    if ((run.approvals.length > 0 || run.questions.length > 0) && chatInProject(projectPath, key)) waiting.add(sessionIdFromKey(key));
  }
  return waiting;
}

/** Session ids of the project's chats whose next card is a question (approvals show first), so the sidebar can mark them apart. */
export function chatsAskingUser(runs: AgentRuns, projectPath: string): Set<number> {
  const asking = new Set<number>();
  for (const [key, run] of Object.entries(runs)) {
    if (run.approvals.length === 0 && run.questions.length > 0 && chatInProject(projectPath, key)) asking.add(sessionIdFromKey(key));
  }
  return asking;
}

/**
 * Session ids of the project's chats with a turn running, so the sidebar can mark them. Subagents
 * can outlive the turn that started them, so a chat with one still active counts too.
 */
export function chatsRunning(runs: AgentRuns, projectPath: string, sessions: CoordinatorState["sessions"] = {}): Set<number> {
  const running = new Set(
    Object.keys(runs)
      .filter((key) => chatInProject(projectPath, key))
      .map(sessionIdFromKey),
  );
  for (const session of Object.values(sessions)) if (session.subagents?.some(subagentActive)) running.add(session.id);
  return running;
}

/** Records what the user sent for a chat's approval or question. Kept on the run, so another chat's request with the same id is untouched. */
export function markAnswered(runs: AgentRuns, chatId: string, requestId: string, decision: SentAnswer): AgentRuns {
  const run = runs[chatId];
  if (!run) return runs;
  return { ...runs, [chatId]: { ...run, answered: { ...run.answered, [requestId]: decision } } };
}

/** The decision sent for an approval, while the agent takes it. */
export function sentDecision(run: AgentRun | undefined, requestId: string): PermissionDecision | null {
  const sent = run?.answered[requestId];
  return sent === "allow" || sent === "allow-for-chat" || sent === "deny" ? sent : null;
}

/** Whether a question's answers were sent or it was dismissed, while the agent takes it. */
export function sentReply(run: AgentRun | undefined, requestId: string): "answered" | "dismissed" | null {
  const sent = run?.answered[requestId];
  return sent === "answered" || sent === "dismissed" ? sent : null;
}

/** Forgets an answer, so the card is pending again (the answer didn't reach the agent). */
export function clearAnswered(runs: AgentRuns, chatId: string, requestId: string): AgentRuns {
  const run = runs[chatId];
  if (!run || !(requestId in run.answered)) return runs;
  const { [requestId]: _forgotten, ...answered } = run.answered;
  return { ...runs, [chatId]: { ...run, answered } };
}

/** The model to use for a chat. A chat bound to a provider never runs another provider's model. */
export function modelForChat(selected: ModelOption, provider: ModelProvider | undefined, messages: ChatMessage[], catalog: ModelOption[]): ModelOption {
  if (!provider || selected.provider === provider) return selected;
  const lastUsed = [...messages].reverse().find((message) => catalog.some((option) => option.id === message.model && option.provider === provider));
  return catalog.find((option) => option.id === lastUsed?.model) ?? catalog.find((option) => option.provider === provider) ?? selected;
}

/** `record` (keyed by chat key) with one computer's entries replaced by `next`, a snapshot from it; the others stay. */
export function replaceComputerEntries<T>(record: Record<string, T>, computerId: string, next: Record<string, T>): Record<string, T> {
  const kept = Object.entries(record).filter(([key]) => computerOfKey(key) !== computerId);
  const taken = Object.entries(next ?? {}).filter(([key]) => computerOfKey(key) === computerId);
  return Object.fromEntries([...kept, ...taken]);
}
/** `runs` without a computer's turns: it was removed, or Other computers was turned off. */
export const dropComputerRuns = (runs: AgentRuns, computerId: string) => replaceComputerEntries(runs, computerId, {});

/** Whether an agent event is newer than what its computer's snapshot holds (`taken` is the snapshot's last number per computer). */
export const eventIsNew = (taken: ReadonlyMap<string, number>, chatId: string, seq: number | undefined) =>
  seq === undefined || seq > (taken.get(computerOfKey(chatId)) ?? 0);
