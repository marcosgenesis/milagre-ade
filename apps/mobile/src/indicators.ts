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
