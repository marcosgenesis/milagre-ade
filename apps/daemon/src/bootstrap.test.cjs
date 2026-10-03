const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { socketPath, prepareSocketDirectory } = require('./paths.cjs');
const { ensureDaemon } = require('./bootstrap.cjs');

test('two detached starts attach to one daemon and reconnect preserves its PID', async t => {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-bootstrap-')));
  const clients = [];
  t.after(async () => {
    for (const client of clients) { try { await client.call('daemon:stop'); } catch {} client.close(); }
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const options = { dataDir, version: '9.8.7', cwd: dataDir };
  clients.push(...await Promise.all([ensureDaemon(options), ensureDaemon(options)]));
  const [a, b] = await Promise.all(clients.map(client => client.call('daemon:status')));
  assert.equal(a.pid, b.pid);
  assert.notEqual(a.pid, process.pid);
  assert.equal(a.version, '9.8.7');
  clients[0].close();
  const again = await ensureDaemon(options);
  clients.push(again);
  assert.equal((await again.call('daemon:status')).pid, a.pid);
});

test('stale ownership is reported and never silently removed', async t => {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-bootstrap-stale-')));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'runtime.lock'));
  const record = JSON.stringify({ pid: 2147483647, token: 'preserve-me', startedAt: '2000-01-01' });
  await fs.writeFile(path.join(dataDir, 'runtime.lock/owner.json'), record);
  await assert.rejects(ensureDaemon({ dataDir, version: '1', cwd: dataDir, startupTimeoutMs: 300 }), /owned|ownership|start|lock/i);
  assert.equal(await fs.readFile(path.join(dataDir, 'runtime.lock/owner.json'), 'utf8'), record);
});

test('a reachable older daemon is rejected without starting a competing runtime', async t => {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-bootstrap-old-')));
  const socket = socketPath(dataDir); prepareSocketDirectory(socket);
  const server = net.createServer(connection => {
    connection.on('data', data => {
      const request = JSON.parse(String(data));
      connection.write(JSON.stringify({ v: 1, id: request.id, result: { version: 'old', capabilities: ['desktop-v1'], methods: [] } }) + '\n');
    });
  });
  server.listen(socket); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dataDir, { recursive: true, force: true }); });
  await assert.rejects(ensureDaemon({ dataDir, version: 'new', executable: '/never-run' }), { code: 'INCOMPATIBLE_DAEMON' });
  await assert.rejects(fs.stat(path.join(dataDir, 'runtime.lock')), { code: 'ENOENT' });
});
