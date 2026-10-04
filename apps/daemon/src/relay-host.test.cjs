const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { WebSocket, WebSocketServer } = require('ws');
const { b64url, boxKeyPair, phoneHello, phoneFinish } = require('@milagre/shared/relay-crypto');
const { createAssembler, fromBase64, splitBody } = require('@milagre/shared/relay-rpc');
const { readIdentity, createPhones } = require('./relay-identity.cjs');
const { startRelayHost } = require('./relay-host.cjs');

const random = n => new Uint8Array(randomBytes(n));
const TOKEN = 'a'.repeat(64);
const LIVE_ORIGIN = 'milagre-app://phone';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

async function until(check, label = 'condition', ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`);
    await sleep(10);
  }
}

/** Plays the Cloudflare Worker: real sockets, the real room logic. */
async function startRelay(t, { autoPong = true, hostBehavior } = {}) {
  const { createRoom } = await import('../../relay/src/room.mjs');
  const rooms = new Map();
  const roomFor = id => { if (!rooms.has(id)) rooms.set(id, createRoom({ id })); return rooms.get(id); };
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true, autoPong });
  const hostSockets = [];
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://relay');
    const id = url.searchParams.get('id');
    wss.handleUpgrade(request, socket, head, ws => {
      const room = roomFor(id);
      const payload = (data, isBinary) => (isBinary ? data : data.toString());
      if (url.pathname === '/v1/host') {
        const index = hostSockets.length;
        hostSockets.push(ws);
        if (hostBehavior?.(ws, index)) return;
        ws.on('message', (data, isBinary) => room.hostMessage(ws, payload(data, isBinary)));
        ws.on('close', () => room.hostClosed(ws));
        room.hostOpened(ws);
      } else {
        ws.on('message', (data, isBinary) => room.phoneMessage(ws, payload(data, isBinary)));
        ws.on('close', () => room.phoneClosed(ws));
        room.phoneOpened(ws);
      }
    });
  });
  const port = await listen(server);
  t.after(() => { for (const client of wss.clients) client.terminate(); server.close(); });
  return { url: `ws://127.0.0.1:${port}`, hostSockets };
}

