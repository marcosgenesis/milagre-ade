import type { AgentRun } from '@milagre/shared/agent-runs';
import type { AgentSession, ChatMessage, Subagent } from '@milagre/shared/model';
export function chatIndicator(chat: AgentSession | undefined, run?: AgentRun, messages: ChatMessage[] = []) {
  if (run?.questions.length) return { label: 'Asking you', tone: 'attention' } as const;
  if (run?.approvals.length) return { label: 'Waiting for approval', tone: 'attention' } as const;
  if (run?.waitingForSubagents) return { label: 'Waiting for agents', tone: 'running' } as const;
  if (run) return { label: 'Running', tone: 'running' } as const;
  if (chat?.resumeTurn) return { label: 'Interrupted', tone: 'attention' } as const;
  if (messages.at(-1)?.outcome === 'failed') return { label: 'Failed', tone: 'error' } as const;
  if (chat?.unread) return { label: 'Unread', tone: 'unread' } as const;
  return { label: 'Ready', tone: 'idle' } as const;
}
export function agentCounts(agents: Subagent[]) {
  const visible = agents.filter(agent => !agent.archived);
  return { running: visible.filter(agent => ['running', 'initializing'].includes(agent.status)).length, waiting: visible.filter(agent => agent.status === 'waiting').length, failed: visible.filter(agent => agent.status === 'failed').length, total: visible.length };
}
/** Desktop's sidebar chat mark: one slot left of the title. Asks for you draw an icon; running spins; unread is a dot. */
export type ChatMark = 'question' | 'waiting' | 'interrupted' | 'running' | 'failed' | 'unread' | 'idle';
export function chatMark(chat: AgentSession | undefined, run?: AgentRun, messages: ChatMessage[] = []): ChatMark {
  if (run?.questions.length) return 'question';
  if (run?.approvals.length) return 'waiting';
  if (run) return 'running';
  if (chat?.resumeTurn) return 'interrupted';
  if (chat?.unread) return 'unread';
  if (messages.at(-1)?.outcome === 'failed') return 'failed';
  return 'idle';
}
export const MARK_LABEL: Record<ChatMark, string> = { question: 'Has a question', waiting: 'Needs approval', interrupted: 'Interrupted', running: 'Running', failed: 'Last turn failed', unread: 'Unread', idle: '' };
/** Newest activity first. Messages have increasing ids, so a Chat's last message orders it; an empty Chat sorts by its own id. */
export function chatRecency(chatId: number, messages: ChatMessage[]) {
  let last = 0;
  for (const message of messages) if (message.session_id === chatId && message.id > last) last = message.id;
  return last || chatId / 1e6;
}
