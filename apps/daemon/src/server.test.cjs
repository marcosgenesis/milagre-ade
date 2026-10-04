const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { startDaemon } = require('./server.cjs');
const { connect } = require('./client.cjs');

async function waitFor(read) {
  for (let i = 0; i < 200; i++) { const value = await read(); if (value) return value; await delay(10); }
  throw new Error('Timed out waiting for daemon state');
}
async function fixture(t, options = {}) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-daemon-')));
  const dataDir = path.join(directory, 'profile');
  const project = path.join(directory, 'project');
  await fs.mkdir(project);
  execFileSync('git', ['init', '-b', 'main', project], { stdio: 'ignore' });
  const sessions = [];
  const daemon = await startDaemon({ dataDir, version: '9.8.7', maxFrameBytes: 8192, runtimeOptions: {
    cwd: project, environmentReady: Promise.resolve(), titleModels: {},
    agentCli: Object.assign(async () => ({ command: '/fake/codex' }), { invalidate() {} }),
    createSession(provider, options) {
      const session = {
        closed: false, turnActive: false,
        async startTurn() {
          this.turnActive = true;
          options.emit({ type: 'session-ready', sessionId: 'native-id' });
          options.emit({ type: 'turn-started', turnId: 'turn-1' });
          options.emit({ type: 'permission-request', requestId: 'permission-1', kind: 'command', tool: 'Shell', title: 'Run?', command: 'ls', allowForChat: true });
          return { turnId: 'turn-1' };
        },
        respondToPermission(requestId, decision) {
          this.decision = { requestId, decision };
          options.emit({ type: 'permission-resolved', requestId });
          return true;
        },
        async close() {
          this.closed = true;
          if (this.turnActive) options.emit({ type: 'turn-cancelled' });
          this.turnActive = false;
        },
      };
      sessions.push(session);
      return session;
    },
  }, ...options });
  const clients = [];
  const client = async () => { const c = await connect({ dataDir }); clients.push(c); return c; };
  t.after(async () => {
    for (const c of clients) c.close();
    try { await daemon.close(); } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  return { daemon, dataDir, project, sessions, client };
}

test('independent clients reconnect to a running Chat and its pending approval', async t => {
  const { daemon, project, sessions, client } = await fixture(t);
  const first = await client();
  const observer = await client();
  const events = [];
  observer.on('event', event => events.push(event));
  const opened = await first.call('project:open', [project]);
  const session = Object.values(opened.state.sessions)[0];
  const chatId = `${project}#${session.id}`;
  await first.call('chat:send', [{ projectPath: project, sessionId: session.id, body: 'Hello', provider: 'codex', model: 'test', permissionMode: 'ask' }]);
  await waitFor(() => events.find(event => event.channel === 'agent:event' && event.payload.event.type === 'permission-request'));
  first.close();
  const second = await client();
  const snapshot = await second.call('chat:runs');
  assert.ok(JSON.stringify(snapshot.runs[chatId]).includes('permission-1'));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].closed, false);
  assert.equal(await second.call('agent:respond-permission', [{ chatId, requestId: 'permission-1', decision: 'allow' }]), true);
  assert.deepEqual(sessions[0].decision, { requestId: 'permission-1', decision: 'allow' });
  await assert.rejects(second.call('not:a-method'), /Unknown command/);
  assert.equal((await second.call('daemon:status')).version, '9.8.7');
  const stopping = once(observer, 'close');
  await second.call('daemon:stop');
  await stopping;
  assert.equal(sessions[0].closed, true);
  const saved = JSON.parse(await fs.readFile(path.join(project, '.milagre/coordination.json'), 'utf8'));
  assert.ok(saved.sessions[session.id].resumeTurn, 'stop saves resumable turn state');
  await assert.rejects(fs.stat(daemon.socketPath), { code: 'ENOENT' });
});

