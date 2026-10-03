const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startMobileHost } = require('./mobile-host.cjs');
const { connect } = require('../apps/daemon/src/client.cjs');

test('persistent host keeps its token and saved Chat across restart with private files', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-mobile-host-')));
  t.after(async () => { await host?.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = path.join(root, 'Project');
  await fs.mkdir(project);
  execFileSync('git', ['init', '-b', 'main', project], { stdio: 'ignore' });
  const dataDir = path.join(root, 'profile');
  let host = await startMobileHost({ dataDir, project, port: 0, runtimeOptions: { titleModels: {} } });
  const details = JSON.parse(await fs.readFile(host.connectionFile, 'utf8'));
  assert.equal((await fs.stat(host.connectionFile)).mode & 0o777, 0o600);
  const socket = await connect({ dataDir });
  const opened = await socket.call('project:open', [project]);
  const chat = Object.values(opened.state.sessions)[0];
  await socket.call('chat:git-note', [`${project}#${chat.id}`, 'Saved before restart']);
  socket.close();
  await host.close();
  await assert.rejects(fs.stat(path.join(dataDir, 'runtime.lock')), { code: 'ENOENT' });
  host = await startMobileHost({ dataDir, port: 0, runtimeOptions: { titleModels: {} } });
  const next = JSON.parse(await fs.readFile(host.connectionFile, 'utf8'));
  assert.equal(next.token, details.token);
  const { createClient } = await import('../apps/mobile/src/client.ts');
  const mobile = createClient(next.url, next.token);
  const reopened = await mobile.call('project:open', [project]);
  assert.equal(reopened.state.messages.at(-1).body, 'Saved before restart');
  await assert.rejects(startMobileHost({ dataDir, port: 0 }), /owned/);
});

test('host refuses an unsafe token file and releases ownership on failed startup', async t => {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-mobile-host-')));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'mobile-connection.json'), JSON.stringify({ url: 'http://127.0.0.1:8787', token: 'a'.repeat(64) }), { mode: 0o644 });
  await assert.rejects(startMobileHost({ dataDir, port: 0 }), /private|permissions/);
  await assert.rejects(fs.stat(path.join(dataDir, 'runtime.lock')), { code: 'ENOENT' });
});
