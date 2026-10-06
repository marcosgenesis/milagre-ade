const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRuntime } = require('./runtime.cjs');
const { scopeKey, chatKeyForScope } = require('@milagre/shared/chat-scopes');
async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-link-runtime-')));
  const events = [], created = [], runtimes = [];
  const options = { dataDir: path.join(dir, 'profile'), worktreeRoot: path.join(dir, 'worktrees'), registryRoots: [], version: 'test', environmentReady: Promise.resolve(), titleModels: {}, agentCli: async () => ({ command: '/fake' }), emit: (channel, payload) => events.push({ channel, payload }), createSession: (provider, context) => {
    created.push(context);
    return { turnActive: false, startTurn() { context.emit({ type: 'session-started', nativeId: 'native' }); context.emit({ type: 'turn-started', turnId: randomUUID() }); context.emit({ type: 'text-delta', messageId: 'reply', text: 'Changed both' }); context.emit({ type: 'turn-completed' }); return { turnId: 'turn' }; }, close() {}, interrupt() {} };
  } };
  t.after(async () => { for (const runtime of runtimes) await runtime.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const make = () => { const runtime = createRuntime(options); runtimes.push(runtime); return runtime; };
  const runtime = make();
  for (const name of ['api', 'web']) {
    const folder = path.join(dir, name); await fs.mkdir(folder);
    execFileSync('git', ['init', '-qb', 'main', folder]);
    execFileSync('git', ['-C', folder, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'Initial']);
    await runtime.openProject(folder);
  }
  const projects = await runtime.invoke('project:registry');
  return { dir, runtime, make, projects, events, created };
}
test('shared Chat keeps one canonical transcript and exact Worktrees across retries and restart', async t => {
  const { runtime, make, projects, events, created } = await fixture(t);
  assert.ok(runtime.methods.includes('link:create'));
  const link = await runtime.invoke('link:create', [{ name: 'Food', projectIds: projects.map(p => p.id) }]);
  const opened = await runtime.invoke('link:open', [link.id]);
  assert.deepEqual(opened.state.sessions, {});
  const request = { linkId: link.id, sessionId: null, operationId: randomUUID(), body: 'Edit both', provider: 'codex', model: 'test', permissionMode: 'auto' };
  const sent = await runtime.invoke('link:send', [request]);
  await runtime.flush();
  const state = (await runtime.invoke('link:snapshot', [link.id])).state;
  const session = state.sessions[sent.sessionId];
  assert.equal(session.worktrees.length, 2); assert.equal(created[0].workspaceRoots.length, 2);
  assert.equal(created[0].cwd, session.workspacePath);
  assert.equal(state.messages.filter(m => m.body === 'Changed both').length, 1);
  assert.deepEqual(await runtime.invoke('link:send', [request]), sent);
  await runtime.close();
  const next = make(); const reopened = await next.invoke('link:open', [link.id]);
  assert.deepEqual(reopened.state.sessions[sent.sessionId].worktrees, session.worktrees);
  const owner = scopeKey({ kind: 'link', linkId: link.id });
  await next.invoke('chat:patch', [owner, sent.sessionId, { title: 'Shared saved', archived: true }]);
  assert.equal((await next.invoke('link:snapshot', [link.id])).state.sessions[sent.sessionId].title, 'Shared saved');
  assert.ok(events.some(event => event.channel === 'link:state'));
  for (const project of projects) {
    const view = await next.openProject(project.path);
    const shared = Object.values(view.state.worktrees).find(w => w.sharedChat);
    assert.ok(shared); assert.equal(Object.values(view.state.sessions).some(s => s.worktree_id === shared.id), false);
  }
});
test('missing Project leaves shared history readable but blocks sends', async t => {
  const { runtime, projects } = await fixture(t);
  assert.ok(runtime.methods.includes('link:create'));
  const link = await runtime.invoke('link:create', [{ name: 'Food', projectIds: projects.map(p => p.id) }]);
  await runtime.invoke('link:open', [link.id]);
  await fs.rename(projects[0].path, projects[0].path + '-moved');
  try {
    assert.ok((await runtime.invoke('link:open', [link.id])).state);
    await assert.rejects(runtime.invoke('link:send', [{ linkId: link.id, operationId: randomUUID(), body: 'Edit' }]), /unavailable/);
  } finally { await fs.rename(projects[0].path + '-moved', projects[0].path); }
});


test('Git accepts a selected member and refuses the aggregate workspace; editor roots are explicitly validated', async t => {
  const { runtime, projects } = await fixture(t);
  const link = await runtime.invoke('link:create', [{ name: 'Food', projectIds: projects.map(p => p.id) }]);
  await runtime.invoke('link:open', [link.id]);
  const sent = await runtime.invoke('link:send', [{ linkId: link.id, operationId: randomUUID(), sessionId: null, body: 'Edit', provider: 'codex', model: 'test', permissionMode: 'auto' }]);
  const session = (await runtime.invoke('link:snapshot', [link.id])).state.sessions[sent.sessionId];
  await assert.rejects(runtime.invoke('git:changes', [{ cwd: session.workspacePath }]), /folder/);
  assert.ok((await runtime.invoke('git:changes', [{ cwd: session.worktrees[1].worktreePath }])).isRepo);
  assert.deepEqual(await runtime.invoke('link:workspace-roots', [session.workspacePath]), session.worktrees.map(member => member.worktreePath));
  await assert.rejects(runtime.invoke('link:workspace-roots', ['/']), /workspace/);
});
