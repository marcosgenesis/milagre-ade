import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentSession, CoordinatorState } from '@milagre/shared/model';
import type { ArchivePlan, WorktreeStatus } from '@milagre/shared/archive';
import { archiveDialog, archiveFromPhone, checkArchive, confirmArchive, type AlertButton, type ArchiveClient, type ShowAlert } from './archive.ts';

const clean: WorktreeStatus = { uncommitted: 0, unpushed: 0, branch: 'milagre/x-1', head: 'abc', removable: true };
const dirty: WorktreeStatus = { uncommitted: 2, unpushed: 1, branch: 'milagre/x-1', head: 'abc', removable: false };
const session = (id: number, worktree_id: number, extra: Partial<AgentSession> = {}) => ({ id, worktree_id, agent_name: 'x', status: 'Created', ...extra }) as AgentSession;
const state = (): CoordinatorState => ({
  next_id: 10,
  projects: {},
  worktrees: {
    1: { id: 1, project_id: 1, path: '/work/shop', name: 'main' },
    2: { id: 2, project_id: 1, path: '/wt/shop/x-1', name: 'milagre/x-1', base: 'main' },
  },
  sessions: { 1: session(1, 1), 2: session(2, 2) },
  connections: {}, events: [], messages: [], approvals: [], tasks: {}, artifacts: {}, outputs: [], conflicts: [],
}) as unknown as CoordinatorState;

const refusedByOldDaemon = () => Promise.reject(new Error('Command is not available from mobile'));

function fakeClient(answers: Record<string, (args: unknown[]) => unknown> = {}, current = state()) {
  const calls: { method: string; args: unknown[] }[] = [];
  const client: ArchiveClient = {
    async call<T>(method: string, args: unknown[] = []) {
      calls.push({ method, args });
      const answer = answers[method];
      if (answer) return await answer(args) as T;
      if (method === 'worktree:roots') return ['/wt'] as T;
      if (method === 'worktree:status') return clean as T;
      return null as T;
    },
    async snapshot() { calls.push({ method: 'snapshot', args: [] }); return { project: { state: current } }; },
  };
  return { client, calls };
}

// An alert that presses the button whose text matches `press` (or reports what it was shown).
function fakeAlert(press: string | null) {
  const shown: { title: string; message?: string; buttons: AlertButton[] }[] = [];
  const alert: ShowAlert = (title, message, buttons, options) => {
    shown.push({ title, message, buttons });
    if (press === null) options?.onDismiss?.();
    else buttons.find(button => button.text === press)?.onPress?.();
  };
  return { alert, shown };
}

test('the dialog shows the desktop choice for each plan, with Cancel, the danger one destructive', () => {
  const plan = (patch: Partial<ArchivePlan>): ArchivePlan => ({ milagreOwned: true, shared: false, status: clean, ...patch });
  assert.deepEqual(archiveDialog(plan({}), false), { title: 'Archive this Chat?', choices: [{ mode: 'remove', text: 'Archive and remove worktree', style: 'default' }] });
  assert.deepEqual(archiveDialog(plan({ status: dirty }), false), {
    title: 'Archive this Chat?',
    message: '2 uncommitted files and 1 unpushed commit will be lost. Commit and push them first to keep them.',
    choices: [{ mode: 'delete', text: 'Archive and delete worktree', style: 'destructive' }],
  });
  for (const patch of [{ milagreOwned: false, status: null }, { shared: true, status: null }, { status: null }]) {
    assert.deepEqual(archiveDialog(plan(patch), false).choices, [{ mode: 'hide', text: 'Confirm archive', style: 'destructive' }]);
  }
  // A running Chat is stopped first, and the choices say so.
  assert.equal(archiveDialog(plan({}), true).choices[0].text, 'Stop, archive and remove worktree');
  assert.equal(archiveDialog(plan({ status: dirty }), true).choices[0].text, 'Stop, archive and delete worktree');
  assert.equal(archiveDialog(plan({ shared: true, status: null }), true).choices[0].text, 'Stop and archive');
  // An older Mac: today's plain archive.
  assert.deepEqual(archiveDialog(null, false), { title: 'Archive this Chat?', choices: [{ mode: 'hide', text: 'Archive', style: 'destructive' }] });
});

test('confirmArchive puts Cancel first and resolves to the pressed choice, or null', async () => {
  const dialog = archiveDialog({ milagreOwned: true, shared: false, status: dirty }, false);
  const pressed = fakeAlert('Archive and delete worktree');
  assert.equal(await confirmArchive(pressed.alert, dialog), 'delete');
  assert.deepEqual(pressed.shown[0].buttons.map(button => [button.text, button.style]), [['Cancel', 'cancel'], ['Archive and delete worktree', 'destructive']]);
  assert.equal(pressed.shown[0].message, dialog.message);
  assert.equal(await confirmArchive(fakeAlert('Cancel').alert, dialog), null);
  assert.equal(await confirmArchive(fakeAlert(null).alert, dialog), null);
});

