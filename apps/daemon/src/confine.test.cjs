const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { WebSocket } = require('ws');
const { startDaemon } = require('./server.cjs');
const { startMobileBridge, METHODS } = require('./mobile-bridge.cjs');
const { connect } = require('./client.cjs');
const { PATHS, REFUSED, createConfinement } = require('./confine.cjs');
const { demoRuntimeOptions, DEMO_MODEL } = require('./demo-agent.cjs');

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('pretend image data')]);
const repo = folder => {
  execFileSync('git', ['init', '-b', 'main', folder], { stdio: 'ignore' });
  execFileSync('git', ['-C', folder, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'Initial'], { stdio: 'ignore' });
};

/**
 * A demo daemon with two projects: the allowed one (`demo`, inside `root`) and one outside it (`outside`), which the
 * owner's side opened first so it is in the recent list and its chats exist. A symlink inside the demo leads out.
 */
async function fixture(t, { allowedRoot = true } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-confine-')));
  const dataDir = path.join(root, 'profile');
  const demo = path.join(root, 'demo');
  const outside = path.join(root, 'outside');
  await fs.mkdir(demo);
  await fs.mkdir(outside);
  repo(demo);
  repo(outside);
  await fs.writeFile(path.join(outside, 'secret.png'), PNG);
  await fs.writeFile(path.join(demo, 'shot.png'), PNG);
  await fs.symlink(outside, path.join(demo, 'link-out'));
  const daemon = await startDaemon({ dataDir, version: 'test', runtimeOptions: demoRuntimeOptions({ cwd: demo, worktreeRoot: path.join(demo, '.milagre', 'worktrees') }) });
  const owner = await connect({ dataDir });
  await owner.call('project:open', [outside]);
  const token = randomBytes(32).toString('hex');
  const bridge = await startMobileBridge({ dataDir, port: 0, token, ...(allowedRoot ? { allowedRoot: demo } : {}) });
  t.after(async () => { owner.close(); await bridge.close(); await daemon.close(); await fs.rm(root, { recursive: true, force: true }); });
  const request = (route, options = {}) => fetch(bridge.url + route, { ...options, headers: { authorization: `Bearer ${token}`, ...options.headers } });
  const rpc = async (method, args = []) => {
    const response = await request('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, method, args }) });
    return { status: response.status, body: await response.json() };
  };
  const live = projectPath => new Promise((resolve, reject) => {
    const socket = new WebSocket(`${bridge.url.replace(/^http/, 'ws')}/live?projectPath=${encodeURIComponent(projectPath)}`, { headers: { authorization: `Bearer ${token}` } });
    socket.once('open', () => { socket.close(); resolve(101); });
    socket.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); });
    socket.once('error', reject);
  });
  return { root, dataDir, demo, outside, owner, bridge, request, rpc, live };
}

const refusedBody = { v: 1, error: { message: REFUSED } };

// Every command the phone may call that names a path, with that path pointing at `target`.
const callsAt = (target, demo) => [
  ['project:open', [target]],
  ['project:branches', [target]],
  ['chat:send', [{ projectPath: target, sessionId: 1, body: 'hi', provider: 'codex', model: 'demo', permissionMode: 'ask' }]],
  ['chat:send', [{ projectPath: demo, cwd: target, sessionId: 1, body: 'hi', provider: 'codex', model: 'demo', permissionMode: 'ask' }]],
  ['chat:send', [{ projectPath: demo, sessionId: 1, body: 'hi', files: [path.join(target, 'secret.png')], provider: 'codex', model: 'demo', permissionMode: 'ask' }]],
  ['chat:resume', [target, 1]],
  ['chat:patch', [target, 1, { title: 'Renamed' }]],
  ['agent:interrupt', [`${target}#1`]],
  ['agent:respond-permission', [{ chatId: `${target}#1`, requestId: 'x', decision: 'allow' }]],
  ['agent:answer-question', [{ chatId: `${target}#1`, requestId: 'x', answers: { next: ['A'] }, summary: 'A' }]],
  ['agent:set-permission-mode', [{ chatId: `${target}#1`, mode: 'auto' }]],
  ['push:focus', [{ deviceId: 'phone', chatId: `${target}#1` }]],
  ['worktree:pull-request', [target]],
  ['worktree:create', [{ projectPath: target, baseBranch: 'main', prompt: 'Escape' }]],
  ['git:diff-files', [{ cwd: target, mode: 'uncommitted' }]],
  ['git:diff-file', [{ cwd: target, mode: 'uncommitted', path: 'secret.png' }]],
];
const routesAt = (target, demo) => [
  `/snapshot?projectPath=${encodeURIComponent(target)}`,
  `/runs?projectPath=${encodeURIComponent(target)}`,
  `/message?projectPath=${encodeURIComponent(target)}&id=1`,
  `/media?projectPath=${encodeURIComponent(target)}&path=${encodeURIComponent(path.join(target, 'secret.png'))}`,
  `/media?projectPath=${encodeURIComponent(demo)}&path=${encodeURIComponent(path.join(target, 'secret.png'))}`,
];

