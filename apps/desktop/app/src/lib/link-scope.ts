import { scopeKey } from '@milagre/shared/chat-scopes';
import { chatTitle } from '@milagre/shared/chats';
import type { ChatScope, LinkState } from '@milagre/shared/model';
export function createScopeDrafts() {
  const saved = new Map<string, { text: string; sessionId: number | null }>();
  return { save: (scope: ChatScope, draft: { text: string; sessionId: number | null }) => saved.set(scopeKey(scope), draft), read: (scope: ChatScope) => saved.get(scopeKey(scope)) ?? { text: '', sessionId: null } };
}
export function linkChatRows(state: LinkState) {
  return Object.values(state.sessions).filter(session => !session.archived).map(session => ({ id: String(session.id), label: chatTitle(session, state.messages.filter(message => message.session_id === session.id)), unread: session.unread, worktreeCount: session.worktrees.length })).reverse();
}
export function memberWorktreeForAction(state: LinkState, sessionId: number, projectId: string) {
  const member = state.sessions[sessionId]?.worktrees.find(binding => binding.projectId === projectId);
  if (!member) throw new Error('Choose a member Project of this shared Chat');
  return member;
}
