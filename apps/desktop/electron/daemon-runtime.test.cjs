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

test('desktop reconnect skips a deleted Project and can open another Project', async t => {
  const { project, daemon, desktop, events, start } = await fixture(t);
  await desktop.openProject(project);
  await daemon.close();
  await waitFor(() => events.some(e => e.channel === 'runtime:connection' && !e.payload.connected));
  await fs.rm(project, { recursive: true, force: true });
  await start();
  await waitFor(() => events.some(e => e.channel === 'runtime:connection' && e.payload.connected));
  const replacement = path.join(path.dirname(project), 'replacement');
  await fs.mkdir(replacement);
  execFileSync('git', ['init', '-b', 'main', replacement], { stdio: 'ignore' });
  assert.equal((await desktop.openProject(replacement)).path, replacement);
});

test('recovery disconnects an overflowing event stream before publishing a snapshot', async t => {
  const net = require('node:net');
  const { once } = require('node:events');
  const { socketPath, prepareSocketDirectory } = require('../../daemon/src/paths.cjs');
  const { wire } = require('../../daemon/src/protocol.cjs');
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-recovery-bound-')));
  const socket = socketPath(dataDir); prepareSocketDirectory(socket);
  const sockets = new Set();
  let generation = 0;
  let overflowClosed = false;
  const server = net.createServer(connection => {
    const attempt = ++generation;
    sockets.add(connection);
    connection.on('error', () => {});
    connection.on('close', () => { sockets.delete(connection); if (attempt > 1) overflowClosed = true; });
    const protocol = wire(connection, {
      onInvalid() { connection.destroy(); },
      onMessage(request) {
        if (request.method === 'daemon:snapshot' && attempt > 1) {
          for (let seq = 1; seq <= 1100; seq++) protocol.send({ v: 1, event: { seq, channel: 'agent:event', payload: { seq } } });
          // Recovery must reject the stream even when the snapshot never arrives.
          return;
        }
        const result = request.method === 'daemon:status' ? { capabilities: ['desktop-v1'], methods: [] } : null;
        protocol.send({ v: 1, id: request.id, result });
      },
    });
  });
  server.listen(socket); await once(server, 'listening');
  const events = [];
  const desktop = await connectDesktopRuntime({ dataDir, version: 'test', reconnectMs: 20, emit: (channel, payload) => events.push({ channel, payload }) });
  t.after(async () => { await desktop.close(); for (const client of sockets) client.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(dataDir, { recursive: true, force: true }); });
  for (const client of sockets) client.destroy();
  await waitFor(() => overflowClosed);
  assert.equal(events.some(event => event.channel === 'runtime:snapshot' || event.channel === 'agent:event'), false);
});

test('explicit desktop update waits for the shared host to save and stop', async t => {
  const { dataDir, project, desktop } = await fixture(t);
  const opened = await desktop.openProject(project);
  const session = Object.values(opened.state.sessions)[0];
  await desktop.invoke('chat:patch', [project, session.id, { title: 'Before update' }]);
  await desktop.close({ stopHost: true });
  await assert.rejects(fs.stat(path.join(dataDir, 'runtime.lock')), { code: 'ENOENT' });
  const saved = JSON.parse(await fs.readFile(path.join(project, '.milagre/coordination.json'), 'utf8'));
  assert.equal(saved.sessions[session.id].title, 'Before update');
});