/** What the Mac's loopback bridge looks like to the relay host. */
async function startFakeBridge(t) {
  const seen = { requests: [], liveHeaders: [], liveOpen: 0, uploads: [] };
  const held = [];
  const authorized = request => request.headers.authorization === `Bearer ${TOKEN}`;
  const server = http.createServer((request, response) => {
    seen.requests.push({ method: request.method, url: request.url, origin: request.headers.origin, host: request.headers.host });
    if (!authorized(request)) { response.writeHead(401).end(); return; }
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      if (request.url === '/rpc') {
        seen.lastBody = Buffer.concat(chunks).toString();
        response.writeHead(200, { 'content-type': 'application/json', etag: '"abc"', 'x-secret': 'no', 'set-cookie': 'a=b' });
        response.end(JSON.stringify({ v: 1, result: 'pong' }));
      } else if (request.url === '/attachments') {
        const body = Buffer.concat(chunks);
        seen.uploads.push({ body, type: request.headers['content-type'] });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ v: 1, result: { size: body.length } }));
      } else if (request.url === '/media') {
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end(Buffer.alloc(600_000, 7));
      } else if (request.url === '/slow') {
        held.push(() => { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('late'); });
      } else response.writeHead(404).end();
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  const lives = [];
  server.on('upgrade', (request, socket, head) => {
    seen.liveHeaders.push({ authorization: request.headers.authorization, origin: request.headers.origin, url: request.url });
    if (!authorized(request) || request.headers.origin !== LIVE_ORIGIN) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => {
      seen.liveOpen += 1;
      lives.push(ws);
      ws.send(JSON.stringify({ v: 1, hello: seen.liveOpen }));
      ws.on('message', data => ws.send(`echo:${data}`));
    });
  });
  const port = await listen(server);
  t.after(() => { for (const client of wss.clients) client.terminate(); server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${port}`, seen, lives, waiting: () => held.length, release: () => { while (held.length) held.shift()(); } };
}

async function startMac(t, { relayUrl, bridgeUrl, canPair = () => false, token = TOKEN, timing, onStatus } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-host-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const identity = await readIdentity(dir);
  const phones = createPhones(dir);
  await phones.load();
  const statuses = [];
  const host = startRelayHost({ relayUrl, identity, phones, token, bridgeUrl, canPair: () => canPair(), timing, onStatus: status => { statuses.push(status); onStatus?.(status); } });
  t.after(() => host.close());
  return { host, identity, phones, dir, statuses };
}

/** A phone speaking the encrypted protocol over a raw relay socket. */
function connectPhone({ relayUrl, identity, token = TOKEN, key = boxKeyPair(random) }) {
  const ws = new WebSocket(`${relayUrl}/v1/phone?id=${identity.hostId}`);
  const inbox = [];
  const waiters = [];
  const closed = new Promise(resolve => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  ws.on('message', data => { const bytes = new Uint8Array(data); const waiter = waiters.shift(); if (waiter) waiter(bytes); else inbox.push(bytes); });
  const nextRaw = (ms = 5000) => new Promise((resolve, reject) => {
    if (inbox.length) return resolve(inbox.shift());
    const timer = setTimeout(() => reject(new Error('Timed out waiting for a frame')), ms);
    waiters.push(bytes => { clearTimeout(timer); resolve(bytes); });
  });
  const phone = {
    ws, key, closed, nextRaw, channel: null,
    opened: new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); }),
    /** Resolves with the channel, or with { error } when the Mac refused the hello. */
    async hello() {
      await phone.opened;
      const { message, ephemeral } = phoneHello({ phone: key, host: identity.box.publicKey, token, random });
      ws.send(message);
      const reply = await nextRaw();
      if (reply[0] === 0x04) return { error: JSON.parse(new TextDecoder().decode(reply.subarray(1))) };
      phone.channel = phoneFinish({ ephemeral, phone: key, host: identity.box.publicKey, reply });
      return { channel: phone.channel };
    },
    send(message) { ws.send(phone.channel.seal(message)); },
    async next(ms) { return phone.channel.open(await nextRaw(ms)); },
    /** Sends a request as `req` parts: the body goes out as base64 chunks, `''` and no more when there is none. */
    request(id, { method = 'GET', path, headers = {}, body }, size) {
      const chunks = body ? splitBody(typeof body === 'string' ? new TextEncoder().encode(body) : body, size) : [''];
      chunks.forEach((chunk, index) => phone.send({ t: 'req', id, method, path, headers, chunk, more: index < chunks.length - 1 }));
    },
    /** Reads messages until a complete response for `id` arrives. */
    async response(id, ms) {
      const assembler = createAssembler();
      for (;;) {
        const message = await phone.next(ms);
        if (message.t !== 'res' || message.id !== id) continue;
        const result = assembler.add(message);
        if (result.done) return { ...result, parts: undefined };
      }
    },
    close() { ws.terminate(); },
  };
  return phone;
}

async function paired(t, options = {}) {
  const relay = options.relay ?? await startRelay(t);
  const bridge = options.bridge ?? await startFakeBridge(t);
  const mac = await startMac(t, { relayUrl: relay.url, bridgeUrl: bridge.url, canPair: () => true, ...options.mac });
  await until(() => mac.host.status() === 'online', 'host online');
  const connect = async () => {
    const phone = connectPhone({ relayUrl: relay.url, identity: mac.identity });
    t.after(() => phone.close());
    const result = await phone.hello();
    assert.ok(result.channel, `hello refused: ${JSON.stringify(result)}`);
    return phone;
  };
  return { relay, bridge, mac, connect };
}

const decode = bytes => new TextDecoder().decode(bytes);

test('a paired phone calls /rpc through the relay', async t => {
  const { bridge, connect } = await paired(t);
  const phone = await connect();
  phone.request(1, { method: 'POST', path: '/rpc', headers: { 'content-type': 'application/json', origin: 'https://evil.example', authorization: 'Bearer nope' }, body: '{"v":1,"method":"daemon:status","args":[]}' });
  const response = await phone.response(1);
  assert.equal(response.status, 200);
  assert.equal(decode(response.body), '{"v":1,"result":"pong"}');
  assert.deepEqual(response.headers, { 'content-type': 'application/json', etag: '"abc"' });
  assert.equal(bridge.seen.lastBody, '{"v":1,"method":"daemon:status","args":[]}');
  const request = bridge.seen.requests.at(-1);
  assert.equal(request.origin, undefined, 'the bridge refuses requests that carry an Origin');
  assert.match(request.host, /^127\.0\.0\.1:\d+$/);
  phone.send({ t: 'ping' });
  assert.deepEqual(await phone.next(), { t: 'pong' });
});

test('a 600 KB media response arrives in 3 chunks and reassembles', async t => {
  const { connect } = await paired(t);
  const phone = await connect();
  phone.request(7, { path: '/media' });
  const parts = [];
  const assembler = createAssembler();
  let result;
  while (!result?.done) {
    const message = await phone.next();
    assert.equal(message.t, 'res');
    parts.push(message);
    result = assembler.add(message);
  }
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map(part => part.more), [true, true, false]);
  assert.equal(fromBase64(parts[0].chunk).length, 262144);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, new Uint8Array(600_000).fill(7));
});

test('an unknown phone with a stale token gets {t:"error",code:"bad-token"} and a close', async t => {
  const { relay, mac } = await paired(t);
  const phone = connectPhone({ relayUrl: relay.url, identity: mac.identity, token: 'b'.repeat(64) });
  t.after(() => phone.close());
  const result = await phone.hello();
  assert.deepEqual(result, { error: { t: 'error', code: 'bad-token' } });
  assert.equal(mac.phones.isKnown(b64url(phone.key.publicKey)), false);
  // The relay forwards the Mac's close frame; the phone socket ends.
  assert.equal((await phone.closed).code, 1000);
});

test('a new phone outside the pairing window gets unknown-phone; inside it, it pairs and is remembered', async t => {
  let open = false;
  const { relay, mac } = await paired(t, { mac: { canPair: () => open } });
  const outside = connectPhone({ relayUrl: relay.url, identity: mac.identity });
  t.after(() => outside.close());
  assert.deepEqual(await outside.hello(), { error: { t: 'error', code: 'unknown-phone' } });
  await outside.closed;

  open = true;
  const key = boxKeyPair(random);
  const inside = connectPhone({ relayUrl: relay.url, identity: mac.identity, key });
  t.after(() => inside.close());
  assert.ok((await inside.hello()).channel);
  inside.send({ t: 'ping' });
  assert.deepEqual(await inside.next(), { t: 'pong' });
  const id = b64url(key.publicKey);
  assert.equal(mac.phones.isKnown(id), true);
  assert.match(await fs.readFile(path.join(mac.dir, 'relay-phones.json'), 'utf8'), new RegExp(id));
  inside.close();

  open = false;
  const again = connectPhone({ relayUrl: relay.url, identity: mac.identity, key });
  t.after(() => again.close());
  assert.ok((await again.hello()).channel, 'a remembered phone needs no pairing window');
});

test('the host reconnects after the relay drops it and phones can connect again', async t => {
  const relay = await startRelay(t);
  const bridge = await startFakeBridge(t);
  const mac = await startMac(t, { relayUrl: relay.url, bridgeUrl: bridge.url, canPair: () => true, timing: { backoff: [20, 40], jitter: false } });
  await until(() => mac.host.status() === 'online', 'host online');
  const first = connectPhone({ relayUrl: relay.url, identity: mac.identity });
  t.after(() => first.close());
  assert.ok((await first.hello()).channel);

  relay.hostSockets.at(-1).terminate();
  await until(() => mac.statuses.includes('offline'), 'host offline');
  await first.closed;
  await until(() => mac.host.status() === 'online' && relay.hostSockets.length === 2, 'host back online');

  const second = connectPhone({ relayUrl: relay.url, identity: mac.identity, key: first.key });
  t.after(() => second.close());
  assert.ok((await second.hello()).channel);
  second.request(1, { method: 'POST', path: '/rpc', body: '{}' });
  assert.equal(decode((await second.response(1)).body), '{"v":1,"result":"pong"}');
});

test('a silent relay is abandoned after the idle timeout and the host dials again', async t => {
  const relay = await startRelay(t, { autoPong: false });
  const bridge = await startFakeBridge(t);
  const mac = await startMac(t, { relayUrl: relay.url, bridgeUrl: bridge.url, timing: { pingMs: 30, idleMs: 150, backoff: [20], jitter: false } });
  await until(() => relay.hostSockets.length >= 2, 'a second dial after the idle drop');
  assert.ok(mac.statuses.includes('offline'));
});

test('live-open forwards the bridge live socket messages, and live-close closes it', async t => {
  const { bridge, connect } = await paired(t);
  const phone = await connect();
  phone.send({ t: 'live-open', id: 3, path: '/live?projectPath=%2Ftmp' });
  assert.deepEqual(await phone.next(), { t: 'live', id: 3, data: '{"v":1,"hello":1}' });
  assert.deepEqual(bridge.seen.liveHeaders.at(-1), { authorization: `Bearer ${TOKEN}`, origin: LIVE_ORIGIN, url: '/live?projectPath=%2Ftmp' });
  phone.send({ t: 'live', id: 3, data: 'hi' });
  assert.deepEqual(await phone.next(), { t: 'live', id: 3, data: 'echo:hi' });

  const closed = new Promise(resolve => bridge.lives[0].on('close', resolve));
  phone.send({ t: 'live-close', id: 3 });
  await closed;

  phone.send({ t: 'live-open', id: 4, path: '/live' });
  assert.equal((await phone.next()).t, 'live');
  bridge.lives[1].close(1001);
  const message = await phone.next();
  assert.equal(message.t, 'live-close');
  assert.equal(message.id, 4);
});

test('a live-open with a path that is not a route is refused', async t => {
  const { bridge, connect } = await paired(t);
  const phone = await connect();
  phone.send({ t: 'live-open', id: 10, path: 'no-slash' });
  assert.deepEqual(await phone.next(), { t: 'live-close', id: 10, code: 1008 });
  assert.equal(bridge.seen.liveOpen, 0);
});

test('a connection is limited to 8 live sockets and 16 requests in flight', async t => {
  const { bridge, connect } = await paired(t);
  const phone = await connect();
  for (let id = 1; id <= 9; id++) phone.send({ t: 'live-open', id, path: '/live' });
  const refused = [];
  const hellos = new Set();
  while (!refused.length || hellos.size < 8) {
    const message = await phone.next();
    if (message.t === 'live-close') refused.push(message);
    else hellos.add(message.id);
  }
  assert.deepEqual(refused, [{ t: 'live-close', id: 9, code: 1013 }]);
  assert.equal(bridge.seen.liveOpen, 8);

  for (let id = 100; id < 117; id++) phone.request(id, { path: '/slow' });
  const over = await phone.response(116);
  assert.equal(over.status, 429);
  assert.equal(decode(over.body), '{"v":1,"error":{"message":"Too many requests"}}');
  await until(() => bridge.waiting() === 16, 'the 16 requests to reach the bridge');
  bridge.release();
  assert.equal((await phone.response(100)).status, 200);
});

test('a bad frame closes only that phone', async t => {
  const { connect } = await paired(t);
  const a = await connect();
  const b = await connect();
  a.ws.send(new Uint8Array(40).fill(3));
  assert.equal((await a.closed).code, 1000);
  b.send({ t: 'ping' });
  assert.deepEqual(await b.next(), { t: 'pong' });
});

test('closing the host closes its phones and stops reconnecting', async t => {
  const { relay, mac, connect } = await paired(t);
  const phone = await connect();
  await mac.host.close();
  await phone.closed;
  await sleep(100);
  assert.equal(relay.hostSockets.length, 1);
  assert.equal(mac.host.status(), 'offline');
});

test('a relay that sends a malformed challenge cannot crash the host, which dials again', async t => {
  const bad = ['!!', 'AAAA', ''];
  const relay = await startRelay(t, { hostBehavior: (ws, index) => index < bad.length && (ws.send(JSON.stringify({ t: 'challenge', nonce: bad[index] })), true) });
  const bridge = await startFakeBridge(t);
  const mac = await startMac(t, { relayUrl: relay.url, bridgeUrl: bridge.url, timing: { backoff: [20], jitter: false } });
  await until(() => mac.host.status() === 'online' && relay.hostSockets.length === bad.length + 1, 'host online after the bad challenges');
});

test('a relay that accepts the socket but never sends a challenge, or never answers the proof, is abandoned', async t => {
  const relay = await startRelay(t, { hostBehavior: (ws, index) => index === 0 || (index === 1 && (ws.send(JSON.stringify({ t: 'challenge', nonce: 'A'.repeat(43) })), true)) });
  const bridge = await startFakeBridge(t);
  const mac = await startMac(t, { relayUrl: relay.url, bridgeUrl: bridge.url, timing: { idleMs: 100, pingMs: 60000, backoff: [20], jitter: false } });
  await until(() => mac.host.status() === 'online' && relay.hostSockets.length === 3, 'host online on the third dial');
});

test('a relay that never answers the upgrade is abandoned at the handshake timeout', async t => {
  const stalled = require('node:net').createServer(socket => { socket.on('error', () => {}); });
  const port = await listen(stalled);
  t.after(() => { stalled.close(); stalled.closeAllConnections?.(); });
  let dials = 0;
  stalled.on('connection', () => { dials += 1; });
  const mac = await startMac(t, { relayUrl: `ws://127.0.0.1:${port}`, bridgeUrl: 'http://127.0.0.1:1', timing: { idleMs: 100, backoff: [20], jitter: false } });
  await until(() => dials >= 2, 'a second dial after the handshake timeout');
  assert.ok(mac.statuses.includes('offline'));
});