async function assertRefusedEverywhere({ rpc, request, live, demo }, target) {
  for (const [method, args] of callsAt(target, demo)) {
    const { status, body } = await rpc(method, args);
    assert.equal(status, 403, `${method} ${JSON.stringify(args)} must be refused`);
    assert.deepEqual(body, refusedBody, method);
  }
  for (const route of routesAt(target, demo)) {
    const response = await request(route);
    assert.equal(response.status, 403, route);
    assert.deepEqual(await response.json(), refusedBody, route);
  }
  const upload = await request('/attachments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectPath: target, name: 'a.txt', base64: Buffer.from('hi').toString('base64') }) });
  assert.equal(upload.status, 403);
  assert.equal(await live(target), 403);
}

test('every command the phone may call has a confinement rule, and no rule names a command it may not call', () => {
  assert.deepEqual([...METHODS].sort(), Object.keys(PATHS).sort());
});

test('a confined bridge refuses a path outside its folder on every path-taking command and route', async t => {
  const f = await fixture(t);
  await f.rpc('project:open', [f.demo]);
  await assertRefusedEverywhere(f, f.outside);
  await assertRefusedEverywhere(f, '/');
  await assertRefusedEverywhere(f, os.homedir());
  // Nothing the refused calls asked for happened: the outside project kept its name.
  const outsideState = await f.owner.call('project:snapshot', [f.outside]);
  assert.ok(Object.values(outsideState.state.sessions).every(session => session.title !== 'Renamed'));
});

test('.. and symlinks cannot lead out of the folder', async t => {
  const f = await fixture(t);
  await f.rpc('project:open', [f.demo]);
  // Raw strings, so the `..` reaches the bridge as sent.
  await assertRefusedEverywhere(f, `${f.demo}/../outside`);
  await assertRefusedEverywhere(f, `${f.demo}/./../outside`);
  await assertRefusedEverywhere(f, path.join(f.demo, 'link-out'));
  await assertRefusedEverywhere(f, `${f.demo}/link-out/../outside`);
  // A sibling whose name starts with the folder's is not inside it.
  await fs.mkdir(`${f.demo}-evil`);
  assert.equal((await f.rpc('project:open', [`${f.demo}-evil`])).status, 403);
  // Relative, missing and malformed paths are refused too.
  for (const target of ['demo', path.join(f.demo, 'missing', '..', '..', 'outside'), path.join(f.root, 'missing'), null, 42, { path: f.demo }]) {
    assert.equal((await f.rpc('project:open', [target])).status, 403, JSON.stringify(target));
  }
  assert.equal((await f.request('/snapshot')).status, 403);
  assert.equal((await f.rpc('agent:interrupt', [42])).status, 403);
  assert.equal((await f.rpc('push:focus', [{ deviceId: 'phone', chatId: 'no-hash' }])).status, 403);
});

test('inside the folder the phone browses, reads changes, sends and sees images; recent lists only the demo', async t => {
  const f = await fixture(t);
  const recentBefore = await f.owner.call('project:recent');
  assert.ok(recentBefore.some(entry => entry.path === f.outside), 'the owner side sees the other project');
  assert.equal((await f.rpc('project:open', [f.demo])).status, 200);
  const recent = (await f.rpc('project:recent')).body.result;
  assert.deepEqual(recent.map(entry => entry.path), [f.demo]);
  const snapshot = await (await f.request(`/snapshot?projectPath=${encodeURIComponent(f.demo)}`)).json();
  const chat = Object.values(snapshot.result.project.state.sessions)[0];
  assert.equal((await f.rpc('git:diff-files', [{ cwd: f.demo, mode: 'uncommitted' }])).status, 200);
  assert.equal((await f.rpc('project:branches', [f.demo])).status, 200);
  assert.equal((await f.rpc('chat:patch', [f.demo, chat.id, { title: 'Inside' }])).status, 200);
  assert.equal((await f.request(`/media?projectPath=${encodeURIComponent(f.demo)}&path=${encodeURIComponent(path.join(f.demo, 'shot.png'))}`)).status, 200);
  assert.equal(await f.live(f.demo), 101);
  // An upload stays the phone's own: it may be attached and shown, but not the files of another project.
  const upload = await (await f.request('/attachments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectPath: f.demo, name: 'photo.png', base64: PNG.toString('base64') }) })).json();
  assert.equal((await f.request(`/media?projectPath=${encodeURIComponent(f.demo)}&path=${encodeURIComponent(upload.result.path)}`)).status, 200);
  const sent = await f.rpc('chat:send', [{ projectPath: f.demo, sessionId: chat.id, body: 'hello', files: [upload.result.path, path.join(f.demo, 'shot.png')], provider: 'claude', model: 'claude-opus-5-5', permissionMode: 'ask' }]);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const chatId = `${f.demo}#${chat.id}`;
  for (let i = 0; i < 200; i++) {
    const state = (await (await f.request(`/snapshot?projectPath=${encodeURIComponent(f.demo)}`)).json()).result;
    if (!state.runs.runs[chatId] && state.project.state.messages.some(message => /scripted|Demo agent/.test(message.body ?? ''))) break;
    assert.ok(i < 199, 'the demo agent answered');
    await delay(20);
  }
  // The turns of other projects are not listed either.
  const runs = (await f.rpc('chat:runs')).body.result;
  assert.ok(Object.keys(runs.runs).every(key => key.startsWith(`${f.demo}#`)));
  // A worktree the phone creates lands inside the folder and is usable.
  const created = await f.rpc('worktree:create', [{ projectPath: f.demo, baseBranch: 'main', prompt: 'Try a worktree' }]);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const worktree = created.body.result.project.state.worktrees[created.body.result.worktreeId].path;
  assert.ok(worktree.startsWith(f.demo + path.sep));
  assert.equal((await f.rpc('git:diff-files', [{ cwd: worktree, mode: 'uncommitted' }])).status, 200);
});

test('the demo daemon reports only the demo agent, whichever provider the phone picks', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.rpc('agent:models')).body.result, { codex: [DEMO_MODEL], claude: null });
  const status = (await f.rpc('agent:cli-status')).body.result;
  assert.deepEqual(status.codex, { state: 'ready' });
  assert.equal(status.claude.state, 'missing');
  assert.deepEqual((await f.rpc('usage:read')).body.result, { providers: [] });
});

