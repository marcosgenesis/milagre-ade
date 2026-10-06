const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { startDaemon } = require('@milagre/daemon/server');
const { connect } = require('@milagre/daemon/client');
const { compatibleClient } = require('@milagre/daemon/bootstrap');
const { connectDesktopRuntime } = require('./daemon-runtime.cjs');

async function waitFor(read, attempts = 200) {
  for (let i = 0; i < attempts; i++) { const result = read(); if (result) return result; await delay(10); }
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
        const result = request.method === 'daemon:status' ? { capabilities: ['desktop-v1', 'snapshot-pages-v1', 'result-pages-v1'], methods: [] } : null;
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

test('desktop reconnect restores two large Projects without an oversized aggregate frame', async t => {
  const { project, daemon, desktop, events, start } = await fixture(t);
  const other = path.join(path.dirname(project), 'other');
  await fs.mkdir(other); execFileSync('git', ['init', '-b', 'main', other], { stdio: 'ignore' });
  for (const folder of [project, other]) {
    const opened = await desktop.openProject(folder);
    const session = Object.values(opened.state.sessions)[0];
    await desktop.invoke('chat:git-note', [`${folder}#${session.id}`, 'x'.repeat(9 * 1024 * 1024)]);
  }
  events.length = 0;
  await daemon.close();
  await waitFor(() => events.some(event => event.channel === 'runtime:connection' && !event.payload.connected));
  await start();
  const restored = await waitFor(() => events.find(event => event.channel === 'runtime:snapshot'), 1000).catch(error => { console.error(events.filter(event => event.channel === 'runtime:connection')); throw error; });
  assert.equal(restored.payload.projects.length, 2);
  for (const opened of restored.payload.projects) assert.equal(opened.state.messages[0].body.length, 9 * 1024 * 1024);
  assert.equal((await desktop.invoke('project:current')).path, other);
});

for (const stopHost of [false, true]) {
  test(`desktop ${stopHost ? 'update stop' : 'quit flush'} rejects a failed save and can retry without losing accepted notes`, async t => {
    const { dataDir, project, desktop } = await fixture(t);
    const opened = await desktop.openProject(project);
    const session = Object.values(opened.state.sessions)[0];
    const rename = fs.rename;
    let fail = true;
    t.mock.method(fs, 'rename', async (...args) => {
      if (fail && String(args[1]).endsWith('/coordination.json')) throw new Error('disk full');
      return rename(...args);
    });
    await desktop.invoke('chat:git-note', [`${project}#${session.id}`, 'Keep this accepted note']);
    try {
      await assert.rejects(desktop.close({ stopHost }), /disk full/);
      assert.ok(await fs.stat(path.join(dataDir, 'runtime.lock')));
    } finally { fail = false; }
    await desktop.close({ stopHost });
    const saved = JSON.parse(await fs.readFile(path.join(project, '.milagre/coordination.json'), 'utf8'));
    assert.ok(saved.messages.some(message => message.body === 'Keep this accepted note'));
    if (stopHost) await assert.rejects(fs.stat(path.join(dataDir, 'runtime.lock')), { code: 'ENOENT' });
    else {
      const observer = await connect({ dataDir }); t.after(() => observer.close());
      assert.ok((await observer.call('daemon:status')).capabilities.includes('desktop-v1'));
    }
  });
}

test('a Project state over 16 MB opens in the desktop, and its changes reach the window whole', async t => {
  const { dataDir, project, desktop, events } = await fixture(t);
  const messages = [];
  for (let index = 0; index < 900; index++) {
    messages.push({ id: 10 + index, session_id: 2, body: `Reply ${index}`, context: null, role: 'assistant',
      steps: [{ id: `step-${index}`, kind: 'shell', title: 'Ran `npm test`', status: 'done', detail: `${index} `.padEnd(20_000, 'output line\n') }] });
  }
  await fs.mkdir(path.join(project, '.milagre'));
  await fs.writeFile(path.join(project, '.milagre/coordination.json'), JSON.stringify({ next_id: 5000, projects: { 1: { id: 1, name: 'project' } },
    worktrees: { 1: { id: 1, project_id: 1, path: project, name: 'main' } }, sessions: { 2: { id: 2, worktree_id: 1, agent_name: 'main', status: 'Created', title: 'Long chat' } }, messages, tasks: {} }));
  const opened = await desktop.openProject(project);
  assert.ok(Buffer.byteLength(JSON.stringify(opened)) > 16 * 1024 * 1024);
  assert.equal(opened.state.messages.length, 900);
  const mobile = await connect({ dataDir }); t.after(() => mobile.close());
  await mobile.call('chat:patch', [project, 2, { title: 'From phone' }]);
  const changed = await waitFor(() => events.find(e => e.channel === 'project:state' && e.payload.state?.sessions[2].title === 'From phone'), 1000);
  assert.equal(changed.payload.state.messages.length, 900);
  assert.equal('stateTooLarge' in changed.payload, false);
  assert.equal(events.some(e => e.channel === 'runtime:connection'), false, 'the connection never dropped');
});

// A host on a temporary socket that answers like the daemon; `snapshot(request)` answers project:snapshot.
async function fakeHost(t, { capabilities = ['desktop-v1', 'snapshot-pages-v1', 'result-pages-v1'], snapshot = () => null, onStop } = {}) {
  const net = require('node:net');
  const { once } = require('node:events');
  const { socketPath, prepareSocketDirectory } = require('../../daemon/src/paths.cjs');
  const { wire } = require('../../daemon/src/protocol.cjs');
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-fake-host-')));
  const socket = socketPath(dataDir); prepareSocketDirectory(socket);
  const sockets = new Set();
  const host = { protocol: null, reads: [] };
  const server = net.createServer(connection => {
    sockets.add(connection);
    connection.on('error', () => {});
    connection.on('close', () => sockets.delete(connection));
    const protocol = wire(connection, {
      onInvalid() { connection.destroy(); },
      onMessage(request) {
        if (['project:snapshot', 'link:snapshot'].includes(request.method)) { host.reads.push(request.args[0]); void snapshot(request, protocol); return; }
        if (request.method === 'daemon:stop') { protocol.send({ v: 1, id: request.id, result: { stopping: true } }); void onStop?.(connection, server); return; }
        const result = request.method === 'daemon:status' ? { capabilities, methods: ['project:open'] } : null;
        protocol.send({ v: 1, id: request.id, result });
      },
    });
    host.protocol = protocol;
  });
  server.listen(socket); await once(server, 'listening');
  host.push = (seq, channel, payload) => host.protocol.send({ v: 1, event: { seq, channel, payload } });
  t.after(async () => { for (const client of sockets) client.destroy(); await new Promise(resolve => server.close(() => resolve())); await fs.rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, host, server };
}
const row = ({ channel, payload }) => [channel, payload.event?.type ?? null, payload.state ?? null, 'stateTooLarge' in payload];

test('events whose state was left out reach the window with it, in order, one read per burst', async t => {
  let reads = 0;
  const { dataDir, host } = await fakeHost(t, {
    snapshot: (request, protocol) => { reads++; setTimeout(() => protocol.send({ v: 1, id: request.id, result: { path: '/p', state: { read: reads } } }), 50); },
  });
  const events = [];
  const desktop = await connectDesktopRuntime({ dataDir, version: 'test', emit: (channel, payload) => events.push({ channel, payload }) });
  t.after(() => desktop.close().catch(() => {}));
  host.push(1, 'agent:event', { chatId: '/p#2', event: { type: 'turn-completed' }, seq: 7, stateTooLarge: true });
  host.push(2, 'agent:event', { chatId: '/p#2', event: { type: 'turn-started' }, seq: 8 });
  host.push(3, 'project:state', { path: '/p', stateTooLarge: true });
  host.push(4, 'agent:event', { chatId: '/p#2', event: { type: 'turn-failed' }, seq: 9, stateTooLarge: true });
  for (let seq = 5; seq < 10; seq++) host.push(seq, 'project:state', { path: '/p', stateTooLarge: true });
  // Another Project's state and another chat's streaming don't wait for the read.
  host.push(10, 'project:state', { path: '/q', state: { small: true } });
  host.push(11, 'agent:event', { chatId: '/p#5', event: { type: 'text-delta' }, seq: 10 });
  await waitFor(() => events.length >= 6 || null);
  assert.deepEqual(events.slice(0, 2).map(row), [['project:state', null, { small: true }, false], ['agent:event', 'text-delta', null, false]]);
  assert.deepEqual(events.slice(2).map(row), [
    ['agent:event', 'turn-completed', { read: 1 }, false],
    ['agent:event', 'turn-started', null, false],
    ['agent:event', 'turn-failed', { read: 1 }, false],
    ['project:state', null, { read: 1 }, false],
  ]);
  assert.deepEqual(host.reads, ['/p'], 'one read answered the whole burst');
});

test('a failed state read keeps the window state and still moves the turn', async t => {
  const { dataDir, host } = await fakeHost(t, {
    snapshot: (request, protocol) => protocol.send({ v: 1, id: request.id, error: { code: 'COMMAND_FAILED', message: 'gone' } }),
  });
  const events = [];
  const desktop = await connectDesktopRuntime({ dataDir, version: 'test', emit: (channel, payload) => events.push({ channel, payload }) });
  t.after(() => desktop.close().catch(() => {}));
  host.push(1, 'project:state', { path: '/p', stateTooLarge: true });
  host.push(2, 'agent:event', { chatId: '/p#2', event: { type: 'turn-completed' }, seq: 3, stateTooLarge: true });
  host.push(3, 'project:state', { path: '/p', state: { own: true } });
  await waitFor(() => events.length >= 2 || null);
  await delay(50);
  assert.deepEqual(events.map(row), [['agent:event', 'turn-completed', null, false], ['project:state', null, { own: true }, false]]);
});

test('a host without result pages still serves the desktop, says so, and can be restarted into this one', async t => {
  let stopped = false;
  const { dataDir, host } = await fakeHost(t, {
    capabilities: ['desktop-v1', 'snapshot-pages-v1'],
    // Like the real host: answer, then close every connection and the socket so a new host can listen.
    onStop: async (connection, server) => { stopped = true; await new Promise(resolve => setTimeout(resolve, 20)); connection.end(); server.close(); },
  });
  const events = [];
  const desktop = await connectDesktopRuntime({ dataDir, version: 'test', cwd: dataDir, reconnectMs: 20, emit: (channel, payload) => events.push({ channel, payload }) });
  // The real host this starts is stopped at the end of the test, while its data folder still exists.
  let hostStarted = false;
  t.after(async () => { if (hostStarted) await desktop.close({ stopHost: true }).catch(() => {}); else await desktop.close().catch(() => {}); });
  assert.deepEqual(events.find(event => event.channel === 'runtime:connection')?.payload, { connected: true, hostOutdated: true, message: "Restart Milagre's background host to load large projects." });
  assert.ok(host.protocol);
  events.length = 0;
  hostStarted = true;
  await desktop.restartHost();
  assert.equal(stopped, true, 'the old host was asked to stop, so it saved first');
  assert.deepEqual(events.filter(event => event.channel === 'runtime:connection').map(event => event.payload), [
    { connected: false, message: 'Restarting the background host…' },
    { connected: true },
  ]);
  assert.ok(desktop.methods.includes('chat:send'), 'the new host brings its commands');
  const { connect: connectClient } = require('@milagre/daemon/client');
  const observer = await connectClient({ dataDir }); t.after(() => observer.close());
  assert.ok((await observer.call('daemon:status')).capabilities.includes('result-pages-v1'));
  observer.close();
  await desktop.close({ stopHost: true });
  hostStarted = false;
  await assert.rejects(fs.stat(path.join(dataDir, 'runtime.lock')), { code: 'ENOENT' }, 'the new host stopped');
});

test('a restart whose new host fails to start says why, and its retries start one', async t => {
  const { dataDir } = await fakeHost(t, {
    capabilities: ['desktop-v1', 'snapshot-pages-v1'],
    onStop: async (connection, server) => { await new Promise(resolve => setTimeout(resolve, 20)); connection.end(); server.close(); },
  });
  const events = [];
  const options = { dataDir, version: 'test', cwd: dataDir, reconnectMs: 20, executable: '/milagre/no-such-host', startupTimeoutMs: 2000, emit: (channel, payload) => events.push({ channel, payload }) };
  const desktop = await connectDesktopRuntime(options);
  let hostStarted = false;
  t.after(async () => { if (hostStarted) await desktop.close({ stopHost: true }).catch(() => {}); else await desktop.close().catch(() => {}); });
  await assert.rejects(desktop.restartHost(), /ENOENT|no-such-host/);
  // oxlint-disable-next-line unicorn/prefer-string-starts-ends-with -- pre-existing, see PR body
  assert.ok(events.some(event => event.channel === 'runtime:connection' && /^Host unavailable/.test(event.payload.message ?? '')));
  // The next retry starts a host again instead of only trying to connect.
  hostStarted = true;
  options.executable = process.execPath;
  await waitFor(() => events.some(event => event.channel === 'runtime:connection' && event.payload.connected === true && !event.payload.hostOutdated), 1500);
  await desktop.close({ stopHost: true });
  hostStarted = false;
  await assert.rejects(fs.stat(path.join(dataDir, 'runtime.lock')), { code: 'ENOENT' }, 'the new host stopped');
});


test('large Link events hydrate from the Link snapshot and retain one completed reply', async t => {
  const id = require('node:crypto').randomUUID();
  const state = { next_id: 3, sessions: { 1: { id: 1 } }, messages: [{ id: 2, session_id: 1, body: 'Shared reply' }], preparations: {} };
  const { dataDir, host } = await fakeHost(t, { snapshot: (request, protocol) => protocol.send({ v: 1, id: request.id, result: { link: { id }, state } }) });
  const events = [];
  const desktop = await connectDesktopRuntime({ dataDir, version: 'test', emit: (channel, payload) => events.push({ channel, payload }) }); t.after(() => desktop.close());
  host.push(1, 'link:state', { linkId: id, stateTooLarge: true });
  host.push(2, 'agent:event', { chatId: `milagre-link:${id}#1`, event: { type: 'turn-completed' }, seq: 2, stateTooLarge: true });
  await waitFor(() => events.some(event => event.channel === 'agent:event'));
  assert.deepEqual(host.reads, [id]);
  assert.equal(events.find(event => event.channel === 'link:state').payload.state.messages.length, 1);
  assert.equal(events.find(event => event.channel === 'agent:event').payload.state.messages[0].body, 'Shared reply');
});

// A host that can go away and come back on one temporary socket, keeping every request it was sent. chat:send is never
// answered: it is still running when the host goes away.
async function restartableHost(t) {
  const net = require('node:net');
  const { once } = require('node:events');
  const { socketPath, prepareSocketDirectory } = require('../../daemon/src/paths.cjs');
  const { wire } = require('../../daemon/src/protocol.cjs');
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-restartable-host-')));
  const socket = socketPath(dataDir); prepareSocketDirectory(socket);
  const connections = new Map();
  const host = { dataDir, requests: [], server: null, onStop: null };
  host.listen = async () => {
    const server = net.createServer(connection => {
      connection.on('error', () => {});
      const protocol = wire(connection, {
        onInvalid() { connection.destroy(); },
        onMessage(request) {
          host.requests.push(request.method);
          if (request.method === 'chat:send') return;
          if (request.method === 'daemon:stop') { protocol.send({ v: 1, id: request.id, result: { stopping: true } }); void host.onStop?.(); return; }
          const result = request.method === 'daemon:status' ? { capabilities: ['desktop-v1', 'snapshot-pages-v1', 'result-pages-v1'], methods: ['chat:send', 'chat:patch'] }
            : request.method === 'daemon:snapshot' ? { snapshotId: 1, pageCount: 1, eventSeq: 0 }
            : request.method === 'daemon:snapshot-page' ? JSON.stringify({ projects: [], eventSeq: 0 }) : null;
          protocol.send({ v: 1, id: request.id, result });
        },
      });
      connections.set(connection, protocol);
      connection.on('close', () => connections.delete(connection));
    });
    server.listen(socket); await once(server, 'listening');
    host.server = server;
  };
  // A crash drops every connection with nothing said first. A stop that was asked for says so (daemon:stopping), then closes.
  host.goAway = async ({ announced = false } = {}) => {
    const server = host.server; host.server = null;
    const closed = new Promise(resolve => server.close(() => resolve()));
    for (const [connection, protocol] of connections) {
      if (announced) { protocol.send({ v: 1, event: { seq: 1, channel: 'daemon:stopping', payload: {} } }); connection.end(); }
      else connection.destroy();
    }
    await closed;
  };
  await host.listen();
  t.after(async () => { if (host.server) await host.goAway(); await fs.rm(dataDir, { recursive: true, force: true }); });
  return host;
}
// The desktop on a restartableHost. `start` stands in for starting a host again (ensureDaemon); the launch's own start
// only connects, and isn't counted.
async function desktopOn(t, host, start = async () => { await host.listen(); return compatibleClient(host.dataDir); }) {
  const events = [];
  const times = [];
  let launched = false;
  const desktop = await connectDesktopRuntime({ dataDir: host.dataDir, version: 'test', reconnectMs: 20, emit: (channel, payload) => events.push({ channel, payload }),
    startHost: async () => {
      if (!launched) { launched = true; return compatibleClient(host.dataDir); }
      times.push(Date.now());
      return start();
    } });
  t.after(() => desktop.close().catch(() => {}));
  return { desktop, events, starts: times };
}
const connections = events => events.filter(event => event.channel === 'runtime:connection').map(event => event.payload);

test('a host that went away by itself is started again once, and the window is told', async t => {
  const host = await restartableHost(t);
  const { events, starts } = await desktopOn(t, host);
  await host.goAway();
  await waitFor(() => connections(events).some(state => state.connected));
  await delay(100);
  assert.equal(starts.length, 1);
  assert.deepEqual(connections(events), [
    { connected: false, message: 'Connection to the host was interrupted. Reconnecting…' },
    { connected: false, message: "Milagre's background host stopped. Starting it again…" },
    { connected: true, notice: "Milagre's background host stopped unexpectedly, so it was started again." },
  ]);
  assert.equal(events.filter(event => event.channel === 'runtime:snapshot').length, 1, 'reconnected once');
});

test('a command is never sent again: not one that was running, nor one refused while the host was away', async t => {
  const host = await restartableHost(t);
  let comeBack = () => {};
  const back = new Promise(resolve => { comeBack = resolve; });
  const { desktop, events } = await desktopOn(t, host, async () => { await back; await host.listen(); return compatibleClient(host.dataDir); });
  const running = desktop.invoke('chat:send', [{ body: 'Hello' }]);
  await waitFor(() => host.requests.includes('chat:send'));
  await host.goAway();
  await assert.rejects(running, /closed/);
  await waitFor(() => connections(events).some(state => /Starting it again/.test(state.message ?? '')));
  await assert.rejects(desktop.invoke('chat:patch', ['/p', 2, { title: 'Must not replay' }]), /not sent/);
  comeBack();
  await waitFor(() => connections(events).some(state => state.connected));
  await delay(100);
  assert.equal(host.requests.filter(method => method === 'chat:send').length, 1);
  assert.equal(host.requests.includes('chat:patch'), false);
});

test('a host stopped on purpose stays stopped, and the desktop reconnects when one is started some other way', async t => {
  const host = await restartableHost(t);
  const { events, starts } = await desktopOn(t, host);
  await host.goAway({ announced: true });
  await waitFor(() => connections(events).some(state => !state.connected));
  await delay(200); // Several reconnects.
  assert.equal(starts.length, 0);
  assert.equal(connections(events).some(state => /Starting it again/.test(state.message ?? '')), false);
  await host.listen();
  await waitFor(() => connections(events).some(state => state.connected));
  assert.equal(connections(events).find(state => state.connected)?.notice, undefined);
  assert.equal(starts.length, 0);
});

test('a desktop update stops the host without starting it again, even one that does not announce its stop', async t => {
  const host = await restartableHost(t);
  host.onStop = async () => { await delay(10); await host.goAway(); };
  const { desktop, starts } = await desktopOn(t, host);
  await desktop.close({ stopHost: true });
  await delay(150);
  assert.equal(starts.length, 0);
  assert.equal(host.server, null);
});

test('a host that cannot be started again backs off, then says why and stops starting it', async t => {
  const host = await restartableHost(t);
  const { events, starts } = await desktopOn(t, host, async () => { throw new Error('no host here'); });
  await host.goAway();
  await waitFor(() => connections(events).some(state => state.failed));
  await delay(150);
  assert.equal(starts.length, 3);
  const [first, second, third] = starts;
  assert.ok(second - first >= 35 && third - second >= 75, `the delay doubles: ${second - first}ms, then ${third - second}ms`);
  assert.deepEqual(connections(events).filter(state => state.failed), [
    { connected: false, failed: true, message: "Milagre's background host couldn't start again: no host here" },
  ]);
});

test('a real host killed outright is started again over its locks and socket, with its Project open', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-desktop-crash-')));
  const project = path.join(root, 'project'); await fs.mkdir(project);
  execFileSync('git', ['init', '-b', 'main', project], { stdio: 'ignore' });
  const dataDir = path.join(root, 'profile');
  const events = [];
  const desktop = await connectDesktopRuntime({ dataDir, version: 'test', cwd: project, reconnectMs: 20, emit: (channel, payload) => events.push({ channel, payload }) });
  t.after(async () => { await desktop.close({ stopHost: true }).catch(() => {}); await fs.rm(root, { recursive: true, force: true }); });
  await desktop.openProject(project);
  const observer = await connect({ dataDir });
  const { pid } = await observer.call('daemon:status');
  observer.close();
  process.kill(pid, 'SIGKILL');
  await waitFor(() => connections(events).some(state => state.connected && state.notice), 1000);
  const again = await connect({ dataDir }); t.after(() => again.close());
  const restarted = (await again.call('daemon:status')).pid;
  assert.notEqual(restarted, pid);
  assert.equal((await desktop.invoke('project:current')).path, project);
  assert.equal(JSON.parse(await fs.readFile(path.join(project, '.milagre/runtime.lock/owner.json'), 'utf8')).pid, restarted, 'the Project lock was taken over');
});
