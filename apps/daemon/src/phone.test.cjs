const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createPhone, LOCAL_PORT } = require('./phone.cjs');
const { createPhones } = require('./relay-identity.cjs');

const PAIRING_WINDOW_MS = 10 * 60 * 1000;

const ACCESS = { id: `${'a'.repeat(32)}.access`, secret: 'b'.repeat(40) };

async function waitFor(read) {
  for (let i = 0; i < 400; i++) { const value = await read(); if (value) return value; await delay(5); }
  throw new Error('Timed out waiting for the phone');
}

/** A bridge and tunnel that only record what the phone asks of them. */
async function fixture(t, { cloudflare = false, failBridge, failTunnel, retryDelaysMs = [1, 1, 1], clock = { now: 0 } } = {}) {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-phone-')));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  if (cloudflare) await fs.writeFile(path.join(dataDir, 'cloudflare.json'), JSON.stringify({ hostname: 'mac.example.com', port: 8801, connectorToken: 'connector', access: ACCESS }), { mode: 0o600 });
  const log = [];
  const bridges = [];
  const startBridge = async ({ dataDir: dir, port, token }) => {
    assert.equal(dir, dataDir);
    if (failBridge?.()) throw new Error('Address already in use');
    let lose;
    const lost = new Promise(resolve => { lose = resolve; });
    const bridge = { url: `http://127.0.0.1:${port}`, port, token, lose, lost, closed: false, close: async () => { bridge.closed = true; log.push(`bridge:close:${bridges.indexOf(bridge)}`); lose(); } };
    bridges.push(bridge);
    log.push(`bridge:start:${port}`);
    return bridge;
  };
  const tunnelsStarted = [];
  const tunnels = { startNamedTunnel: async options => {
    if (failTunnel?.()) throw new Error('cloudflared is not installed.');
    const tunnel = { url: `https://${options.hostname}`, options, closed: false, close: async () => { tunnel.closed = true; log.push('tunnel:close'); } };
    tunnelsStarted.push(tunnel);
    log.push('tunnel:start');
    return tunnel;
  } };
  const relays = [];
  const startRelay = options => {
    const relay = { options, closed: false, state: 'connecting', status: () => relay.state, close: async () => { relay.closed = true; log.push('relay:close'); } };
    relays.push(relay);
    log.push('relay:start');
    return relay;
  };
  const changes = [];
  const create = () => createPhone({ dataDir, tunnels, startBridge, startRelay, now: () => clock.now, retryDelaysMs, name: () => 'Test Mac', onChange: status => changes.push(status.state) });
  const phone = create();
  t.after(() => phone.close());
  return { dataDir, phone, create, log, bridges, tunnelsStarted, relays, clock, changes, file: path.join(dataDir, 'mobile.json') };
}

test('a phone that was never enabled is off and starts nothing', async t => {
  const { phone, log, file } = await fixture(t);
  await phone.start();
  await phone.settled();
  assert.deepEqual(phone.status(), { enabled: false, state: 'off', remote: 'none' });
  assert.deepEqual(log, []);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});