test('checkArchive works out the plan as desktop does', async () => {
  assert.deepEqual(await checkArchive(fakeClient().client, state(), 2), { milagreOwned: true, shared: false, status: clean });
  // The project's own checkout is not Milagre's, so nothing about it is checked.
  const main = fakeClient();
  assert.deepEqual(await checkArchive(main.client, state(), 1), { milagreOwned: false, shared: false, status: null });
  assert.equal(main.calls.some(call => call.method === 'worktree:status'), false);
  const shared = state();
  shared.sessions[3] = session(3, 2);
  assert.deepEqual(await checkArchive(fakeClient().client, shared, 2), { milagreOwned: true, shared: true, status: null });
  // A check that fails only hides.
  assert.deepEqual(await checkArchive(fakeClient({ 'worktree:status': () => Promise.reject(new Error('git hung')) }).client, state(), 2), { milagreOwned: false, shared: false, status: null });
});

test('an older daemon that refuses the check falls back to the plain hide-only archive, without an error', async () => {
  const { client, calls } = fakeClient({ 'worktree:roots': refusedByOldDaemon, 'worktree:status': refusedByOldDaemon });
  assert.equal(await checkArchive(client, state(), 2), null);
  calls.length = 0;
  const { alert, shown } = fakeAlert('Archive');
  const notices: string[] = [];
  const result = await archiveFromPhone({ client, alert, projectPath: '/work/shop', state: state(), chat: session(2, 2), running: false, notify: message => { notices.push(message); }, refresh: async () => {} });
  assert.equal(result, 'hidden');
  assert.deepEqual(shown[0].buttons.map(button => button.text), ['Cancel', 'Archive']);
  assert.equal(shown[0].message, undefined);
  assert.deepEqual(calls.map(call => call.method), ['worktree:roots', 'chat:patch']);
  assert.deepEqual(calls[1].args, ['/work/shop', 2, { archived: true, unread: false }]);
  assert.deepEqual(notices, []);
});

test('a running Chat is stopped, hidden, its worktree removed, then the Project is read again', async () => {
  const order: string[] = [];
  const { client, calls } = fakeClient({
    'agent:interrupt': () => { order.push('stop'); },
    'chat:patch': args => { order.push(`patch ${JSON.stringify((args as unknown[])[2])}`); },
    'worktree:remove': () => { order.push('remove'); return { removed: true }; },
  });
  const { alert } = fakeAlert('Stop, archive and remove worktree');
  let confirmed = false;
  const result = await archiveFromPhone({ client, alert, projectPath: '/work/shop', state: state(), chat: session(2, 2), running: true, onConfirm: () => { confirmed = true; }, notify: () => {}, refresh: async () => { order.push('refresh'); } });
  assert.equal(result, 'removed');
  assert.equal(confirmed, true);
  assert.deepEqual(order, ['stop', 'patch {"archived":true,"unread":false}', 'remove', 'refresh']);
  const removal = calls.find(call => call.method === 'worktree:remove')!;
  assert.deepEqual(removal.args, ['/wt/shop/x-1', { force: false, base: 'main', projectPath: '/work/shop', chatId: '/work/shop#2', seen: clean }]);
  assert.deepEqual(calls.find(call => call.method === 'agent:interrupt')!.args, ['/work/shop#2']);
});

test('a refused removal brings the Chat back with the desktop notice', async () => {
  const { client, calls } = fakeClient({
    'worktree:status': () => dirty,
    'worktree:remove': () => Promise.reject(new Error('WORKTREE_CHANGED: /wt/shop/x-1 changed after it was checked.')),
  });
  const notices: string[] = [];
  const result = await archiveFromPhone({ client, alert: fakeAlert('Archive and delete worktree').alert, projectPath: '/work/shop', state: state(), chat: session(2, 2), running: false, notify: message => { notices.push(message); }, refresh: async () => {} });
  assert.equal(result, 'kept');
  assert.deepEqual(notices, ['It changed after you checked, so the chat and its worktree stay.']);
  assert.deepEqual(calls.filter(call => call.method === 'chat:patch').map(call => call.args[2]), [{ archived: true, unread: false }, { archived: false }]);
  assert.equal((calls.find(call => call.method === 'worktree:remove')!.args[1] as { force: boolean }).force, true);
  assert.equal(calls.some(call => call.method === 'agent:interrupt'), false, 'an idle Chat has no turn to stop');
});

test('a worktree another Chat took up after the check is only hidden from', async () => {
  const now = state();
  now.sessions[3] = session(3, 2);
  const { client, calls } = fakeClient({}, now);
  const result = await archiveFromPhone({ client, alert: fakeAlert('Archive and remove worktree').alert, projectPath: '/work/shop', state: state(), chat: session(2, 2), running: false, notify: () => {}, refresh: async () => {} });
  assert.equal(result, 'hidden');
  assert.equal(calls.some(call => call.method === 'worktree:remove'), false);
});

test('Cancel changes nothing', async () => {
  const { client, calls } = fakeClient();
  let refreshed = false;
  const result = await archiveFromPhone({ client, alert: fakeAlert('Cancel').alert, projectPath: '/work/shop', state: state(), chat: session(2, 2), running: true, notify: () => {}, refresh: async () => { refreshed = true; } });
  assert.equal(result, 'cancelled');
  assert.deepEqual(calls.map(call => call.method), ['worktree:roots', 'worktree:status']);
  assert.equal(refreshed, false);
});