test('a 3 MB upload split into 256 KiB chunks reaches the bridge byte for byte', async t => {
  const { bridge, connect } = await paired(t);
  const phone = await connect();
  const body = new Uint8Array(randomBytes(3_000_000));
  phone.request(5, { method: 'POST', path: '/attachments', headers: { 'content-type': 'application/octet-stream' }, body });
  const response = await phone.response(5);
  assert.equal(response.status, 200);
  assert.equal(decode(response.body), '{"v":1,"result":{"size":3000000}}');
  assert.equal(bridge.seen.uploads.length, 1);
  assert.equal(bridge.seen.uploads[0].type, 'application/octet-stream');
  assert.deepEqual(new Uint8Array(bridge.seen.uploads[0].body), body);
});

test('an upload over 8 MiB is refused with 413 and the connection stays usable', async t => {
  const { bridge, connect } = await paired(t);
  const phone = await connect();
  phone.request(6, { method: 'POST', path: '/attachments', body: new Uint8Array(9 * 1024 * 1024) });
  const response = await phone.response(6);
  assert.equal(response.status, 413);
  assert.equal(decode(response.body), '{"v":1,"error":{"message":"Upload too large"}}');
  assert.equal(bridge.seen.uploads.length, 0);
  phone.request(7, { method: 'POST', path: '/rpc', body: '{}' });
  assert.equal(decode((await phone.response(7)).body), '{"v":1,"result":"pong"}');
});

