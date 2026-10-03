const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readCloudflare, setUpCloudflare } = require('./mobile-cloudflare.cjs');

const ID = `${'a'.repeat(32)}.access`;

/** An in-memory Cloudflare API: just the routes setUpCloudflare uses. */
function fakeCloudflare() {
  const state = { tunnels: [], configs: {}, records: [], services: [], apps: [], policies: {}, calls: [] };
  const fetcher = async (url, { method, headers, body }) => {
    assert.equal(headers.Authorization, 'Bearer api-token');
    const route = url.replace('https://api.cloudflare.com/client/v4/', '');
    const data = body && JSON.parse(body);
    state.calls.push(`${method} ${route.split('?')[0]}`);
    const ok = result => ({ json: async () => ({ success: true, result }) });
    let match;
    if (route.startsWith('zones?name=')) return ok([{ id: 'zone', account: { id: 'acct' } }]);
    if (method === 'GET' && route.startsWith('accounts/acct/cfd_tunnel?')) return ok(state.tunnels);
    if (method === 'POST' && route === 'accounts/acct/cfd_tunnel') { const tunnel = { id: 'tunnel-1', name: data.name }; state.tunnels.push(tunnel); return ok(tunnel); }
    if ((match = /^accounts\/acct\/cfd_tunnel\/(.+)\/configurations$/.exec(route))) { state.configs[match[1]] = data.config; return ok({}); }
    if ((match = /^accounts\/acct\/cfd_tunnel\/(.+)\/token$/.exec(route))) return ok(`connector-for-${match[1]}`);
    if (method === 'GET' && route.startsWith('zones/zone/dns_records?')) return ok(state.records);
    if (method === 'POST' && route === 'zones/zone/dns_records') { state.records.push({ id: 'dns-1', ...data }); return ok({}); }
    if (method === 'PUT' && route.startsWith('zones/zone/dns_records/')) { Object.assign(state.records[0], data); return ok({}); }
    if (method === 'GET' && route === 'accounts/acct/access/service_tokens') return ok(state.services);
    if (method === 'POST' && route === 'accounts/acct/access/service_tokens') { const service = { id: 'svc-1', name: data.name, client_id: ID }; state.services.push(service); return ok({ ...service, client_secret: 'first-secret-'.padEnd(43, 'x') }); }
    if (method === 'POST' && route.endsWith('/rotate')) return ok({ client_secret: 'rotated-secret'.padEnd(43, 'y') });
    if (method === 'GET' && route === 'accounts/acct/access/apps') return ok(state.apps);
    if (method === 'POST' && route === 'accounts/acct/access/apps') { const app = { id: 'app-1', ...data }; state.apps.push(app); return ok(app); }
    if ((match = /^accounts\/acct\/access\/apps\/(.+)\/policies$/.exec(route))) {
      state.policies[match[1]] ??= [];
      if (method === 'POST') state.policies[match[1]].push(data);
      return ok(state.policies[match[1]]);
    }
    throw new Error(`Unexpected ${method} ${route}`);
  };
  return { state, fetcher };
}

test('setup creates the tunnel, DNS, Access app and token once, then reuses them', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-cloudflare-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const cloud = fakeCloudflare();
  const first = await setUpCloudflare({ token: 'api-token', domain: 'example.cloud', dataDir, fetcher: cloud.fetcher });
  assert.equal(first.hostname, 'mac.example.cloud');
  assert.deepEqual(cloud.state.configs['tunnel-1'].ingress[0], { hostname: 'mac.example.cloud', service: 'http://127.0.0.1:8797', originRequest: { httpHostHeader: '127.0.0.1:8797' } });
  assert.deepEqual(cloud.state.records.map(record => [record.name, record.content, record.proxied]), [['mac.example.cloud', 'tunnel-1.cfargotunnel.com', true]]);
  assert.equal(cloud.state.policies['app-1'][0].include[0].service_token.token_id, 'svc-1');
  assert.equal((await fs.stat(first.file)).mode & 0o777, 0o600);
  const saved = await readCloudflare(dataDir);
  assert.deepEqual(saved.access, { id: ID, secret: first.access.secret });
  assert.equal(saved.connectorToken, 'connector-for-tunnel-1');

  await setUpCloudflare({ token: 'api-token', domain: 'example.cloud', dataDir, fetcher: cloud.fetcher });
  assert.equal(cloud.state.tunnels.length, 1);
  assert.equal(cloud.state.records.length, 1);
  assert.equal(cloud.state.policies['app-1'].length, 1);
  assert.equal((await readCloudflare(dataDir)).access.secret, first.access.secret, 'a saved secret is kept, not rotated');
  assert.ok(!cloud.state.calls.some(call => call.endsWith('/rotate')));
});

test('setup rotates the service token when its secret was lost', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-cloudflare-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const cloud = fakeCloudflare();
  await setUpCloudflare({ token: 'api-token', domain: 'example.cloud', dataDir, fetcher: cloud.fetcher });
  await fs.rm(path.join(dataDir, 'cloudflare.json'));
  const again = await setUpCloudflare({ token: 'api-token', domain: 'example.cloud', dataDir, fetcher: cloud.fetcher });
  assert.match(again.access.secret, /^rotated-secret/);
});

test('setup and the host refuse missing or unsafe configuration', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-cloudflare-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await assert.rejects(setUpCloudflare({ domain: 'example.cloud', dataDir }), /CLOUDFLARE_API_TOKEN/);
  await assert.rejects(setUpCloudflare({ token: 'api-token', domain: 'nope', dataDir }), /--domain/);
  await assert.rejects(readCloudflare(dataDir), /mobile:cloudflare/);
  await fs.writeFile(path.join(dataDir, 'cloudflare.json'), JSON.stringify({ hostname: 'mac.example.cloud' }), { mode: 0o644 });
  await assert.rejects(readCloudflare(dataDir), /0600/);
});
