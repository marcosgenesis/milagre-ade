const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRuntime } = require('./runtime.cjs');

async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-core-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, 'project');
  await fs.mkdir(project);
  execFileSync('git', ['init', '-b', 'main', project], { stdio: 'ignore' });
  const dataDir = path.join(dir, 'profile');
  const events = [];
  const options = { dataDir, cwd: project, version: '9.8.7', environmentReady: Promise.resolve(), emit: (channel, payload) => events.push({ channel, payload }) };
  return { project, dataDir, events, options };
}

test('Node runtime preserves stored Chats and provider IDs across a restart', async t => {
  const { project, options, events } = await fixture(t);
  const first = createRuntime(options);
  t.after(() => first.close());
  const opened = await first.invoke('project:current');
  const session = Object.values(opened.state.sessions)[0];
  assert.ok(session);
  await first.invoke('chat:patch', [project, session.id, { title: 'Saved Chat', pinned: true }]);
  const file = path.join(project, '.milagre/coordination.json');
  await first.close();
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  saved.sessions[session.id].native_session_id = 'existing-provider-id';
  saved.sessions[session.id].handoverDraft = '# Existing handover';
  saved.messages = [{ id: saved.next_id++, session_id: session.id, role: 'user', body: 'Existing transcript', context: null }];
  await fs.writeFile(file, JSON.stringify(saved));
  const second = createRuntime(options);
  t.after(() => second.close());
  const reopened = await second.invoke('project:current');
  assert.equal(reopened.state.sessions[session.id].native_session_id, 'existing-provider-id');
  assert.equal(reopened.state.sessions[session.id].title, 'Saved Chat');
  assert.equal(reopened.state.sessions[session.id].handoverDraft, '# Existing handover');
  assert.equal(reopened.state.messages[0].body, 'Existing transcript');
  assert.ok(events.some(({ channel, payload }) => channel === 'project:state' && payload.state.sessions[session.id]?.title === 'Saved Chat'));
  assert.deepEqual(await second.invoke('chat:runs'), { runs: {}, seq: 0 });
  assert.equal(await second.invoke('app:version'), '9.8.7');
  assert.ok((await second.invoke('skills:list', [project])).skills.some(skill => skill.name === 'tldr'));
  await assert.rejects(second.invoke('not:a-command'), /Unknown command/);
});