test('a GET with an empty chunk and an invalid part both behave', async t => {
  const { connect } = await paired(t);
  const phone = await connect();
  phone.send({ t: 'req', id: 1, method: 'GET', path: '/media', headers: {}, chunk: '', more: false });
  assert.equal((await phone.response(1)).status, 200);
  phone.send({ t: 'req', id: 2, method: 'POST', path: '/attachments', headers: {}, chunk: '***', more: false });
  assert.equal((await phone.closed).code, 1000);
});

test('a phone that never completes its hello is closed at the hello deadline; a paired one stays', async t => {
  const { relay, mac, connect } = await paired(t, { mac: { timing: { helloMs: 150 } } });
  const good = await connect();
  const silent = connectPhone({ relayUrl: relay.url, identity: mac.identity });
  t.after(() => silent.close());
  await silent.opened;
  const started = Date.now();
  const closed = await Promise.race([silent.closed, sleep(3000).then(() => null)]);
  assert.ok(closed, 'the silent phone was never closed');
  assert.equal(closed.code, 1000);
  assert.equal(closed.reason, 'closed-by-host');
  assert.ok(Date.now() - started >= 100, 'closed before the deadline');
  await sleep(200);
  good.send({ t: 'ping' });
  assert.deepEqual(await good.next(), { t: 'pong' });
});

