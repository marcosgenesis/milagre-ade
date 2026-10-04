const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { WebSocket, WebSocketServer } = require('ws');
const { b64url, boxKeyPair, phoneHello, phoneFinish } = require('@milagre/shared/relay-crypto');
const { createAssembler, fromBase64 } = require('@milagre/shared/relay-rpc');
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
async function startRelay(t, { autoPong = true } = {}) {
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
        hostSockets.push(ws);
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
  const seen = { requests: [], liveHeaders: [], liveOpen: 0 };
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
  phone.send({ t: 'req', id: 1, method: 'POST', path: '/rpc', headers: { 'content-type': 'application/json', origin: 'https://evil.example', authorization: 'Bearer nope' }, body: '{"v":1,"method":"daemon:status","args":[]}' });
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
  phone.send({ t: 'req', id: 7, method: 'GET', path: '/media', headers: {} });
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
  second.send({ t: 'req', id: 1, method: 'POST', path: '/rpc', headers: {}, body: '{}' });
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

  for (let id = 100; id < 117; id++) phone.send({ t: 'req', id, method: 'GET', path: '/slow', headers: {} });
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