test('without a tunnel the phone pairs through the relay', async t => {
  const { phone, log, bridges, tunnelsStarted, relays, changes } = await fixture(t);
  const started = await phone.setEnabled(true);
  assert.equal(started.state, 'starting');
  await phone.settled();
  const status = phone.status();
  assert.equal(status.enabled, true);
  assert.equal(status.state, 'on');
  assert.equal(status.remote, 'relay');
  assert.equal(status.relay, 'connecting');
  assert.equal(status.pairingUntil, PAIRING_WINDOW_MS);
  assert.equal(status.localUrl, `http://127.0.0.1:${LOCAL_PORT}`);
  assert.equal(status.publicUrl, undefined);
  assert.match(status.pairingLink, /^milagre:\/\/pair\?relay=wss%3A%2F%2Frelay\.milagre\.cloud&host=[A-Za-z0-9_-]{22}&key=[A-Za-z0-9_-]{43}&token=[a-f0-9]{64}&name=Test%20Mac$/);
  assert.equal(new URL(status.pairingLink).searchParams.get('token'), bridges[0].token);
  assert.match(status.qrSvg, /^<svg[^>]*viewBox=/);
  assert.equal(relays.length, 1);
  assert.equal(relays[0].options.relayUrl, 'wss://relay.milagre.cloud');
  assert.equal(relays[0].options.bridgeUrl, `http://127.0.0.1:${LOCAL_PORT}`);
  assert.equal(relays[0].options.token, bridges[0].token);
  assert.equal(new URL(status.pairingLink).searchParams.get('host'), relays[0].options.identity.hostId);
  assert.deepEqual(log, [`bridge:start:${LOCAL_PORT}`, 'relay:start']);
  assert.equal(tunnelsStarted.length, 0);
  relays[0].state = 'online';
  relays[0].options.onStatus('online');
  assert.equal(phone.status().relay, 'online');
  assert.deepEqual(changes, ['starting', 'on', 'on']);
});

test('the pairing window closes after 10 minutes and opens again on openPairing', async t => {
  const { phone, relays, clock } = await fixture(t);
  await phone.setEnabled(true);
  await phone.settled();
  const { canPair } = relays[0].options;
  assert.equal(canPair(), true);
  clock.now = PAIRING_WINDOW_MS - 1;
  assert.equal(canPair(), true);
  clock.now = PAIRING_WINDOW_MS + 1;
  assert.equal(canPair(), false);
  assert.equal(phone.status().pairingUntil, PAIRING_WINDOW_MS);
  const reopened = await phone.openPairing();
  assert.equal(canPair(), true);
  assert.equal(reopened.pairingUntil, PAIRING_WINDOW_MS + 1 + PAIRING_WINDOW_MS);
  assert.equal(phone.status().pairingUntil, reopened.pairingUntil);
});

test('openPairing while the phone is off opens nothing', async t => {
  const { phone, clock } = await fixture(t);
  clock.now = 5;
  assert.deepEqual(await phone.openPairing(), { enabled: false, state: 'off', remote: 'none' });
});

test('reset opens the pairing window again and forgets relay phones', async t => {
  const { phone, dataDir, relays, clock } = await fixture(t);
  await phone.setEnabled(true);
  await phone.settled();
  const phones = createPhones(dataDir);
  await phones.add('phoneA');
  clock.now = PAIRING_WINDOW_MS * 3;
  assert.equal(relays[0].options.canPair(), false);
  await phone.reset();
  await phone.settled();
  const after = createPhones(dataDir);
  await after.load();
  assert.equal(after.isKnown('phoneA'), false);
  assert.equal(relays.length, 2);
  assert.equal(relays[0].closed, true);
  assert.equal(relays[1].options.canPair(), true);
  assert.equal(relays[1].options.token, JSON.parse(await fs.readFile(path.join(dataDir, 'mobile.json'), 'utf8')).token);
});

test('reset closes the old relay host before it changes the token, the phones or the pairing window', async t => {
  const { phone, dataDir, relays, clock, file } = await fixture(t);
  await createPhones(dataDir).add('phoneA');
  await phone.setEnabled(true);
  await phone.settled();
  const old = relays[0];
  const oldToken = JSON.parse(await fs.readFile(file, 'utf8')).token;
  clock.now = PAIRING_WINDOW_MS * 3;
  const seen = {};
  old.close = async () => {
    // A hello still in flight on the old host: it may pair only if the window is open.
    seen.canPair = old.options.canPair();
    seen.knowsPhoneA = old.options.phones.isKnown('phoneA');
    seen.token = JSON.parse(await fs.readFile(file, 'utf8')).token;
    if (old.options.canPair()) await old.options.phones.add('intruder');
    old.closed = true;
  };
  await phone.reset();
  await phone.settled();
  assert.deepEqual(seen, { canPair: false, knowsPhoneA: true, token: oldToken });
  assert.equal(relays.length, 2);
  assert.equal(relays[1].options.phones.isKnown('intruder'), false);
  assert.equal(relays[1].options.phones.isKnown('phoneA'), false);
  const after = createPhones(dataDir);
  await after.load();
  assert.equal(after.isKnown('intruder'), false);
  assert.equal(after.isKnown('phoneA'), false);
});