test('without allowedRoot the bridge opens any folder, as before', async t => {
  const f = await fixture(t, { allowedRoot: false });
  assert.equal((await f.rpc('project:open', [f.outside])).status, 200);
  assert.equal((await f.rpc('project:open', [f.demo])).status, 200);
  assert.deepEqual((await f.rpc('project:recent')).body.result.map(entry => entry.path).sort(), [f.demo, f.outside].sort());
  assert.equal((await f.request(`/snapshot?projectPath=${encodeURIComponent(f.outside)}`)).status, 200);
  assert.equal((await f.rpc('git:diff-files', [{ cwd: f.outside, mode: 'uncommitted' }])).status, 200);
  assert.equal(await f.live(f.outside), 101);
  // Unchanged errors too: a project that is not open is a 409 from the daemon, not a 403.
  assert.equal((await f.request(`/snapshot?projectPath=${encodeURIComponent(path.join(f.root, 'nowhere'))}`)).status, 409);
});

test('a confinement needs an absolute folder that exists, and refuses commands it has no rule for', async () => {
  assert.throws(() => createConfinement({ allowedRoot: 'relative' }), /absolute/);
  await assert.rejects(createConfinement({ allowedRoot: path.join(os.tmpdir(), `missing-${randomBytes(4).toString('hex')}`) }).root(), /does not exist/);
  const confine = createConfinement({ allowedRoot: os.tmpdir() });
  await assert.rejects(confine.checkCall('worktree:remove', [os.tmpdir()]), { status: 403, message: REFUSED });
  await assert.rejects(confine.checkCall('project:open', 'not an array'), { status: 403 });
});