/** A relay that answers the proof with ready and then does `after(ws)`: a stand-in for a flapping or replacing relay. */
function scriptedRelay(t, plan) {
  const dials = [], closes = [];
  return startRelay(t, {
    hostBehavior: (ws, index) => {
      dials.push(Date.now());
      ws.on('close', () => closes.push(Date.now()));
      const step = plan(index);
      if (!step) return false;
      ws.send(JSON.stringify({ t: 'challenge', nonce: b64url(random(32)) }));
      ws.once('message', () => { ws.send(JSON.stringify({ t: 'ready' })); step(ws); });
      return true;
    },
  }).then(relay => ({ ...relay, dials, closes }));
}

test('a host closed as replaced (4409) waits replacedMs before dialing again; other closes keep the short backoff', async t => {
  const bridge = await startFakeBridge(t);
  for (const [code, slow] of [[4409, true], [1011, false]]) {
    const relay = await scriptedRelay(t, index => index === 0 && (ws => ws.close(code, 'bye')));
    const mac = await startMac(t, { relayUrl: relay.url, bridgeUrl: bridge.url, timing: { backoff: [20], replacedMs: 400, jitter: false } });
    await until(() => mac.host.status() === 'online' && relay.dials.length === 2, `back online after ${code}`);
    const gap = relay.dials[1] - relay.closes[0];
    if (slow) assert.ok(gap >= 380, `after 4409 the host waited ${gap} ms`);
    else assert.ok(gap < 300, `after ${code} the host waited only ${gap} ms`);
    await mac.host.close();
  }
});

