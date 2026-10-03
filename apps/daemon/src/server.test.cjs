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
