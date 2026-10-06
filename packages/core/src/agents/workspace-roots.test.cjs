const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { insideWorkspace } = require('./permissions.cjs');
const { codexPolicy } = require('./codex-provider.cjs');
const { SessionManager } = require('./session-manager.cjs');
const { ClaudeSession } = require('./claude-provider.cjs');
test('owned roots permit member paths but reject symlinks escaping to another repository', async t => {
  assert.equal(typeof insideWorkspace, 'function');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-roots-'))); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const member = path.join(root, 'member'), external = path.join(root, 'external');
  await fs.mkdir(member); await fs.mkdir(external); await fs.symlink(external, path.join(member, 'escape'));
  assert.equal(await insideWorkspace([member], [path.join(member, 'new.txt')]), true);
  assert.equal(await insideWorkspace([member], [path.join(member, 'escape', 'new.txt')]), false);
  assert.equal(await insideWorkspace([member], [path.join(external, 'new.txt')]), false);
});
test('Codex includes all owned Worktrees without widening to main checkouts', () => {
  assert.deepEqual(codexPolicy('auto', '/workspace', ['/work/api', '/work/web']).sandboxPolicy.writableRoots, ['/workspace', '/work/api', '/work/web']);
});
test('Claude receives additional directories and owned workspace instructions', async t => {
  let options;
  const session = new ClaudeSession({ cwd: '/workspace', workspaceRoots: ['/work/api', '/work/web'], workspaceInstructions: 'Owned: api and web', emit() {}, command: '/claude', loadSdk: async () => ({ query: input => { options = input.options; return { async *[Symbol.asyncIterator]() {}, close() {} }; } }) });
  t.after(() => session.close());
  await session.start('model', 'default');
  assert.deepEqual(options.additionalDirectories, ['/work/api', '/work/web']);
  assert.match(options.systemPrompt.append, /Owned: api and web/);
});
test('a provider session is replaced when its owned root set changes', async t => {
  const calls = [];
  const manager = new SessionManager({ createSession: (_provider, context) => { calls.push(context); return { startTurn() {}, close() {} }; }, send() {} });
  t.after(() => manager.closeAll());
  const request = { chatId: 'link#1', provider: 'codex', cwd: '/workspace', workspaceRoots: ['/work/api'], workspaceInstructions: 'Owned' };
  await manager.startTurn(request); await manager.startTurn(request);
  await manager.startTurn({ ...request, workspaceRoots: ['/work/api', '/work/web'] });
  assert.equal(calls.length, 2); assert.deepEqual(calls[1].workspaceRoots, ['/work/api', '/work/web']);
});