test('socket is private and rejects incompatible, malformed and oversized requests', async t => {
  const { daemon, dataDir } = await fixture(t);
  assert.equal((await fs.stat(daemon.socketPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.dirname(daemon.socketPath))).mode & 0o777, 0o700);
  await assert.rejects(startDaemon({ dataDir, version: 'other' }), /already owned/);
  for (const [frame, expected] of [
    [JSON.stringify({ v: 999, id: 1, method: 'daemon:status', args: [] }) + '\n', 'VERSION_MISMATCH'],
    ['bad json\n', 'INVALID_REQUEST'],
    [JSON.stringify({ v: 1, id: 1, method: 'daemon:status', args: {} }) + '\n', 'INVALID_REQUEST'],
    ['x'.repeat(8193), 'FRAME_TOO_LARGE'],
  ]) {
    const socket = net.createConnection(daemon.socketPath);
    t.after(() => socket.destroy());
    await once(socket, 'connect');
    const reply = once(socket, 'data');
    socket.write(frame);
    assert.equal(JSON.parse(String((await reply)[0])).error.code, expected);
    socket.destroy();
  }
});

test('a failed daemon stop reports the save error and permits a retry after recovery',async t=>{
 const {project,sessions,client}=await fixture(t);const first=await client();const opened=await first.call('project:open',[project]);const session=Object.values(opened.state.sessions)[0];
 await first.call('chat:send',[{projectPath:project,sessionId:session.id,body:'Keep me',provider:'codex',model:'test'}]);await waitFor(()=>sessions.length===1);
 const rename=fs.rename;let fail=true;t.mock.method(fs,'rename',async(...args)=>{if(fail && String(args[1]).endsWith('/coordination.json'))throw new Error('disk full');return rename(...args);});
 try {await assert.rejects(first.call('daemon:stop'),/disk full/);assert.equal(sessions[0].closed,true);} finally {fail=false;}
 assert.equal((await first.call('daemon:stop')).stopping,true);
});

test('desktop capability advertises methods, flush preserves a running turn, and waiting notices reach clients', async t => {
  const { project, sessions, client } = await fixture(t);
  const desktop = await client();
  const mobile = await client();
  const status = await desktop.call('daemon:status');
  assert.ok(status.capabilities?.includes('desktop-v1'));
  assert.ok(status.methods.includes('chat:send'));
  const notices = [];
  desktop.on('event', event => { if (event.channel === 'notification:waiting') notices.push(event.payload); });
  const opened = await desktop.call('project:open', [project]);
  const session = Object.values(opened.state.sessions)[0];
  await mobile.call('chat:send', [{ projectPath: project, sessionId: session.id, body: 'Shared Chat', provider: 'codex', model: 'test', permissionMode: 'ask' }]);
  await waitFor(() => notices.length);
  assert.equal(notices[0].requestId, 'permission-1');
  await desktop.call('daemon:flush');
  desktop.close();
  assert.equal(sessions[0].closed, false);
  assert.ok(JSON.stringify(await mobile.call('chat:runs')).includes('permission-1'));
  const saved = JSON.parse(await fs.readFile(path.join(project, '.milagre/coordination.json'), 'utf8'));
  assert.ok(saved.messages.some(message => message.body === 'Shared Chat'));
});

test('each desktop connection keeps its own Project and focus cannot read another client Chat', async t => {
  const { project, client } = await fixture(t);
  const other = path.join(path.dirname(project), 'other');
  await fs.mkdir(other);
  execFileSync('git', ['init', '-b', 'main', other], { stdio: 'ignore' });
  const first = await client();
  const second = await client();
  const a = await first.call('project:open', [project]);
  const b = await second.call('project:open', [other]);
  const aId = Object.values(a.state.sessions)[0].id;
  const bId = Object.values(b.state.sessions)[0].id;
  await first.call('chat:set-open', [`${project}#${aId}`]);
  await second.call('chat:set-open', [`${other}#${bId}`]);
  await second.call('chat:patch', [other, bId, { unread: true }]);
  await first.call('daemon:focus', [{ focused: true }]);
  assert.equal((await second.call('project:snapshot', [other])).state.sessions[bId].unread, true);
  assert.equal((await first.call('project:current')).path, project);
  assert.equal((await second.call('project:current')).path, other);
  await assert.rejects(first.call('daemon:focus', [{ focused: 'yes' }]), /focused/);
});

