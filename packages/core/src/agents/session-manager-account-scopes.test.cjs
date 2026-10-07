const assert = require('node:assert/strict');
const test = require('node:test');
const { SessionManager } = require('./session-manager.cjs');

test('changing accounts preserves an active child after the parent finishes, then resumes with the new account', async t => {
  const created = [];
  const manager = new SessionManager({
    send() {},
    createSession(provider, options) {
      const session = {
        options, closed: false, turnActive: false, nativeId: 'saved-parent-thread', turns: [],
        async startTurn(turn) { this.turns.push(turn); return { turnId: String(this.turns.length) }; },
        async close() { this.closed = true; },
      };
      created.push(session);
      return session;
    },
  });
  t.after(() => manager.closeAll());
  const first = { chatId: '/project#1', provider: 'codex', cwd: '/project', model: 'test', prompt: 'Continue', command: '/fake', accountId: 'personal', env: { CODEX_HOME: '/personal' } };
  await manager.startTurn(first);
  created[0].options.emit({ type: 'subagent-update', agent: { id: 'child', status: 'running' } });
  created[0].options.emit({ type: 'turn-completed' });
  const changed = { ...first, accountId: 'work', env: { CODEX_HOME: '/work' } };
  await manager.startTurn(changed);
  assert.equal(created.length, 1);
  assert.equal(created[0].closed, false);
  assert.equal(created[0].options.env.CODEX_HOME, '/personal');
  created[0].options.emit({ type: 'subagent-update', agent: { id: 'child', status: 'completed' } });
  await manager.startTurn(changed);
  assert.equal(created.length, 2);
  assert.equal(created[0].closed, true);
  assert.equal(created[1].options.resumeId, 'saved-parent-thread');
  assert.equal(created[1].options.env.CODEX_HOME, '/work');
});
