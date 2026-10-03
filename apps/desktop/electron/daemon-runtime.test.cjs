const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { startDaemon } = require('@milagre/daemon/server');
const { connect } = require('@milagre/daemon/client');
const { connectDesktopRuntime } = require('./daemon-runtime.cjs');

async function waitFor(read) {
  for (let i = 0; i < 200; i++) { const result = read(); if (result) return result; await delay(10); }
  throw new Error('Timed out waiting for desktop reconnect');
}
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-desktop-client-')));
  const project = path.join(root, 'project'); await fs.mkdir(project);
  execFileSync('git', ['init', '-b', 'main', project], { stdio: 'ignore' });
  const dataDir = path.join(root, 'profile');
  const runtimeOptions = { cwd: project, environmentReady: Promise.resolve(), titleModels: {} };
  const daemons = [];
  const start = async () => { const daemon = await startDaemon({ dataDir, version: 'test', runtimeOptions }); daemons.push(daemon); return daemon; };
  const daemon = await start();
  const events = [];
  const desktop = await connectDesktopRuntime({ dataDir, version: 'test', cwd: project, reconnectMs: 20, emit: (channel, payload) => events.push({ channel, payload }) });
  t.after(async () => { await desktop.close().catch(() => {}); for (const d of daemons) await d.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { dataDir, project, daemon, desktop, events, start };
}

test('desktop shares saved Chat state with another client and quit keeps the daemon available', async t => {
  const { dataDir, project, desktop, events } = await fixture(t);
  const mobile = await connect({ dataDir }); t.after(() => mobile.close());
  const a = await desktop.openProject(project);
  const session = Object.values(a.state.sessions)[0];
  await mobile.call('chat:patch', [project, session.id, { title: 'From phone' }]);
  await waitFor(() => events.some(e => e.channel === 'project:state' && e.payload.state.sessions[session.id].title === 'From phone'));
  assert.equal((await desktop.invoke('project:current')).state.sessions[session.id].title, 'From phone');
  await desktop.close();
  assert.ok((await mobile.call('daemon:status')).capabilities.includes('desktop-v1'));
});

test('desktop reconnect restores snapshots and does not replay an unsuccessful mutation', async t => {
  const { dataDir, project, daemon, desktop, events, start } = await fixture(t);
  const opened = await desktop.openProject(project);
  const session = Object.values(opened.state.sessions)[0];
  await desktop.invoke('chat:patch', [project, session.id, { title: 'Before disconnect' }]);
  await daemon.close();
  await waitFor(() => events.some(e => e.channel === 'runtime:connection' && !e.payload.connected));
  await assert.rejects(desktop.invoke('chat:patch', [project, session.id, { title: 'Must not replay' }]));
  await start();
  const refreshed = await waitFor(() => events.find(e => e.channel === 'runtime:snapshot'));
  assert.equal(refreshed.payload.projects.find(p => p.path === project).state.sessions[session.id].title, 'Before disconnect');
  const observer = await connect({ dataDir }); t.after(() => observer.close());
  assert.equal((await observer.call('project:snapshot', [project])).state.sessions[session.id].title, 'Before disconnect');
  assert.equal((await desktop.invoke('project:current')).path, project);
});
