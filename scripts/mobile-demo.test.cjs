const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { startDemo } = require('./mobile-demo.cjs');

test('demo sends, approves, answers, stops and reconnects through the real HTTP/socket/core stack', async t => {
  const demo = await startDemo({ port: 0 });
  t.after(async () => { await demo.close(); await fs.rm(demo.root, { recursive: true, force: true }); });
  const { createClient } = await import('../apps/mobile/src/client.ts');
  let client = createClient(demo.url, demo.token);
  const project = await client.call('project:open', [demo.project]);
  const changes = await client.call('git:diff-files', [{ cwd: demo.project, mode: 'uncommitted' }]);
  assert.ok(changes.files.some(file => file.path === 'README.md'));
  const chat = Object.values(project.state.sessions)[0];
  const chatId = `${demo.project}#${chat.id}`;
  const send = body => client.call('chat:send', [{ projectPath: demo.project, sessionId: chat.id, body, provider: 'codex', model: 'demo', permissionMode: 'ask' }]);
  async function wait(predicate) {
    for (let i = 0; i < 150; i++) { const state = await client.snapshot(demo.project); if (predicate(state)) return state; await delay(20); }
    throw new Error('Timed out waiting for demo state');
  }
  await send('hello');
  await wait(state => state.project.state.messages.some(message => message.body.includes('reply made it back')));
  await send('approval');
  const approval = await wait(state => state.runs.runs[chatId]?.approvals.length);
  client = createClient(demo.url, demo.token); // New mobile connection sees the same pending turn.
  assert.equal((await client.snapshot(demo.project)).runs.runs[chatId].approvals.length, 1);
  assert.equal(await client.call('agent:respond-permission', [{ chatId, requestId: approval.runs.runs[chatId].approvals[0].requestId, decision: 'allow' }]), true);
  await wait(state => !state.runs.runs[chatId]);
  await send('question');
  const question = await wait(state => state.runs.runs[chatId]?.questions.length);
  assert.equal(await client.call('agent:answer-question', [{ chatId, requestId: question.runs.runs[chatId].questions[0].requestId, answers: { next: ['Read a Chat'] }, summary: 'Read a Chat' }]), true);
  await wait(state => !state.runs.runs[chatId]);
  await send('slow');
  await wait(state => !!state.runs.runs[chatId]);
  await client.call('agent:interrupt', [chatId]);
  const stopped = await wait(state => !state.runs.runs[chatId]);
  assert.equal(stopped.project.state.messages.at(-1).outcome, 'cancelled');
  await demo.close();
  await assert.rejects(fs.stat(`${demo.dataDir}/runtime.lock`), { code: 'ENOENT' });
});
