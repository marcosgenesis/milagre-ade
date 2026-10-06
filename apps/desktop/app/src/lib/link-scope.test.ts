import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const lib = await import('./link-scope.ts').catch(() => null);
test('Link drafts have their own scope and remember a Chat independently', () => {
  assert.ok(lib);
  const drafts = lib.createScopeDrafts();
  const project = { kind: 'project' as const, projectPath: '/api' };
  const link = { kind: 'link' as const, linkId: randomUUID() };
  drafts.save(project, { text: 'Project', sessionId: 2 }); drafts.save(link, { text: 'Both', sessionId: 4 });
  assert.deepEqual(drafts.read(project), { text: 'Project', sessionId: 2 });
  assert.deepEqual(drafts.read(link), { text: 'Both', sessionId: 4 });
});
test('Git member choice resolves stable Project IDs and rejects unrelated members', () => {
  assert.ok(lib);
  const state = { next_id: 2, preparations: {}, messages: [], sessions: { 1: { id: 1, agent_name: 'Link', status: 'Created' as const, workspacePath: '/workspace', worktrees: [{ projectId: 'api', projectPath: '/api', worktreePath: '/work/api', branch: 'feature', base: 'main' }, { projectId: 'web', projectPath: '/web', worktreePath: '/work/web', branch: 'feature', base: 'main' }] } } };
  assert.equal(lib.memberWorktreeForAction(state, 1, 'web').worktreePath, '/work/web');
  assert.throws(() => lib.memberWorktreeForAction(state, 1, 'other'), /member/);
  assert.equal(lib.linkChatRows(state)[0].worktreeCount, 2);
});
