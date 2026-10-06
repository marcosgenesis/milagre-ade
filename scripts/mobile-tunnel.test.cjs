const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { startNamedTunnel, startQuickTunnel } = require('./mobile-tunnel.cjs');

function fakeCloudflared() {
  const calls = [];
  let child;
  const spawn = (binary, args) => {
    calls.push({ binary, args });
    child = Object.assign(new EventEmitter(), { stderr: new PassThrough(), exitCode: null, signalCode: null, killed: [] });
    child.kill = signal => { child.killed.push(signal); child.signalCode = signal; queueMicrotask(() => child.emit('exit', null, signal)); };
    return child;
  };
  return { spawn, calls, child: () => child };
}

test('the quick tunnel resolves with its URL once cloudflared registers a connection', async () => {
  const fake = fakeCloudflared();
  const started = startQuickTunnel({ port: 8787, binary: '/managed/cloudflared', spawn: fake.spawn });
  const { args } = fake.calls[0];
  assert.deepEqual(args, ['tunnel', '--no-autoupdate', '--loglevel', 'info', '--url', 'http://127.0.0.1:8787', '--http-host-header', '127.0.0.1:8787']);
  assert.ok(!args.includes('debug'), 'debug logging would record the token header');
  fake.child().stderr.write('INF |  https://quiet-river-1234.trycloudflare.com  |\n');
  fake.child().stderr.write('INF Registered tunnel connection connIndex=0\n');
  const tunnel = await started;
  assert.equal(tunnel.url, 'https://quiet-river-1234.trycloudflare.com');
  await tunnel.close();
  assert.deepEqual(fake.child().killed, ['SIGTERM']);
});

test('the quick tunnel explains a missing cloudflared and an early exit', async () => {
  const missing = fakeCloudflared();
  const first = startQuickTunnel({ port: 8787, binary: '/managed/cloudflared', spawn: missing.spawn });
  missing.child().emit('error', Object.assign(new Error('spawn cloudflared ENOENT'), { code: 'ENOENT' }));
  await assert.rejects(first, /Restart Milagre/);
  const crash = fakeCloudflared();
  const second = startQuickTunnel({ port: 8787, binary: '/managed/cloudflared', spawn: crash.spawn });
  crash.child().exitCode = 1;
  crash.child().emit('exit', 1, null);
  await assert.rejects(second, /exit 1/);
});

test('the quick tunnel gives up after its timeout and stops cloudflared', async () => {
  const fake = fakeCloudflared();
  const started = startQuickTunnel({ port: 8787, binary: '/managed/cloudflared', spawn: fake.spawn, timeoutMs: 20 });
  fake.child().stderr.write('INF Requesting new quick Tunnel on trycloudflare.com...\n');
  await assert.rejects(started, /within 0 seconds.*Requesting new quick Tunnel/);
  assert.deepEqual(fake.child().killed, ['SIGTERM']);
});

test('the named tunnel runs with its connector token and serves its fixed hostname', async () => {
  const fake = fakeCloudflared();
  const started = startNamedTunnel({ hostname: 'mac.example.cloud', connectorToken: 'connector-token', binary: '/managed/cloudflared', spawn: fake.spawn });
  assert.deepEqual(fake.calls[0].args.slice(-3), ['run', '--token', 'connector-token']);
  fake.child().stderr.write('INF Registered tunnel connection connIndex=0\n');
  const tunnel = await started;
  assert.equal(tunnel.url, 'https://mac.example.cloud');
  await tunnel.close();
});
