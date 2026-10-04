import { Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { AgentSession } from '@milagre/shared/model';
import type { Client } from './client';
import type { MenuSection } from './ui';
import { archiveFromPhone, type ArchiveRequest } from './archive';

/** Desktop's ⋯ menu for a Chat, less what only makes sense at the Mac (Finder, editor, commit). */
export function chatMenu(chat: AgentSession, worktree?: { path?: string; name?: string }): MenuSection[] {
  return [
    { items: [{ id: 'copy-path', title: 'Copy path', systemImage: 'doc.on.doc', disabled: !worktree?.path }, { id: 'copy-branch', title: 'Copy branch name', systemImage: 'arrow.triangle.branch', disabled: !worktree?.name }] },
    { items: [{ id: 'rename', title: 'Rename chat', systemImage: 'pencil' }, chat.unread ? { id: 'read', title: 'Mark as read', systemImage: 'checkmark' } : { id: 'unread', title: 'Mark as unread', systemImage: 'circle' }] },
    { items: [chat.archived ? { id: 'archive', title: 'Restore', systemImage: 'tray.and.arrow.up' } : { id: 'archive', title: 'Archive', systemImage: 'archivebox', destructive: true }] },
  ];
}

/**
 * Runs a choice from `chatMenu` against the Chat's Project. Archive asks first, as desktop does, with what removing the
 * Chat's worktree would lose, and stops a running Chat. Returns what archiving did, so a screen showing the Chat can leave.
 */
export async function runChatAction({ action, chat, running, client, projectPath, state, refresh, expectActivity, notify }: {
  action: string; chat: AgentSession; running: boolean; client: Client; projectPath: string; state: ArchiveRequest['state'];
  refresh: () => Promise<unknown>; expectActivity: () => void; notify: (message: string) => void;
}) {
  if (action === 'archive' && !chat.archived) {
    return archiveFromPhone({ client, alert: (...args) => Alert.alert(...args), projectPath, state, chat, running, onConfirm: expectActivity, notify, refresh: async () => { await refresh(); } });
  }
  if (action === 'archive') await client.call('chat:patch', [projectPath, chat.id, { archived: false }]);
  if (action === 'read' || action === 'unread') await client.call('chat:patch', [projectPath, chat.id, { unread: action === 'unread' }]);
  const worktree = state.worktrees[chat.worktree_id];
  if (action === 'copy-path' && worktree) await Clipboard.setStringAsync(worktree.path);
  if (action === 'copy-branch' && worktree) await Clipboard.setStringAsync(worktree.name);
  if (action === 'rename') {
    const title = await new Promise<string | null>(resolve => Alert.prompt('Rename Chat', undefined, [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(null) }, { text: 'Save', onPress: (value?: string) => resolve(value ?? null) }], 'plain-text', chat.title || chat.generatedTitle || ''));
    if (!title?.trim()) return;
    await client.call('chat:patch', [projectPath, chat.id, { title: title.trim() }]);
  }
  await refresh();
}