test('paged snapshots preserve one immutable watermark across Projects above the frame limit', async t => {
  const maxFrameBytes = 8192;
  // Two note bodies alone exceed the limit, independent of temporary-path length.
  const body = 'x'.repeat(Math.ceil(maxFrameBytes * 0.6));
  const { dataDir, project } = await fixture(t, { maxFrameBytes });
  const client = await connect({ dataDir }); t.after(() => client.close());
  const other = path.join(path.dirname(project), 'other');
  await fs.mkdir(other); execFileSync('git', ['init', '-b', 'main', other], { stdio: 'ignore' });
  for (const folder of [project, other]) {
    const opened = await client.call('project:open', [folder]);
    const session = Object.values(opened.state.sessions)[0];
    await client.call('chat:git-note', [`${folder}#${session.id}`, body]);
    const snapshot = await client.call('project:snapshot', [folder]);
    assert.equal(snapshot.state.messages[0].body, body);
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < maxFrameBytes);
  }
  await assert.rejects(client.call('daemon:snapshot'), { code: 'FRAME_TOO_LARGE' });
  const manifest = await client.call('daemon:snapshot', [{ paged: true }]);
  assert.ok(manifest.pageCount > 1);
  await assert.rejects(client.call('daemon:snapshot-page', [manifest.snapshotId, 1]), /out of order/);
  const stranger = await connect({ dataDir }); t.after(() => stranger.close());
  await assert.rejects(stranger.call('daemon:snapshot-page', [manifest.snapshotId, 0]), /expired/);
  const opened = await client.call('project:snapshot', [project]);
  const session = Object.values(opened.state.sessions)[0];
  await client.call('chat:patch', [project, session.id, { title: 'Changed after capture' }]);
  const fragments = [];
  for (let index = 0; index < manifest.pageCount; index++) fragments.push(await client.call('daemon:snapshot-page', [manifest.snapshotId, index]));
  const captured = JSON.parse(fragments.join(''));
  assert.equal(captured.projects.length, 2);
  for (const snapshot of captured.projects) assert.equal(snapshot.state.messages[0].body, body);
  assert.equal(captured.eventSeq, manifest.eventSeq);
  assert.notEqual(captured.projects.find(item => item.path === project).state.sessions[session.id].title, 'Changed after capture');
  await assert.rejects(client.call('daemon:snapshot-page', [manifest.snapshotId, 0]), /expired|snapshot/i);
});

const phoneStatus = async (client, state) => waitFor(async () => { const next = await client.call('phone:status'); return next.state === state && next; });
const unreachable = url => waitFor(() => fetch(url).then(() => false, () => true));

test('phone methods are advertised to desktop, drive a real bridge, and stay out of the mobile bridge', async t => {
  const { dataDir, client } = await fixture(t, { phoneOptions: { localPort: 0 } });
  const desktop = await client();
  const status = await desktop.call('daemon:status');
  for (const method of ['phone:status', 'phone:set-enabled', 'phone:reset']) assert.ok(status.methods.includes(method), method);
  assert.deepEqual(await desktop.call('phone:status'), { enabled: false, state: 'off', remote: 'none' });
  const changes = [];
  desktop.on('event', event => { if (event.channel === 'phone:status') changes.push(event.payload.state); });
  assert.equal((await desktop.call('phone:set-enabled', [true])).state, 'starting');
  const on = await phoneStatus(desktop, 'on');
  assert.match(on.localUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(on.qrSvg, /^<svg/);
  const token = new URL(on.pairingLink).searchParams.get('token');
  await waitFor(() => changes.includes('on'));
  assert.deepEqual(changes.slice(0, 2), ['starting', 'on']);
  // The phone's own bridge serves daemon methods but never the ones that manage its access.
  const call = (method, args = [], url = on.localUrl, bearer = token) => fetch(url + '/rpc', { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, method, args }) });
  assert.equal((await call('daemon:status')).status, 200);
  for (const [method, args] of [['phone:status'], ['phone:set-enabled', [false]], ['phone:reset']]) assert.equal((await call(method, args)).status, 403, method);
  assert.equal((await desktop.call('phone:status')).state, 'on');
  await assert.rejects(desktop.call('phone:set-enabled', ['yes']), /true or false/);
  assert.equal((await desktop.call('phone:reset')).state, 'starting');
  const again = await phoneStatus(desktop, 'on');
  assert.notEqual(new URL(again.pairingLink).searchParams.get('token'), token);
  assert.equal((await call('daemon:status', [], again.localUrl)).status, 401, 'the old token stops working');
  assert.equal((await desktop.call('phone:set-enabled', [false])).state, 'off');
  await unreachable(again.localUrl + '/rpc');
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'mobile.json'), 'utf8')).enabled, false);
});

