const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createProjectRegistry } = require('./project-registry.cjs');
const { resolveProject } = require('./project-identity.cjs');
const { reconcileState } = require('./project-state.cjs');
let createLinkStore, createLinkWorkspaces;
try { ({ createLinkStore } = require('./link-store.cjs')); ({ createLinkWorkspaces } = require('./link-workspaces.cjs')); } catch {}

async function fixture(t, options = {}) {
  assert.equal(typeof createLinkStore, 'function');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-owned-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = createProjectRegistry(path.join(root, 'registry.json'), { roots: [] });
  for (const name of ['api', 'web']) {
    const folder = path.join(root, name);
    await fs.mkdir(folder); await fs.writeFile(path.join(folder, 'hello.txt'), name);
    const git = (...args) => execFileSync('git', ['-C', folder, ...args], { stdio: 'ignore' });
    git('init', '-qb', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com'); git('add', '.'); git('commit', '-qm', 'Initial');
    await registry.add(await resolveProject(folder));
  }
  const projects = await registry.list();
  const link = await registry.createProjectGroup({ name: 'Food', projectIds: projects.map(p => p.id) });
  const dataDir = path.join(root, 'profile');
  const store = createLinkStore({ dataDir }); t.after(() => store.close());
  const owned = [];
  const workspaces = createLinkWorkspaces({ store, registry, root: path.join(root, 'worktrees'), ownProject: async p => owned.push(p), ...options });
  return { root, projects, link, store, dataDir, owned, workspaces, registry };
}
test('retrying a prepared Chat reuses its exact Worktrees; a new Chat owns another set', async t => {
  const { link, store, dataDir, workspaces, owned } = await fixture(t);
  const request = { link, chatId: 1, prompt: 'change both', operationId: randomUUID() };
  const first = await workspaces.prepareLinkChat(request);
  const again = await workspaces.prepareLinkChat(request);
  assert.deepEqual(again, first); assert.equal(first.worktrees.length, 2);
  assert.equal(owned.length, 2);
  for (const member of first.worktrees) assert.equal(await fs.realpath(path.join(first.workspacePath, member.alias)), member.worktreePath);
  const second = await workspaces.prepareLinkChat({ ...request, chatId: 2, operationId: randomUUID() });
  assert.notEqual(first.worktrees[0].worktreePath, second.worktrees[0].worktreePath);
  const saved = await store.get(link.id);
  await store.close();
  const reopened = createLinkStore({ dataDir }); t.after(() => reopened.close());
  assert.deepEqual(await reopened.get(link.id), saved);
  assert.equal((await reopened.ownedWorktrees()).size, 4);
});
test('failed setup retains changed Worktrees and names the failed Project', async t => {
  const { root, link, store, workspaces } = await fixture(t, { getSettings: async () => ({ setupCommand: 'setup' }), runSetup: async ({ cwd }) => { await fs.writeFile(path.join(cwd, 'changed.txt'), 'retain'); return { status: 'failed', output: 'setup broke' }; } });
  const operationId = randomUUID();
  await assert.rejects(workspaces.prepareLinkChat({ link, chatId: 1, prompt: '', operationId }), /api|web/);
  const prep = (await store.get(link.id)).preparations[operationId];
  assert.equal(prep.status, 'failed'); assert.equal(prep.retainedPaths.length, 1);
  assert.equal(await fs.readFile(path.join(prep.retainedPaths[0], 'changed.txt'), 'utf8'), 'retain');
  assert.ok(prep.retainedPaths[0].startsWith(root));
});
test('failure to create the second member rolls back only untouched created roots', async t => {
  let calls = 0;
  const { createWorktree } = require('./worktrees.cjs');
  const { link, store, workspaces } = await fixture(t, { createWorktree: async args => { if (++calls === 2) throw new Error('second creation failed'); return createWorktree(args); } });
  const operationId = randomUUID();
  await assert.rejects(workspaces.prepareLinkChat({ link, chatId: 1, prompt: '', operationId }), /second creation failed/);
  const prep = (await store.get(link.id)).preparations[operationId];
  assert.deepEqual(prep.retainedPaths, []);
  await assert.rejects(fs.stat(prep.members[0].worktreePath), { code: 'ENOENT' });
});
test('crash recovery verifies a created member before continuing the remaining set', async t => {
  // oxlint-disable-next-line no-unused-vars -- pre-existing, see PR body
  const { link, store, registry, workspaces } = await fixture(t);
  // Interrupt after the first creation record is durably saved, rather than deleting it.
  const request = { link, chatId: 1, prompt: '', operationId: randomUUID() };
  const prepared = await workspaces.prepareLinkChat(request);
  await store.update(link.id, state => { const prep = state.preparations[request.operationId]; return { ...state, preparations: { ...state.preparations, [request.operationId]: { ...prep, status: 'creating' } } }; });
  await store.flush(link.id);
  const recovered = await workspaces.prepareLinkChat(request);
  assert.deepEqual(recovered, prepared);
});
test('Project reconciliation references a shared Chat without a local starter', () => {
  const owned = new Map([['/work/api', { linkId: randomUUID(), sessionId: 4 }]]);
  const state = reconcileState(null, 'api', [{ path: '/work/api', name: 'shared' }], owned);
  assert.deepEqual(Object.values(state.worktrees)[0].sharedChat, owned.get('/work/api'));
  assert.deepEqual(state.sessions, {});
});
test('recovery retains an interrupted setup even when its changed files are ignored', async t => {
  const { link, store, workspaces } = await fixture(t);
  const request = { link, chatId: 1, prompt: 'recover', operationId: randomUUID() };
  const prepared = await workspaces.prepareLinkChat(request);
  const member = prepared.worktrees[0];
  await fs.writeFile(path.join(member.projectPath, '.git', 'info', 'exclude'), '.env\n');
  await fs.writeFile(path.join(member.worktreePath, '.env'), 'keep this setup output');
  await store.update(link.id, state => { const prep = state.preparations[request.operationId]; return { ...state, preparations: { ...state.preparations, [request.operationId]: { ...prep, status: 'setup', members: prep.members.map((member, index) => index === 0 ? { ...member, setupCommand: 'setup', setupStarted: true, setupDone: false } : member) } } }; });
  await store.flush(link.id);
  await assert.rejects(workspaces.recoverLinkPreparations(link.id), /interrupted/);
  const failed = (await store.get(link.id)).preparations[request.operationId];
  assert.ok(failed.retainedPaths.includes(member.worktreePath));
  assert.equal(await fs.readFile(path.join(member.worktreePath, '.env'), 'utf8'), 'keep this setup output');
});