test('a reset that fails part way leaves no old host running and reports an error', async t => {
  const { phone, dataDir, relays, bridges, file } = await fixture(t);
  await phone.setEnabled(true);
  await phone.settled();
  const oldToken = JSON.parse(await fs.readFile(file, 'utf8')).token;
  // A directory where the phone list lives: clearing it cannot be written.
  await fs.mkdir(path.join(dataDir, 'relay-phones.json'));
  const status = await phone.reset();
  await phone.settled();
  assert.equal(status.state, 'error');
  assert.equal(phone.status().state, 'error');
  assert.equal(phone.status().pairingLink, undefined);
  assert.equal(relays.length, 1);
  assert.equal(relays[0].closed, true);
  assert.equal(bridges.length, 1);
  assert.equal(bridges[0].closed, true);
  assert.notEqual(JSON.parse(await fs.readFile(file, 'utf8')).token, oldToken);
});

test('reset gives the Mac a new relay identity, so the link carries a new host and key', async t => {
  const { phone, relays } = await fixture(t);
  await phone.setEnabled(true);
  await phone.settled();
  const before = new URL(phone.status().pairingLink).searchParams;
  await phone.reset();
  await phone.settled();
  const after = new URL(phone.status().pairingLink).searchParams;
  assert.notEqual(after.get('host'), before.get('host'));
  assert.notEqual(after.get('key'), before.get('key'));
  assert.equal(relays[1].options.identity.hostId, after.get('host'));
  assert.notEqual(relays[1].options.identity.hostId, relays[0].options.identity.hostId);
});

test('reset while off rotates the relay identity too', async t => {
  const { phone, dataDir } = await fixture(t);
  const { readIdentity } = require('./relay-identity.cjs');
  const before = await readIdentity(dataDir);
  await phone.reset();
  assert.notEqual((await readIdentity(dataDir)).hostId, before.hostId);
});

test('reset while off forgets relay phones too', async t => {
  const { phone, dataDir } = await fixture(t);
  await createPhones(dataDir).add('phoneA');
  await phone.reset();
  const after = createPhones(dataDir);
  await after.load();
  assert.equal(after.isKnown('phoneA'), false);
});

test('disabling stops the relay before the bridge', async t => {
  const { phone, log } = await fixture(t);
  await phone.setEnabled(true);
  await phone.settled();
  await phone.setEnabled(false);
  await phone.settled();
  assert.deepEqual(log.slice(2), ['relay:close', 'bridge:close:0']);
  assert.equal(phone.status().relay, 'offline');
});

test('a relay phone that paired before the daemon restarted is still known', async t => {
  const { phone, dataDir, relays } = await fixture(t);
  await createPhones(dataDir).add('phoneA');
  await phone.setEnabled(true);
  await phone.settled();
  assert.equal(relays[0].options.phones.isKnown('phoneA'), true);
});

test('with cloudflare.json the bridge uses its port, a named tunnel runs and the link carries the Access token', async t => {
  const { phone, log, bridges, tunnelsStarted, relays } = await fixture(t, { cloudflare: true });
  await phone.setEnabled(true);
  await phone.settled();
  const status = phone.status();
  assert.equal(status.state, 'on');
  assert.equal(status.remote, 'cloudflare');
  assert.equal(relays.length, 0, 'the relay is not started');
  assert.equal(status.relay, undefined);
  assert.equal(status.pairingUntil, undefined);
  assert.equal(status.publicUrl, 'https://mac.example.com');
  assert.equal(status.localUrl, 'http://127.0.0.1:8801');
  assert.deepEqual(log, ['bridge:start:8801', 'tunnel:start']);
  assert.deepEqual(tunnelsStarted[0].options, { hostname: 'mac.example.com', connectorToken: 'connector' });
  const link = new URL(status.pairingLink);
  assert.equal(link.searchParams.get('address'), 'https://mac.example.com');
  assert.equal(link.searchParams.get('token'), bridges[0].token);
  assert.equal(link.searchParams.get('cfId'), ACCESS.id);
  assert.equal(link.searchParams.get('cfSecret'), ACCESS.secret);
});