test('the 4409 wait is jittered but never shorter than replacedMs', async t => {
  const bridge = await startFakeBridge(t);
  const relay = await scriptedRelay(t, index => index === 0 && (ws => ws.close(4409, 'replaced')));
  const mac = await startMac(t, { relayUrl: relay.url, bridgeUrl: bridge.url, timing: { backoff: [20], replacedMs: 300, jitter: true } });
  await until(() => mac.host.status() === 'online' && relay.dials.length === 2, 'back online');
  const gap = relay.dials[1] - relay.closes[0];
  assert.ok(gap >= 280 && gap < 300 * 1.4 + 150, `waited ${gap} ms`);
});

test('a relay that drops the host right after ready keeps backing off: ready alone does not reset the backoff', async t => {
  const bridge = await startFakeBridge(t);
  const relay = await scriptedRelay(t, index => index < 3 && (ws => setTimeout(() => ws.close(1011), 10)));
  const mac = await startMac(t, { relayUrl: relay.url, bridgeUrl: bridge.url, timing: { backoff: [20, 150, 400], stableMs: 10_000, jitter: false } });
  await until(() => mac.host.status() === 'online' && relay.dials.length === 4, 'the fourth dial', 8000);
  const gaps = [0, 1, 2].map(i => relay.dials[i + 1] - relay.closes[i]);
  assert.ok(gaps[1] >= 140 && gaps[2] >= 380, `gaps grew: ${gaps.join(', ')} ms`);
});

test('a session that stays up for stableMs resets the backoff', async t => {
  const bridge = await startFakeBridge(t);
  // First session flaps (attempt 1), the second stays up past stableMs and then drops.
  const relay = await scriptedRelay(t, index => index === 0 ? (ws => setTimeout(() => ws.close(1011), 10)) : index === 1 ? (ws => setTimeout(() => ws.close(1011), 250)) : null);
  const mac = await startMac(t, { relayUrl: relay.url, bridgeUrl: bridge.url, timing: { backoff: [20, 600], stableMs: 100, jitter: false } });
  await until(() => mac.host.status() === 'online' && relay.dials.length === 3, 'the third dial');
  const gap = relay.dials[2] - relay.closes[1];
  assert.ok(gap < 300, `after a stable session the host redialed in ${gap} ms`);
});

test('a 4409 before ready keeps the short backoff: a replaced pending socket is no sign of a twin Mac', async t => {
  const bridge = await startFakeBridge(t);
  const dials = [], closes = [];
  // Anyone who knows the hostId can open pending sockets and knock the Mac's pending one off with 4409.
  const relay = await startRelay(t, {
    hostBehavior: (ws, index) => {
      dials.push(Date.now());
      ws.on('close', () => closes.push(Date.now()));
      if (index > 0) return false;
      ws.send(JSON.stringify({ t: 'challenge', nonce: b64url(random(32)) }));
      ws.once('message', () => ws.close(4409, 'replaced'));
      return true;
    },
  });
  const mac = await startMac(t, { relayUrl: relay.url, bridgeUrl: bridge.url, timing: { backoff: [20], replacedMs: 400, jitter: false } });
  await until(() => mac.host.status() === 'online' && dials.length === 2, 'back online');
  const gap = dials[1] - closes[0];
  assert.ok(gap < 300, `a pending 4409 waited only ${gap} ms`);
});
