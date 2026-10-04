import type { AgentSession, CoordinatorState } from '@milagre/shared/model';
import { archiveChat, archiveChoices, isMilagreWorktree, worktreeShared, type ArchiveMode, type ArchivePlan, type WorktreeStatus } from '@milagre/shared/archive';

/** What archiving needs from the connection to the Mac. */
export type ArchiveClient = {
  call<T>(method: string, args?: unknown[]): Promise<T>;
  snapshot(projectPath: string): Promise<{ project: { state: CoordinatorState } }>;
};
export type AlertButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
/** React Native's Alert.alert, passed in so the dialog can be tested. */
export type ShowAlert = (title: string, message: string | undefined, buttons: AlertButton[], options?: { cancelable?: boolean; onDismiss?: () => void }) => void;
export type ArchiveDialog = { title: string; message?: string; choices: { mode: ArchiveMode; text: string; style: 'default' | 'destructive' }[] };

// A worktree that can't be checked only hides the Chat, as on desktop.
const HIDE_ONLY: ArchivePlan = { milagreOwned: false, shared: false, status: null };
// What the bridge answers for a method its daemon doesn't list: a Mac older than this check.
const OLD_DAEMON = /not available from mobile/i;
const fromOldDaemon = (error: unknown) => OLD_DAEMON.test((error as Error)?.message ?? '');

/**
 * What the confirm step offers for one Chat, as desktop's menu works it out: whether Milagre made its worktree, whether
 * another Chat uses it, and what removing it would lose. `null` when the Mac's daemon has no such check yet, so the
 * phone archives as it did before: hide only.
 */
export async function checkArchive(client: ArchiveClient, state: CoordinatorState, sessionId: number): Promise<ArchivePlan | null> {
  const worktree = state.worktrees[state.sessions[sessionId]?.worktree_id ?? -1];
  let roots: unknown;
  try { roots = await client.call<string[]>('worktree:roots'); } catch (error) { return fromOldDaemon(error) ? null : HIDE_ONLY; }
  if (!isMilagreWorktree(worktree, Array.isArray(roots) ? roots : [])) return HIDE_ONLY;
  if (worktreeShared(state, sessionId)) return { milagreOwned: true, shared: true, status: null };
  try { return { milagreOwned: true, shared: false, status: await client.call<WorktreeStatus>('worktree:status', [worktree.path, worktree.base]) }; }
  catch (error) { return fromOldDaemon(error) ? null : HIDE_ONLY; }
}

/** The native confirm: desktop's choices for the plan, the danger one destructive, and what would be lost as the message. */
export function archiveDialog(plan: ArchivePlan | null, running: boolean): ArchiveDialog {
  const title = 'Archive this Chat?';
  if (!plan) return { title, choices: [{ mode: 'hide', text: running ? 'Stop and archive' : 'Archive', style: 'destructive' }] };
  const { choices, reason } = archiveChoices({ plan, running });
  return { title, ...(reason ? { message: reason } : {}), choices: choices.map(choice => ({ mode: choice.mode, text: choice.label, style: choice.tone === 'danger' ? 'destructive' : 'default' })) };
}

/** Shows the dialog; resolves to the chosen mode, or null for Cancel (or a dismissed alert on Android). */
export function confirmArchive(alert: ShowAlert, dialog: ArchiveDialog): Promise<ArchiveMode | null> {
  return new Promise(resolve => {
    alert(dialog.title, dialog.message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ...dialog.choices.map(choice => ({ text: choice.text, style: choice.style, onPress: () => resolve(choice.mode) })),
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

export type ArchiveRequest = {
  client: ArchiveClient;
  alert: ShowAlert;
  projectPath: string;
  state: CoordinatorState;
  chat: AgentSession;
  /** Whether a turn is running in the Chat: it is stopped first, and the choices say so. */
  running: boolean;
  /** Called once the Chat is confirmed, before anything changes (the Chat screen marks itself busy). */
  onConfirm?: () => void;
  notify: (message: string) => void;
  refresh: () => Promise<unknown>;
};

/**
 * Archive from the phone: check the worktree, confirm natively, then desktop's archive steps with the phone's means:
 * stop the turn, hide the Chat, remove the worktree when the choice asks (the daemon closes the agent and checks again),
 * bring the Chat back with a notice when it stays, and read the Project again. A removed worktree's Chats leave the
 * Project's state on the Mac, so the refresh drops them here too.
 */
export async function archiveFromPhone(request: ArchiveRequest): Promise<'cancelled' | 'hidden' | 'removed' | 'kept'> {
  const { client, projectPath, chat, running } = request;
  const plan = await checkArchive(client, request.state, chat.id);
  const mode = await confirmArchive(request.alert, archiveDialog(plan, running));
  if (!mode) return 'cancelled';
  request.onConfirm?.();
  const chatId = `${projectPath}#${chat.id}`;
  // Whether another Chat took up the worktree since the check is read from the Project as it is now.
  const latest = mode !== 'hide' && plan?.status ? (await client.snapshot(projectPath).catch(() => null))?.project.state ?? request.state : request.state;
  try {
    return await archiveChat({
      projectPath,
      chatId,
      getState: () => latest,
      currentProjectPath: () => projectPath,
      stop: () => (running ? client.call('agent:interrupt', [chatId]).catch(() => {}) : undefined),
      hide: () => client.call('chat:patch', [projectPath, chat.id, { archived: true, unread: false }]),
      restore: () => client.call('chat:patch', [projectPath, chat.id, { archived: false }]),
      remove: (worktree, options) => client.call('worktree:remove', [worktree.path, options]),
      // The refresh below brings the Project as the Mac has it now, without the removed worktree and its Chats.
      applyRemoval: () => {},
      refreshBranches: () => {},
      notify: request.notify,
    }, chat.id, mode, plan);
  } finally {
    await request.refresh().catch(() => {});
  }
}