test('an enabled phone comes back when the daemon restarts, and stopping the daemon closes its bridge', async t => {
  const first = await fixture(t, { phoneOptions: { localPort: 0 } });
  const desktop = await first.client();
  await desktop.call('phone:set-enabled', [true]);
  const on = await phoneStatus(desktop, 'on');
  await first.daemon.close();
  await unreachable(on.localUrl + '/rpc');
  const second = await startDaemon({ dataDir: first.dataDir, version: '9.8.7', phoneOptions: { localPort: 0 }, runtimeOptions: { environmentReady: Promise.resolve(), titleModels: {}, agentCli: Object.assign(async () => ({ command: null }), { invalidate() {} }) } });
  const client = await connect({ dataDir: first.dataDir });
  try {
    const back = await phoneStatus(client, 'on');
    assert.equal(new URL(back.pairingLink).searchParams.get('token'), new URL(on.pairingLink).searchParams.get('token'));
  } finally { client.close(); await second.close(); }
});

test('daemon delivers push after clients leave and Phone reset/disable revokes registrations', async t => {
  const messages = [];
  let emit;
  const { dataDir, project, client } = await fixture(t, {
    pushOptions: { fetcher: async (url, options) => { assert.ok(url.endsWith('/send')); messages.push(JSON.parse(options.body)); return new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket' } })); } },
    runtimeOptions: { environmentReady: Promise.resolve(), titleModels: {}, agentCli: Object.assign(async () => ({ command: '/fake/codex' }), { invalidate() {} }),
      createSession(_provider, options) {
        emit = options.emit;
        return { async startTurn() { emit({ type: 'turn-started', turnId: 'turn' }); emit({ type: 'permission-request', requestId: 'approval', title: 'Run?', tool: 'Shell', kind: 'command', command: 'ls' }); return { turnId: 'turn' }; }, async close() { emit({ type: 'turn-cancelled' }); } };
      },
    },
  });
  const c = await client();
  assert.ok((await c.call('daemon:status')).capabilities.includes('mobile-push-v1'));
  const registration = { deviceId: 'b6e2df4b-972b-4e7b-bc65-6cda0a173798', token: 'ExpoPushToken[test]', hostId: 'https://mac.example', notifyWhenWaiting: true, notifyOnCompletion: true };
  await c.call('push:register', [registration]);
  const opened = await c.call('project:open', [project]);
  const session = Object.values(opened.state.sessions)[0];
  await c.call('chat:send', [{ projectPath: project, sessionId: session.id, body: 'Hello', provider: 'codex', model: 'test', permissionMode: 'ask' }]);
  await waitFor(() => messages.length === 1);
  c.close();
  emit({ type: 'permission-resolved', requestId: 'approval' });
  emit({ type: 'text-delta', text: 'Completed on the daemon.' });
  emit({ type: 'turn-completed' });
  await waitFor(() => messages.length === 2);
  assert.match(messages[1].title, /Turn completed/);
  assert.equal(messages[1].body, 'Completed on the daemon.');
  const second = await client();
  await second.call('phone:reset');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir, 'mobile-push.json'), 'utf8')), []);
  await second.call('push:register', [registration]);
  await second.call('phone:set-enabled', [false]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir, 'mobile-push.json'), 'utf8')), []);
});
