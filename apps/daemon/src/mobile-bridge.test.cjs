const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const { startDaemon } = require('./server.cjs');
const { startMobileBridge } = require('./mobile-bridge.cjs');
const { connect } = require('./client.cjs');

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-mobile-')));
  const dataDir = path.join(root, 'profile');
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  execFileSync('git', ['init', '-b', 'main', project], { stdio: 'ignore' });
  const daemon = await startDaemon({ dataDir, version: 'test', runtimeOptions: { environmentReady: Promise.resolve(), titleModels: {}, worktreeRoot: path.join(root, 'worktrees'), agentCli: Object.assign(async () => ({ command: null, problem: 'Test has no provider' }), { invalidate() {} }) } });
  const token = randomBytes(32).toString('hex');
  const bridge = await startMobileBridge({ dataDir, port: 0, token });
  t.after(async () => { await bridge.close(); await daemon.close(); await fs.rm(root, { recursive: true, force: true }); });
  const request = (route, options = {}) => fetch(bridge.url + route, { ...options, headers: { authorization: `Bearer ${token}`, ...options.headers } });
  const rpc = (method, args = []) => request('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, method, args }) });
  return { dataDir, project, bridge, request, rpc, token };
}

test('mobile bridge forwards commands to the existing owner and reads cached snapshots', async t => {
  const { dataDir, project, bridge, request, rpc } = await fixture(t);
  assert.match(bridge.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal((await rpc('daemon:status')).status, 200);
  assert.equal((await request('/snapshot?projectPath=' + encodeURIComponent(project))).status, 409);
  const opened = (await (await rpc('project:open', [project])).json()).result;
  const session = Object.values(opened.state.sessions)[0];
  const client = await connect({ dataDir });
  t.after(() => client.close());
  await client.call('chat:patch', [project, session.id, { title: 'Updated from socket' }]);
  const snapshot = (await (await request('/snapshot?projectPath=' + encodeURIComponent(project))).json()).result;
  assert.equal(snapshot.project.state.sessions[session.id].title, 'Updated from socket');
  assert.deepEqual(snapshot.runs.runs, {});
  await bridge.close();
  assert.equal((await client.call('daemon:status')).version, 'test');
});

test('HTTP guard rejects unauthorized, cross-origin, malformed and unsupported requests', async t => {
  const { bridge, request, rpc, token } = await fixture(t);
  assert.equal((await fetch(bridge.url + '/snapshot')).status, 401);
  assert.equal((await request('/snapshot', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await request('/snapshot', { headers: { origin: 'https://evil.example' } })).status, 403);
  const hostileHost = await new Promise((resolve, reject) => {
    const req = http.get(bridge.url + '/snapshot', { headers: { host: 'evil.example', authorization: `Bearer ${token}` } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(hostileHost, 403);
  const androidHost = await new Promise((resolve, reject) => {
    const req = http.request(bridge.url + '/rpc', { method: 'POST', headers: { host: `10.0.2.2:${new URL(bridge.url).port}`, authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end(JSON.stringify({ v: 1, method: 'daemon:status', args: [] }));
  });
  assert.equal(androidHost, 200);
  assert.equal((await rpc('worktree:remove', ['/tmp/nope'])).status, 403);
  assert.equal((await rpc('daemon:stop')).status, 403);
  assert.equal((await request('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await request('/rpc', { method: 'POST', body: JSON.stringify({ v: 1, method: 'daemon:status', args: [] }) })).status, 415);
  assert.equal((await request('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 2, method: 'daemon:status', args: [] }) })).status, 400);
  assert.equal((await request('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
});

test('mobile can manage Chat metadata and create Worktrees, and read changes only in open Projects', async t => {
  const { project, rpc, request } = await fixture(t);
  execFileSync('git', ['-C', project, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'Initial'], { stdio: 'ignore' });
  const opened = (await (await rpc('project:open', [project])).json()).result;
  const chat = Object.values(opened.state.sessions)[0];
  assert.equal((await rpc('chat:patch', [project, chat.id, { title: 'Mobile name', archived: true }])).status, 200);
  let state = (await (await request('/snapshot?projectPath=' + encodeURIComponent(project))).json()).result;
  assert.equal(state.project.state.sessions[chat.id].title, 'Mobile name');
  assert.equal(state.project.state.sessions[chat.id].archived, true);
  assert.equal((await rpc('project:branches', [project])).status, 200);
  const created = await rpc('worktree:create', [{ projectPath: project, baseBranch: 'main', prompt: 'Mobile feature' }]);
  assert.equal(created.status, 200);
  const result = (await created.json()).result;
  assert.ok(result.project.state.worktrees[result.worktreeId]);
  await fs.writeFile(path.join(project, 'mobile.txt'), 'A change from the computer\n');
  const files = (await (await rpc('git:diff-files', [{ cwd: project, mode: 'uncommitted' }])).json()).result;
  assert.ok(files.files.some(file => file.path === 'mobile.txt'));
  const diff = (await (await rpc('git:diff-file', [{ cwd: project, mode: 'uncommitted', path: 'mobile.txt', untracked: true }])).json()).result;
  assert.match(diff.patch, /\+A change from the computer/);
  assert.equal((await rpc('git:diff-files', [{ cwd: os.homedir(), mode: 'uncommitted' }])).status, 409);
  assert.equal((await rpc('git:diff-file', [{ cwd: project, mode: 'uncommitted', path: '../outside' }])).status, 409);
  for (const method of ['git:commit', 'git:push', 'git:open-pr', 'worktree:remove', 'daemon:stop']) assert.equal((await rpc(method)).status, 403);
});

test('mobile uploads are private, bounded and scoped to an open Project', async t => {
  const { project, dataDir, request, rpc } = await fixture(t);
  const upload = value => request('/attachments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const payload = { projectPath: project, name: '../../notes.txt', base64: Buffer.from('Review this document').toString('base64') };
  assert.equal((await upload(payload)).status, 409);
  await rpc('project:open', [project]);
  const response = await upload(payload);
  assert.equal(response.status, 200);
  const file = (await response.json()).result;
  assert.ok(file.path.startsWith(path.join(dataDir, 'mobile-attachments') + path.sep));
  assert.equal(path.basename(file.path), 'notes.txt');
  assert.equal(await fs.readFile(file.path, 'utf8'), 'Review this document');
  assert.equal((await fs.stat(file.path)).mode & 0o777, 0o600);
  assert.equal((await upload({ ...payload, base64: 'invalid!' })).status, 400);
  assert.equal((await upload({ ...payload, base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') })).status, 413);
  const next = (await (await upload(payload)).json()).result;
  assert.notEqual(next.path, file.path);
});
