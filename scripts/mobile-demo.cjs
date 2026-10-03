const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { startDaemon } = require('../apps/daemon/src/server.cjs');
const { startMobileBridge } = require('../apps/daemon/src/mobile-bridge.cjs');
const { connect } = require('../apps/daemon/src/client.cjs');
const { startMetro } = require('./start-mobile.cjs');

// Explicit demo provider, never selected by the real daemon CLI.
function demoSession(_provider, { emit }) {
  let timer;
  let pending;
  let sequence = 0;
  const session = {
    closed: false, turnActive: false, nativeId: 'milagre-local-demo',
    async startTurn({ prompt }) {
      clearTimeout(timer); pending = null;
      const turnId = `demo-${++sequence}`;
      session.turnActive = true;
      emit({ type: 'session-started', nativeId: session.nativeId });
      emit({ type: 'turn-started', turnId });
      if (/approval/i.test(prompt)) {
        pending = { kind: 'permission', id: turnId };
        emit({ type: 'permission-request', requestId: turnId, kind: 'command', tool: 'Demo', title: 'Approve a demo action?', command: 'Demo only: no command will run', allowForChat: false });
      } else if (/question/i.test(prompt)) {
        pending = { kind: 'question', id: turnId };
        emit({ type: 'question-request', requestId: turnId, questions: [{ id: 'next', header: 'Next step', question: 'What should we try next?', options: [{ label: 'Read a Chat' }, { label: 'Send a message' }], multiSelect: false, allowOther: true, secret: false }] });
      } else {
        emit({ type: 'text-delta', text: 'Demo agent: your message reached the daemon on your Mac. ' });
        timer = setTimeout(() => finish('The reply made it back to your simulator. Your Chat is saved locally.'), /slow/i.test(prompt) ? 20000 : 1200);
      }
      return { turnId };
    },
    respondToPermission(requestId, decision) {
      if (pending?.kind !== 'permission' || pending.id !== requestId) return false;
      pending = null;
      emit({ type: 'permission-resolved', requestId });
      finish(`Demo agent: action ${decision === 'deny' ? 'denied' : 'approved'}. No command was run.`);
      return true;
    },
    answerQuestion(requestId, answers) {
      if (pending?.kind !== 'question' || pending.id !== requestId) return false;
      pending = null;
      emit({ type: 'question-resolved', requestId, outcome: answers ? 'answered' : 'dismissed' });
      finish(`Demo agent: answer received${answers ? ': ' + Object.values(answers).flat().join(', ') : '.'}`);
      return true;
    },
    async interrupt() {
      clearTimeout(timer); pending = null;
      if (session.turnActive) emit({ type: 'turn-cancelled' });
      session.turnActive = false;
    },
    async close() { await session.interrupt(); session.closed = true; },
  };
  function finish(text) {
    emit({ type: 'text-delta', text });
    session.turnActive = false;
    emit({ type: 'turn-completed' });
  }
  return session;
}

async function startDemo({ port = 8787 } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-mobile-demo-')));
  const dataDir = path.join(root, 'profile');
  const project = path.join(root, 'Mobile playground');
  let daemon, bridge, client;
  const close = async () => { await bridge?.close(); client?.close(); await daemon?.close(); };
  try {
    await fs.mkdir(project);
    execFileSync('git', ['init', '-b', 'main', project], { stdio: 'ignore' });
    daemon = await startDaemon({ dataDir, version: '0.1.0-demo', runtimeOptions: { cwd: project, environmentReady: Promise.resolve(), titleModels: {}, createSession: demoSession, agentCli: Object.assign(async () => ({ command: '/demo/codex' }), { invalidate() {} }) } });
    client = await connect({ dataDir });
    const opened = await client.call('project:open', [project]);
    const chat = Object.values(opened.state.sessions)[0];
    await client.call('chat:patch', [project, chat.id, { title: 'Hello from your Mac' }]);
    await client.call('chat:git-note', [`${project}#${chat.id}`, 'Welcome to the local mobile preview. Send a message to try the connection. This demo agent runs without a provider account.']);
    const token = randomBytes(32).toString('hex');
    bridge = await startMobileBridge({ dataDir, port, token });
    const details = { url: bridge.url, token, dataDir, project, root, pid: process.pid };
    await fs.writeFile(path.join(root, 'connection.json'), JSON.stringify(details, null, 2), { mode: 0o600, flag: 'wx' });
    return { ...details, close };
  } catch (error) { await close(); throw error; }
}

async function main() {
  const demo = await startDemo({ port: Number(process.env.MILAGRE_MOBILE_PORT || 8787) });
  console.log(`Demo Project: ${demo.project}\nConnection details: ${path.join(demo.root, 'connection.json')}\nBridge: ${demo.url}\nPress Shift+i to choose the Milagre Local simulator. Ctrl+C stops the demo and Metro.`);
  const metro = startMetro({ ...process.env, EXPO_PUBLIC_DAEMON_URL: demo.url, EXPO_PUBLIC_DAEMON_TOKEN: demo.token, EXPO_PUBLIC_DEMO: '1' });
  let stopping;
  const stop = () => stopping ??= (async () => { metro.kill('SIGTERM'); await demo.close(); })();
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  metro.once('error', error => { console.error(error.message); process.exitCode = 1; void stop(); });
  metro.once('exit', code => { if (!stopping && code) process.exitCode = code; void stop(); });
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { startDemo };