test('disabling stops the tunnel before the bridge and keeps the setting off', async t => {
  const { phone, log, bridges, tunnelsStarted, changes, file } = await fixture(t, { cloudflare: true });
  await phone.setEnabled(true);
  await phone.settled();
  const disabled = await phone.setEnabled(false);
  assert.equal(disabled.state, 'off');
  await phone.settled();
  assert.deepEqual(log.slice(2), ['tunnel:close', 'bridge:close:0']);
  assert.equal(tunnelsStarted[0].closed && bridges[0].closed, true);
  assert.deepEqual(phone.status(), { enabled: false, state: 'off', remote: 'cloudflare' });
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).enabled, false);
  assert.deepEqual(changes, ['starting', 'on', 'off']);
});

test('the setting is a private file, written atomically and kept across disable', async t => {
  const { phone, dataDir, file } = await fixture(t);
  await phone.setEnabled(true);
  await phone.settled();
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.enabled, true);
  assert.match(saved.token, /^[a-f0-9]{64}$/);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.deepEqual((await fs.readdir(dataDir)).filter(name => name.includes('.tmp')), []);
  await phone.setEnabled(false);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).token, saved.token);
});

test('an enabled phone starts again when the daemon starts, with the same token', async t => {
  const { phone, create, bridges, file } = await fixture(t);
  await phone.setEnabled(true);
  await phone.settled();
  const token = bridges[0].token;
  await phone.close();
  // close() only stops it: the setting stays on for the next boot.
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).enabled, true);
  const next = create();
  t.after(() => next.close());
  assert.equal(next.status().state, 'off');
  await next.start();
  await next.settled();
  assert.equal(next.status().state, 'on');
  assert.equal(bridges.at(-1).token, token);
  assert.equal(bridges.at(-1).closed, false);
});

test('a phone left disabled stays off at start', async t => {
  const { phone, create, log } = await fixture(t);
  await phone.setEnabled(true);
  await phone.setEnabled(false);
  await phone.settled();
  log.length = 0;
  const next = create();
  await next.start();
  await next.settled();
  assert.equal(next.status().state, 'off');
  assert.deepEqual(log, []);
});

test('reset writes a new token and restarts, so paired phones must scan again', async t => {
  const { phone, bridges, file } = await fixture(t);
  await phone.setEnabled(true);
  await phone.settled();
  const before = JSON.parse(await fs.readFile(file, 'utf8')).token;
  const link = phone.status().pairingLink;
  const reset = await phone.reset();
  assert.equal(reset.state, 'starting');
  await phone.settled();
  const after = JSON.parse(await fs.readFile(file, 'utf8')).token;
  assert.notEqual(after, before);
  assert.equal(bridges.length, 2);
  assert.equal(bridges[0].closed, true);
  assert.equal(bridges[1].token, after);
  assert.equal(phone.status().state, 'on');
  assert.notEqual(phone.status().pairingLink, link);
  assert.match(phone.status().pairingLink, new RegExp(`token=${after}`));
});

test('reset while off only changes the token', async t => {
  const { phone, log, file } = await fixture(t);
  await phone.setEnabled(true);
  await phone.setEnabled(false);
  await phone.settled();
  const before = JSON.parse(await fs.readFile(file, 'utf8')).token;
  log.length = 0;
  assert.equal((await phone.reset()).state, 'off');
  await phone.settled();
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.notEqual(saved.token, before);
  assert.equal(saved.enabled, false);
  assert.deepEqual(log, []);
});

