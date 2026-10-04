const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { WebSocket } = require('ws');
const { startDaemon } = require('./server.cjs');
const { forPhone, runsForPhone, startMobileBridge } = require('./mobile-bridge.cjs');
const { connect } = require('./client.cjs');

async function fixture(t, { runtimeOptions = {}, bridgeOptions = {} } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-mobile-')));
  const dataDir = path.join(root, 'profile');
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  execFileSync('git', ['init', '-b', 'main', project], { stdio: 'ignore' });
  const daemon = await startDaemon({ dataDir, version: 'test', runtimeOptions: { environmentReady: Promise.resolve(), titleModels: {}, worktreeRoot: path.join(root, 'worktrees'), agentCli: Object.assign(async () => ({ command: null, problem: 'Test has no provider' }), { invalidate() {} }), ...runtimeOptions } });
  const token = randomBytes(32).toString('hex');
  const bridge = await startMobileBridge({ dataDir, port: 0, token, ...bridgeOptions });
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
  assert.deepEqual(Object.keys(opened).sort(), ['name', 'path'], 'the phone reads state from /snapshot, not from open');
  const session = Object.values((await (await request('/snapshot?projectPath=' + encodeURIComponent(project))).json()).result.project.state.sessions)[0];
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
  assert.equal((await rpc('git:commit', ['/tmp/nope'])).status, 403);
  // The phone may ask for a removal, but the daemon refuses one outside a Project it has open.
  assert.equal((await rpc('worktree:remove', ['/tmp/nope'])).status, 409);
  assert.equal((await rpc('daemon:stop')).status, 403);
  assert.equal((await request('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await request('/rpc', { method: 'POST', body: JSON.stringify({ v: 1, method: 'daemon:status', args: [] }) })).status, 415);
  assert.equal((await request('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 2, method: 'daemon:status', args: [] }) })).status, 400);
  assert.equal((await request('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
});

test('mobile can manage Chat metadata and create Worktrees, and read changes only in open Projects', async t => {
  const { project, rpc, request } = await fixture(t);
  execFileSync('git', ['-C', project, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'Initial'], { stdio: 'ignore' });
  await rpc('project:open', [project]);
  const chat = Object.values((await (await request('/snapshot?projectPath=' + encodeURIComponent(project))).json()).result.project.state.sessions)[0];
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
  for (const method of ['git:commit', 'git:push', 'git:open-pr', 'daemon:stop']) assert.equal((await rpc(method)).status, 403);
});

test('the phone checks a Chat\'s worktree and removes a clean Milagre worktree, and a changed one is refused', async t => {
  const { project, request, rpc } = await fixture(t);
  execFileSync('git', ['-C', project, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'Initial'], { stdio: 'ignore' });
  await rpc('project:open', [project]);
  const json = async response => {
    const body = await response.json();
    assert.equal(response.status, 200, body.error?.message);
    return body.result;
  };
  const roots = await json(await rpc('worktree:roots'));
  assert.ok(Array.isArray(roots) && roots.length > 0);
  const create = async prompt => {
    const created = await json(await rpc('worktree:create', [{ projectPath: project, baseBranch: 'main', prompt }]));
    const worktree = created.project.state.worktrees[created.worktreeId];
    const chat = Object.values(created.project.state.sessions).find(session => session.worktree_id === worktree.id);
    assert.ok(roots.some(root => worktree.path.startsWith(root + '/')), 'a created worktree is under a root the phone was given');
    return { worktree, chatId: `${project}#${chat.id}` };
  };
  const removal = ({ worktree, chatId }, seen, force = false) => rpc('worktree:remove', [worktree.path, { force, base: worktree.base, projectPath: project, chatId, seen }]);

  const clean = await create('Clean');
  const status = await json(await rpc('worktree:status', [clean.worktree.path, clean.worktree.base]));
  assert.deepEqual({ ...status, head: typeof status.head }, { uncommitted: 0, unpushed: 0, branch: clean.worktree.name, head: 'string', removable: true });
  assert.equal((await json(await removal(clean, status))).removed, true);
  await assert.rejects(fs.stat(clean.worktree.path), { code: 'ENOENT' });
  const snapshot = (await (await request('/snapshot?projectPath=' + encodeURIComponent(project))).json()).result;
  assert.equal(snapshot.project.state.worktrees[clean.worktree.id], undefined, 'the removed worktree and its Chats leave the Project');

  // Work lands after the phone looked: neither the safe nor the forced removal goes ahead.
  const changed = await create('Changed');
  const seen = await json(await rpc('worktree:status', [changed.worktree.path, changed.worktree.base]));
  await fs.writeFile(path.join(changed.worktree.path, 'late.txt'), 'written after the check\n');
  for (const force of [false, true]) {
    const refused = await removal(changed, seen, force);
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error.message, /^WORKTREE_CHANGED: /);
  }
  assert.equal(await fs.readFile(path.join(changed.worktree.path, 'late.txt'), 'utf8'), 'written after the check\n');
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

test('mobile media serves images only from the Project Worktrees and Milagre image folders', async t => {
  const { project, dataDir, bridge, request, rpc, token } = await fixture(t);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('pretend image data')]);
  const media = (file, projectPath = project) => request(`/media?projectPath=${encodeURIComponent(projectPath)}&path=${encodeURIComponent(file)}`);
  const inside = path.join(project, 'shot.png');
  await fs.writeFile(inside, png);
  assert.equal((await media(inside)).status, 409); // The Project is not open yet.
  execFileSync('git', ['-C', project, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'Initial'], { stdio: 'ignore' });
  const created = (await (await rpc('worktree:create', [{ projectPath: project, baseBranch: 'main', prompt: 'Media' }])).json()).result;
  const worktree = created.project.state.worktrees[created.worktreeId].path;

  const generated = path.join(worktree, 'generated.png');
  await fs.writeFile(generated, png);
  const ok = await media(generated);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.equal(ok.headers.get('cache-control'), 'private, max-age=3600');
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), png);

  // Persisted attachments and mobile uploads.
  await fs.mkdir(path.join(project, '.milagre', 'images'), { recursive: true });
  const persisted = path.join(project, '.milagre', 'images', 'abc.png');
  await fs.writeFile(persisted, png);
  assert.equal((await media(persisted)).status, 200);
  await fs.mkdir(path.join(dataDir, 'mobile-attachments', 'one'), { recursive: true });
  const uploaded = path.join(dataDir, 'mobile-attachments', 'one', 'photo.png');
  await fs.writeFile(uploaded, png);
  assert.equal((await media(uploaded)).status, 200);

  // Outside every allowed folder, including through a symlink inside a Worktree.
  const outside = path.join(path.dirname(project), 'secret.png');
  await fs.writeFile(outside, png);
  assert.equal((await media(outside)).status, 403);
  await fs.symlink(outside, path.join(worktree, 'link.png'));
  assert.equal((await media(path.join(worktree, 'link.png'))).status, 403);
  await fs.symlink(path.dirname(project), path.join(worktree, 'up'));
  assert.equal((await media(path.join(worktree, 'up', 'secret.png'))).status, 403);
  assert.equal((await media(path.join(path.dirname(project), 'missing.png'))).status, 403);
  assert.equal((await media(path.join(worktree, 'missing.png'))).status, 404);

  // Only supported images: 415 for another extension or for bytes that are not an image, 400 for a relative path.
  await fs.writeFile(path.join(worktree, 'notes.txt'), 'hello');
  assert.equal((await media(path.join(worktree, 'notes.txt'))).status, 415);
  await fs.writeFile(path.join(worktree, 'fake.png'), 'not really a png');
  assert.equal((await media(path.join(worktree, 'fake.png'))).status, 415);
  await fs.symlink(path.join(worktree, 'notes.txt'), path.join(worktree, 'alias.png'));
  assert.equal((await media(path.join(worktree, 'alias.png'))).status, 415);
  assert.equal((await media('shot.png')).status, 400);
  assert.equal((await request(`/media?projectPath=${encodeURIComponent(project)}`)).status, 400);
  assert.equal((await media(worktree + '/dir.png')).status, 404);
  await fs.mkdir(path.join(worktree, 'folder.png'));
  assert.equal((await media(path.join(worktree, 'folder.png'))).status, 403);

  // 15 MiB cap.
  const big = path.join(worktree, 'big.png');
  await fs.writeFile(big, Buffer.concat([png, Buffer.alloc(15 * 1024 * 1024)]));
  assert.equal((await media(big)).status, 413);

  // Same token and host rules as every other route.
  const url = `/media?projectPath=${encodeURIComponent(project)}&path=${encodeURIComponent(generated)}`;
  assert.equal((await fetch(bridge.url + url)).status, 401);
  assert.equal((await request(url, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await request(url, { headers: { origin: 'https://evil.example' } })).status, 403);
  const hostileHost = await new Promise((resolve, reject) => {
    const req = http.get(bridge.url + url, { headers: { host: 'evil.example', authorization: `Bearer ${token}` } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(hostileHost, 403);
});

test('the bridge reports a lost daemon and stops listening, so its owner can restart it', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-mobile-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'profile');
  const daemon = await startDaemon({ dataDir, version: 'test', runtimeOptions: { environmentReady: Promise.resolve(), titleModels: {} } });
  const bridge = await startMobileBridge({ dataDir, port: 0, token: randomBytes(32).toString('hex') });
  await daemon.close();
  await bridge.lost;
  await assert.rejects(fetch(bridge.url + '/rpc', { method: 'POST' }));
});

test('snapshots carry an ETag, an unchanged one is a 304, and large bodies are gzipped', async t => {
  const { project, rpc, request, token, dataDir } = await fixture(t);
  await rpc('project:open', [project]);
  const route = '/snapshot?projectPath=' + encodeURIComponent(project);
  const first = await request(route);
  const etag = first.headers.get('etag');
  assert.match(etag, /^"[\w-]+"$/);
  const body = await first.json();
  assert.equal(body.v, 1);
  const again = await request(route, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), '');
  await rpc('chat:patch', [project, Object.values(body.result.project.state.sessions)[0].id, { title: 'Changed' }]);
  assert.equal((await request(route, { headers: { 'if-none-match': etag } })).status, 200);
  // The test Project is tiny, so a second bridge compresses everything.
  const eager = await startMobileBridge({ dataDir, port: 0, token, compressAbove: 0 });
  t.after(() => eager.close());
  const zipped = await new Promise((resolve, reject) => {
    require('node:http').get(new URL(route, eager.url), { headers: { authorization: `Bearer ${token}`, 'accept-encoding': 'gzip' } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ encoding: res.headers['content-encoding'], body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  assert.equal(zipped.encoding, 'gzip');
  assert.equal(JSON.parse(require('node:zlib').gunzipSync(zipped.body)).v, 1);
});

test('the phone snapshot leaves out tool output and old subagent transcript, keeping thinking', () => {
  const steps = [{ id: 't', kind: 'thinking', title: 'Thought', status: 'done', detail: 'first' }, { id: 'a', kind: 'shell', title: 'Ran', status: 'done', detail: 'x'.repeat(5000) }, { id: 'b', kind: 'thinking', title: 'Thought', status: 'done', detail: 'why' }, { id: 'c', kind: 'read', title: 'Read', status: 'done' }];
  const transcript = Array.from({ length: 9 }, (_, i) => ({ id: String(i), kind: 'message', text: i === 8 ? 'y'.repeat(2000) : `line ${i}` }));
  const project = { path: '/p', state: { messages: [{ id: 1, session_id: 1, body: 'hi', steps }], sessions: { 1: { id: 1, subagents: [{ id: 's', transcript }] } } } };
  const phone = forPhone(project);
  assert.deepEqual(phone.state.messages[0].steps.map(step => [step.id, step.detail, step.hasDetail]), [['t', undefined, true], ['a', undefined, true], ['b', 'why', undefined], ['c', undefined, undefined]]);
  assert.deepEqual(phone.state.sessions[1].subagents[0].transcript.map(item => item.id), ['5', '6', '7', '8']);
  assert.equal(phone.state.sessions[1].subagents[0].transcript.at(-1).text.length, 601);
  assert.equal(project.state.messages[0].steps[1].detail.length, 5000, 'the daemon\'s state is untouched');
});

function longTurn() {
  const steps = Array.from({ length: 300 }, (_, i) => ({ id: `s${i}`, kind: i === 5 ? 'thinking' : 'shell', title: `Step ${i}`, status: i === 10 ? 'running' : 'done', note: `n${i}`, offset: i, detail: `${i % 10}`.repeat(19_990) + 'END' + i }));
  return { text: 'working', model: 'm', steps, approvals: [{ id: 'a' }], questions: [], answered: {} };
}

test('runsForPhone keeps the end of live output and drops the rest of the tool output', () => {
  const run = longTurn();
  const runs = { runs: { 'p#1': run, 'p#2': { text: 'no steps', steps: [] } }, seq: 7 };
  const phone = runsForPhone(runs);
  const steps = phone.runs['p#1'].steps;
  assert.equal(phone.seq, 7);
  assert.deepEqual(phone.runs['p#2'], runs.runs['p#2']);
  assert.deepEqual(steps.filter(step => step.detail).map(step => step.id), ['s5', 's10', 's297', 's298', 's299'], 'the thinking step, the running one and the last three');
  for (const id of ['s10', 's297', 's298', 's299']) {
    const step = steps.find(item => item.id === id);
    assert.equal(step.detail.length, 4097);
    assert.ok(step.detail.startsWith('…') && step.detail.endsWith(`END${id.slice(1)}`), 'the tail of the log');
    assert.equal(step.hasDetail, undefined);
  }
  assert.equal(steps[5].detail, run.steps[5].detail, 'the latest thinking step is whole');
  assert.ok(steps.filter(step => !step.detail).every(step => step.hasDetail === true));
  assert.equal(steps.filter(step => step.hasDetail).length, 295);
  assert.deepEqual({ ...steps[0], detail: undefined, hasDetail: undefined }, { ...run.steps[0], detail: undefined, hasDetail: undefined }, 'everything but detail is unchanged');
  assert.equal(phone.runs['p#1'].text, 'working');
  assert.deepEqual(phone.runs['p#1'].approvals, run.approvals);
  assert.equal(run.steps[0].detail.length, 19_994, 'the daemon\'s runs are untouched');
});

test('runsForPhone keeps only the latest thinking step whole, and short or empty output as is', () => {
  const step = (id, kind, status, detail) => ({ id, kind, title: id, status, ...(detail === undefined ? {} : { detail }) });
  const steps = [step('t1', 'thinking', 'done', 'first'), step('t2', 'thinking', 'done', 'second'), step('a', 'shell', 'done', 'old'), step('b', 'read', 'done'), step('c', 'shell', 'done', 'new'), step('d', 'shell', 'done', 'short'), step('e', 'shell', 'running', 'z'.repeat(5000))];
  const phone = runsForPhone({ runs: { k: { text: '', steps } }, seq: 1 }).runs.k.steps;
  assert.deepEqual(phone.map(item => [item.id, item.detail?.length, item.hasDetail]), [['t1', undefined, true], ['t2', 6, undefined], ['a', undefined, true], ['b', undefined, undefined], ['c', 3, undefined], ['d', 5, undefined], ['e', 4097, undefined]]);
});

test('/runs and the snapshot\'s runs stay small while a turn streams a lot of tool output, and /runs answers 304 when unchanged', async t => {
  const agent = scriptedAgent();
  const { dataDir, project, rpc, request } = await fixture(t, { runtimeOptions: agent.runtimeOptions });
  await rpc('project:open', [project]);
  const chat = Object.values((await (await request('/snapshot?projectPath=' + encodeURIComponent(project))).json()).result.project.state.sessions)[0].id;
  assert.equal((await rpc('chat:send', [{ projectPath: project, sessionId: chat, body: 'go', provider: 'codex', model: 'm', permissionMode: 'ask' }])).status, 200);
  // The message is saved before the turn starts in the background; wait for its agent session.
  for (const start = Date.now(); !agent.sessions[0] && Date.now() - start < 3000; await delay(10));
  const session = agent.sessions[0];
  for (const step of longTurn().steps) {
    session.emit({ type: 'step-started', step: { id: step.id, kind: step.kind, title: step.title } });
    if (step.status === 'done') session.emit({ type: 'step-completed', id: step.id, status: 'done', detail: step.detail });
    else session.emit({ type: 'step-output', id: step.id, text: step.detail });
  }
  const key = `${project}#${chat}`;
  const direct = await connect({ dataDir });
  t.after(() => direct.close());
  let whole;
  for (const start = Date.now(); Date.now() - start < 3000; await delay(20)) {
    whole = (await direct.call('chat:runs')).runs[key];
    if (whole?.steps.length === 300 && whole.steps.at(-1).status === 'done') break;
  }
  assert.equal(whole.steps.length, 300);
  const route = '/runs?projectPath=' + encodeURIComponent(project);
  const response = await request(route);
  const text = await response.text();
  const steps = JSON.parse(text).result.runs[key].steps;
  assert.ok(JSON.stringify(whole).length > 5_000_000);
  assert.ok(text.length < 100_000, `${text.length} bytes`);
  assert.equal(steps.length, 300);
  assert.deepEqual(steps.filter(step => step.detail).map(step => step.id), ['s5', 's10', 's297', 's298', 's299']);
  assert.ok(steps.filter(step => step.detail && step.id !== 's5').every(step => step.detail.length === 4097));
  assert.equal(steps.filter(step => step.hasDetail).length, 295);
  const snapshot = await (await request('/snapshot?projectPath=' + encodeURIComponent(project))).text();
  assert.ok(snapshot.length < 120_000, `${snapshot.length} bytes`);
  assert.deepEqual(JSON.parse(snapshot).result.runs.runs[key].steps.map(step => step.hasDetail), steps.map(step => step.hasDetail), 'the snapshot\'s runs are slimmed the same way');
  const etag = response.headers.get('etag');
  assert.ok(etag);
  const again = await request(route, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), '');
});

test('the phone can change a Chat\'s permission mode, and only to a known one', async t => {
  const { project, rpc } = await fixture(t);
  await rpc('project:open', [project]);
  assert.equal((await rpc('agent:set-permission-mode', [{ chatId: `${project}#1`, mode: 'full' }])).status, 200);
  assert.equal((await rpc('agent:set-permission-mode', [{ chatId: `${project}#1`, mode: 'root' }])).status, 409);
});

// An agent whose events the test sends itself, so each signal can be told apart.
function scriptedAgent() {
  const sessions = [];
  const createSession = (_provider, { emit }) => {
    const session = { closed: false, turnActive: false, nativeId: `scripted-${sessions.length}`, emit,
      async startTurn() { session.turnActive = true; emit({ type: 'session-started', nativeId: session.nativeId }); emit({ type: 'turn-started', turnId: 'turn' }); return { turnId: 'turn' }; },
      respondToPermission: () => false, answerQuestion: () => false,
      async interrupt() { if (session.turnActive) emit({ type: 'turn-cancelled' }); session.turnActive = false; },
      async close() { await session.interrupt(); session.closed = true; } };
    sessions.push(session);
    return session;
  };
  return { sessions, runtimeOptions: { createSession, agentCli: Object.assign(async () => ({ command: '/scripted/codex' }), { invalidate() {} }) } };
}
function openLive(bridge, projectPath, headers, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${bridge.url.replace(/^http/, 'ws')}/live?projectPath=${encodeURIComponent(projectPath)}`, { headers, ...options });
    const messages = [];
    socket.on('message', data => messages.push(JSON.parse(String(data)).type));
    socket.once('open', () => resolve({ socket, messages, closed: new Promise(done => socket.once('close', (code, reason) => done({ code, reason: String(reason) }))) }));
    socket.once('unexpected-response', (_req, res) => { res.resume(); resolve({ status: res.statusCode }); });
    socket.once('error', reject);
  });
}
async function until(check, ms = 3000) {
  for (const start = Date.now(); Date.now() - start < ms; await delay(10)) if (check()) return;
  throw new Error('Timed out');
}

test('the live socket checks the token, Host, Origin and path before upgrading', async t => {
  const { project, bridge, token } = await fixture(t);
  const auth = { authorization: `Bearer ${token}` };
  assert.equal((await openLive(bridge, project, {})).status, 401);
  assert.equal((await openLive(bridge, project, { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await openLive(bridge, project, { ...auth, origin: 'https://evil.example' })).status, 403);
  assert.equal((await openLive(bridge, project, { ...auth, host: 'evil.example' })).status, 403);
  assert.equal((await openLive(bridge, 'relative/path', auth)).status, 400);
  const elsewhere = await new Promise(resolve => {
    const socket = new WebSocket(`${bridge.url.replace(/^http/, 'ws')}/snapshot`, { headers: auth });
    socket.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); });
  });
  assert.equal(elsewhere, 404);
  // React Native always sends an Origin; the app's own is the one accepted.
  const phone = await openLive(bridge, project, { ...auth, origin: 'milagre-app://phone' });
  assert.equal(phone.socket.readyState, WebSocket.OPEN);
  const bare = await openLive(bridge, project, auth);
  assert.equal(bare.socket.readyState, WebSocket.OPEN);
  // A plain request to the socket's path is not an endpoint.
  assert.equal((await fetch(bridge.url + '/live?projectPath=' + encodeURIComponent(project), { headers: auth })).status, 404);
  await bridge.close();
  assert.equal((await phone.closed).code, 1001);
  assert.equal((await bare.closed).code, 1001);
});

test('a live socket signals runs and state changes of its Project only, and /runs returns that Project\'s turns', async t => {
  const agent = scriptedAgent();
  const { project, bridge, rpc, request, token } = await fixture(t, { runtimeOptions: agent.runtimeOptions });
  const other = project + '-other';
  await fs.mkdir(other);
  execFileSync('git', ['init', '-b', 'main', other], { stdio: 'ignore' });
  const chatOf = async path => {
    await rpc('project:open', [path]);
    return Object.values((await (await request('/snapshot?projectPath=' + encodeURIComponent(path))).json()).result.project.state.sessions)[0].id;
  };
  const [chat, otherChat] = [await chatOf(project), await chatOf(other)];
  const auth = { authorization: `Bearer ${token}` };
  const mine = await openLive(bridge, project, auth);
  const theirs = await openLive(bridge, other, auth);

  // A state change elsewhere reaches only that Project's socket.
  await rpc('chat:patch', [other, otherChat, { title: 'Elsewhere' }]);
  await until(() => theirs.messages.includes('project'));
  await delay(500);
  assert.deepEqual(mine.messages, []);
  await rpc('chat:patch', [project, chat, { title: 'Here' }]);
  await until(() => mine.messages.length);
  assert.deepEqual(mine.messages, ['project']);

  // Sending saves the user's message (a Project change) and starts a run.
  const send = (path, sessionId) => rpc('chat:send', [{ projectPath: path, sessionId, body: 'hello', provider: 'codex', model: 'm', permissionMode: 'ask' }]);
  assert.equal((await send(project, chat)).status, 200);
  await until(() => mine.messages.length === 2);
  await delay(300);
  assert.deepEqual(mine.messages, ['project', 'project']);
  // Streamed text is a burst of run events: one "runs" signal per window, and nothing for the other Project.
  const theirCount = theirs.messages.length;
  const session = agent.sessions[0];
  for (let i = 0; i < 5; i++) session.emit({ type: 'text-delta', text: `part ${i} ` });
  await until(() => mine.messages.length === 3);
  await delay(300);
  assert.deepEqual(mine.messages.slice(2), ['runs']);
  assert.equal(theirs.messages.length, theirCount);

  const runs = await (await request('/runs?projectPath=' + encodeURIComponent(project))).json();
  assert.match(runs.result.runs[`${project}#${chat}`].text, /part 4/);
  assert.ok(Number.isInteger(runs.result.seq));
  assert.deepEqual((await (await request('/runs?projectPath=' + encodeURIComponent(other))).json()).result.runs, {});
  assert.deepEqual(Object.keys((await (await request('/snapshot?projectPath=' + encodeURIComponent(other))).json()).result.runs.runs), [], 'snapshots carry their own Project\'s turns only');
  assert.equal((await request('/runs?projectPath=relative')).status, 400);
  assert.equal((await fetch(bridge.url + '/runs?projectPath=' + encodeURIComponent(project))).status, 401);

  // The turn's end saves its reply: one prompt "project" signal, so the reply never disappears between fetches.
  const started = Date.now();
  session.turnActive = false;
  session.emit({ type: 'turn-completed' });
  await until(() => mine.messages.length === 4);
  assert.equal(mine.messages[3], 'project');
  assert.ok(Date.now() - started < 400, 'a turn\'s end is not held back like other Project changes');
  assert.deepEqual((await (await request('/runs?projectPath=' + encodeURIComponent(project))).json()).result.runs, {});
});

test('live sockets are pinged, capped, and the oldest gives way to a new one', async t => {
  const { project, bridge, token } = await fixture(t, { bridgeOptions: { pingMs: 40 } });
  const auth = { authorization: `Bearer ${token}` };
  const sockets = [];
  for (let i = 0; i < 8; i++) sockets.push(await openLive(bridge, project, auth));
  await until(() => sockets[0].messages.includes('ping'));
  // A socket that stops answering pings is ended.
  const silent = await openLive(bridge, project, auth, { autoPong: false });
  assert.equal((await sockets[0].closed).code, 1013, 'the oldest socket made room');
  assert.equal(sockets[1].socket.readyState, WebSocket.OPEN);
  assert.equal((await silent.closed).code, 1006);
  assert.equal(sockets[1].socket.readyState, WebSocket.OPEN);
});

test('a Project over 16 MB reaches the phone: its snapshot, tool output on demand, and the signal at a turn\'s end', async t => {
  const agent = scriptedAgent();
  const { project, bridge, rpc, request, token } = await fixture(t, { runtimeOptions: agent.runtimeOptions });
  const messages = Array.from({ length: 900 }, (_, index) => ({ id: 10 + index, session_id: 2, body: `Reply ${index}`, context: null, role: 'assistant',
    steps: [{ id: `step-${index}`, kind: 'shell', title: 'Ran `npm test`', status: 'done', detail: `${index} `.padEnd(20_000, 'output line\n') }] }));
  await fs.mkdir(path.join(project, '.milagre'));
  await fs.writeFile(path.join(project, '.milagre/coordination.json'), JSON.stringify({ next_id: 5000, projects: { 1: { id: 1, name: 'project' } },
    worktrees: { 1: { id: 1, project_id: 1, path: project, name: 'main' } }, sessions: { 2: { id: 2, worktree_id: 1, agent_name: 'main', status: 'Created', provider: 'codex', title: 'Long chat' } }, messages, tasks: {} }));
  assert.equal((await rpc('project:open', [project])).status, 200);
  // The daemon reads the whole state in pages; the phone gets it without tool output, and asks for one message's.
  const snapshot = (await (await request('/snapshot?projectPath=' + encodeURIComponent(project))).json()).result;
  assert.equal(snapshot.project.state.messages.length, 900);
  assert.equal(snapshot.project.state.messages[0].steps[0].hasDetail, true);
  const message = (await (await request(`/message?projectPath=${encodeURIComponent(project)}&id=10`)).json()).result;
  assert.equal(message.steps[0].detail.length, 20_000);
  // The daemon leaves a state this size out of agent events; a turn's end still signals a prompt snapshot.
  const live = await openLive(bridge, project, { authorization: `Bearer ${token}` });
  assert.equal((await rpc('chat:send', [{ projectPath: project, sessionId: 2, body: 'one more', provider: 'codex', model: 'm', permissionMode: 'ask' }])).status, 200);
  await until(() => live.messages.includes('project'));
  await delay(500);
  const before = live.messages.length;
  agent.sessions[0].turnActive = false;
  agent.sessions[0].emit({ type: 'turn-completed' });
  await until(() => live.messages.length > before);
  assert.equal(live.messages.at(-1), 'project');
});

test('push registration is authenticated, validated and removable through mobile RPC', async t => {
  const { rpc, bridge } = await fixture(t);
  const device = { deviceId: 'b6e2df4b-972b-4e7b-bc65-6cda0a173798', token: 'ExpoPushToken[test]', hostId: bridge.url, notifyWhenWaiting: true, notifyOnCompletion: true };
  assert.equal((await rpc('push:register', [device])).status, 200);
  assert.equal((await rpc('push:register', [{ ...device, token: 'secret' }])).status, 409);
  assert.equal((await rpc('push:focus', [{ deviceId: device.deviceId, chatId: '/project#1' }])).status, 200);
  assert.equal((await rpc('push:unregister', [{ deviceId: device.deviceId }])).status, 200);
  assert.equal((await rpc('push:focus', [{ deviceId: device.deviceId, chatId: null }])).status, 409);
  assert.equal((await fetch(bridge.url + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, method: 'push:register', args: [device] }) })).status, 401);
});