test('a bridge that loses the daemon is started again, tunnel included', async t => {
  const { phone, bridges, tunnelsStarted, changes } = await fixture(t, { cloudflare: true });
  await phone.setEnabled(true);
  await phone.settled();
  bridges[0].lose();
  await waitFor(() => bridges.length === 2 && phone.status().state === 'on');
  assert.equal(tunnelsStarted.length, 2);
  assert.equal(tunnelsStarted[0].closed, true);
  assert.equal(bridges[0].closed, true);
  assert.equal(bridges[1].token, bridges[0].token);
  assert.deepEqual(changes, ['starting', 'on', 'starting', 'on']);
});

test('restarts after a lost bridge are bounded and then end in an error', async t => {
  let fail = false;
  const { phone, bridges } = await fixture(t, { failBridge: () => fail, retryDelaysMs: [1, 1] });
  await phone.setEnabled(true);
  await phone.settled();
  fail = true;
  bridges[0].lose();
  await waitFor(() => phone.status().state === 'error');
  assert.equal(phone.status().error, 'Address already in use');
  assert.equal(phone.status().enabled, true);
  assert.equal(phone.status().pairingLink, undefined);
  assert.equal(bridges.length, 1);
  // Turning it off and on again tries from scratch.
  fail = false;
  await phone.setEnabled(true);
  await phone.settled();
  assert.equal(phone.status().state, 'on');
});

test('a bridge that fails to start is an error state and leaves nothing running', async t => {
  const { phone, bridges, log } = await fixture(t, { failBridge: () => true });
  assert.equal((await phone.setEnabled(true)).state, 'starting');
  await phone.settled();
  assert.deepEqual({ state: phone.status().state, error: phone.status().error }, { state: 'error', error: 'Address already in use' });
  assert.deepEqual(log, []);
  assert.equal(bridges.length, 0);
});

test('a tunnel that fails to start closes the bridge it opened', async t => {
  const { phone, bridges } = await fixture(t, { cloudflare: true, failTunnel: () => true });
  await phone.setEnabled(true);
  await phone.settled();
  assert.equal(phone.status().state, 'error');
  assert.match(phone.status().error, /cloudflared is not installed/);
  assert.equal(bridges[0].closed, true);
});

test('a Cloudflare file with loose permissions is reported instead of falling back to local only', async t => {
  const { phone, dataDir, bridges } = await fixture(t, { cloudflare: true });
  await fs.chmod(path.join(dataDir, 'cloudflare.json'), 0o644);
  await phone.setEnabled(true);
  await phone.settled();
  assert.equal(phone.status().state, 'error');
  assert.match(phone.status().error, /permissions 0600/);
  assert.equal(bridges.length, 0);
});

test('enabling twice does not restart, and quick toggles end in the last choice', async t => {
  const { phone, bridges } = await fixture(t);
  await phone.setEnabled(true);
  await phone.setEnabled(true);
  await phone.settled();
  assert.equal(bridges.length, 1);
  await phone.setEnabled(false);
  await phone.setEnabled(true);
  await phone.setEnabled(false);
  await phone.setEnabled(true);
  await phone.settled();
  assert.equal(phone.status().state, 'on');
  assert.equal(bridges.filter(bridge => !bridge.closed).length, 1);
  await assert.rejects(phone.setEnabled('yes'), /true or false/);
});

test('closing stops the bridge, tunnel and any pending restart', async t => {
  const { phone, bridges, tunnelsStarted } = await fixture(t, { cloudflare: true, retryDelaysMs: [50] });
  await phone.setEnabled(true);
  await phone.settled();
  bridges[0].lose();
  await waitFor(() => phone.status().state === 'starting');
  await phone.close();
  await delay(80);
  assert.equal(bridges.length, 1);
  assert.equal(tunnelsStarted.length, 1);
  assert.equal(tunnelsStarted[0].closed, true);
});
