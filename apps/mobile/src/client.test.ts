import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, localEndpoint, type RelayRuntime } from './client.ts';
import { RelayTransportError, type RelayResponse, type RelayTransport } from './relay-transport.ts';

test('endpoint accepts HTTPS and emulator loopback, rejecting plaintext remote and credential/path tricks', () => {
  assert.equal(localEndpoint('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
  assert.equal(localEndpoint('http://10.0.2.2:8787'), 'http://10.0.2.2:8787');
  assert.equal(localEndpoint('https://my-computer.example.com/'), 'https://my-computer.example.com');
  for (const input of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?token=x', 'http://127.0.0.1.evil.com:8787', 'http://user@127.0.0.1', 'http://127.0.0.1/path', 'http://127.0.0.1?token=x']) assert.throws(() => localEndpoint(input), /HTTPS|address/);
});

test('one send carries token/version and is never retried after a network failure', async () => {
  let calls = 0;
  const client = createClient({ address: 'http://127.0.0.1:8787', token: 'token' }, async (_url, init) => {
    calls++;
    // oxlint-disable-next-line no-unsafe-optional-chaining -- pre-existing, see PR body
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer token');
    assert.deepEqual(JSON.parse(init?.body as string), { v: 1, method: 'chat:send', args: [{ body: 'hello' }] });
    throw new Error('offline');
  });
  await assert.rejects(client.call('chat:send', [{ body: 'hello' }]), /Connection lost.*Check the Chat before sending again/);
  assert.equal(calls, 1);
});

test('errors and incompatible responses are explicit, and timeouts abort the fetch', async () => {
  const response = (body: unknown, status = 200) => createClient({ address: 'http://127.0.0.1:8787', token: 'token' }, async () => new Response(JSON.stringify(body), { status }));
  await assert.rejects(response({ v: 1, error: { message: 'Wrong token' } }, 401).call('daemon:status'), /Wrong token/);
  await assert.rejects(response({ v: 9, result: {} }).call('daemon:status'), /Incompatible/);
  const client = createClient({ address: 'http://127.0.0.1:8787', token: 'token' }, (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))); }), 10);
  await assert.rejects(client.call('daemon:status'), /Connection lost/);
});

test('creating or removing a worktree gets the desktop deadline instead of the normal request timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [method, args] of [['worktree:create', [{ projectPath: '/p', baseBranch: 'main', prompt: 'Preview' }]], ['worktree:remove', ['/wt/x', { force: false }]]] as const) {
    let signal: AbortSignal | null | undefined;
    const client = createClient({ address: 'http://127.0.0.1:8787', token: 'token' }, (_url, init) => new Promise((_resolve, reject) => {
      signal = init?.signal;
      signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const pending = assert.rejects(client.call(method, [...args]), /Connection lost/);
    t.mock.timers.tick(30000);
    assert.equal(signal?.aborted, false, `${method} can still be working after 30 seconds`);
    t.mock.timers.tick(300000);
    assert.equal(signal?.aborted, true);
    await pending;
  }
});


test('HTTPS sends authenticate once, refuse redirects and reject a changed response origin', async () => {
  const client = createClient({ address: 'https://computer.example.com', token: 'private-token' }, async (_url, init) => {
    assert.equal(init?.redirect, 'error');
    // oxlint-disable-next-line no-unsafe-optional-chaining -- pre-existing, see PR body
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer private-token');
    const response = new Response(JSON.stringify({ v: 1, result: {} }));
    Object.defineProperty(response, 'url', { value: 'https://other.example.com/rpc' });
    return response;
  });
  await assert.rejects(client.call('daemon:status'), /redirect/);
});

test('a Cloudflare Access token goes on every request and image, and only over HTTPS', async () => {
  const access = { id: `${'c'.repeat(32)}.access`, secret: 'Secret_with-mixed'.padEnd(43, 'z') };
  let seen: Record<string, string> = {};
  const client = createClient({ address: 'https://mac.example.cloud', token: 'token', access }, async (_url, init) => { seen = init?.headers as Record<string, string>; return new Response(JSON.stringify({ v: 1, result: 'ok' })); }, 30000);
  assert.equal(await client.call('daemon:status'), 'ok');
  assert.equal(seen['CF-Access-Client-Id'], access.id);
  assert.equal(seen['CF-Access-Client-Secret'], access.secret);
  assert.equal(seen.Authorization, 'Bearer token');
  assert.equal(client.media('/p', '/p/a.png').headers['CF-Access-Client-Secret'], access.secret);
  assert.throws(() => createClient({ address: 'http://127.0.0.1:8797', token: 'token', access }, fetch, 30000), /HTTPS/);
});

test('an HTML page from Cloudflare becomes a plain message instead of a JSON parse error', async () => {
  const page = (status: number) => createClient({ address: 'https://mac.example.cloud', token: 'token' }, async () => new Response('<!doctype html><title>Error</title>', { status, headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(page(502).call('daemon:status'), /isn't answering/);
  await assert.rejects(page(530).call('daemon:status'), /isn't answering/);
  await assert.rejects(page(401).call('daemon:status'), /access was refused/);
  await assert.rejects(page(200).call('daemon:status'), /Unexpected response/);
});

test('an unchanged snapshot comes back as a 304 and reuses the last one', async () => {
  const sent: (string | undefined)[] = [];
  let calls = 0;
  const client = createClient({ address: 'http://127.0.0.1:8787', token: 'token' }, async (_url, init) => {
    // oxlint-disable-next-line no-unsafe-optional-chaining -- pre-existing, see PR body
    sent.push((init?.headers as Record<string, string>)['If-None-Match']);
    return ++calls === 1 ? new Response(JSON.stringify({ v: 1, result: { project: 'p' } }), { headers: { etag: '"abc"' } }) : new Response(null, { status: 304, headers: { etag: '"abc"' } });
  });
  const first = await client.snapshot('/p');
  assert.equal(await client.snapshot('/p'), first);
  assert.deepEqual(sent, [undefined, '"abc"']);
});

const hostId = 'H'.repeat(21) + 'g';
const relayHost = { address: `relay://${hostId}`, token: 'a'.repeat(64), relay: { url: 'wss://relay.milagre.cloud', hostId, key: 'K'.repeat(42) + 'A' } };
type Sent = { method: string; path: string; headers: Record<string, string>; body?: Uint8Array | string };
const reply = (value: unknown, status = 200, headers: Record<string, string> = {}): RelayResponse => ({ status, headers, body: new TextEncoder().encode(JSON.stringify(value)) });
function fakeRelay(answer: (sent: Sent) => Promise<RelayResponse> | RelayResponse) {
  const sent: Sent[] = [];
  const lives: { path: string; onData: (data: string) => void; onStatus: (up: boolean) => void; closed: boolean }[] = [];
  const written = new Map<string, Uint8Array>();
  const transport: RelayTransport = {
    request: async (method, path, headers, body) => { const request = { method, path, headers, body }; sent.push(request); return answer(request); },
    live(path, onData, onStatus) { const live = { path, onData, onStatus, closed: false }; lives.push(live); return { close() { live.closed = true; } }; },
    close() {},
  };
  const opened: unknown[] = [];
  const runtime: RelayRuntime = {
    transport: async host => { opened.push(host); return transport; },
    files: { find: async name => written.has(name) ? `file:///cache/relay-media/${name}` : null, write: async (name, bytes) => { written.set(name, bytes); return `file:///cache/relay-media/${name}`; } },
  };
  return { sent, lives, written, opened, runtime };
}

test('a relay host sends its calls through the relay transport and reads the JSON reply', async () => {
  const relay = fakeRelay(() => reply({ v: 1, result: { running: true } }));
  const client = createClient(relayHost, async () => { throw new Error('a relay host never fetches'); }, 30000, relay.runtime);
  assert.equal(client.url, `relay://${hostId}`);
  assert.deepEqual(await client.call('daemon:status'), { running: true });
  assert.equal(relay.sent[0].method, 'POST');
  assert.equal(relay.sent[0].path, '/rpc');
  assert.deepEqual(JSON.parse(String(relay.sent[0].body)), { v: 1, method: 'daemon:status', args: [] });
  assert.equal(relay.sent[0].headers.Authorization, undefined, 'the token rides the handshake, not every request');
  assert.deepEqual(relay.opened[0], { relay: relayHost.relay, token: relayHost.token });
});

test('a relay snapshot answered with 304 reuses the cached one', async () => {
  let calls = 0;
  const relay = fakeRelay(() => ++calls === 1 ? reply({ v: 1, result: { project: 'p' } }, 200, { etag: '"abc"' }) : { status: 304, headers: { etag: '"abc"' }, body: new Uint8Array() });
  const client = createClient(relayHost, fetch, 30000, relay.runtime);
  const first = await client.snapshot('/p');
  assert.equal(await client.snapshot('/p'), first);
  assert.deepEqual(relay.sent.map(sent => [sent.method, sent.headers['If-None-Match']]), [['GET', undefined], ['GET', '"abc"']]);
  assert.equal(relay.sent[0].path, '/snapshot?projectPath=%2Fp');
});

test('a refused relay pairing shows its own copy, and any other failure is a lost connection', async () => {
  const refused = createClient(relayHost, fetch, 30000, fakeRelay(() => { throw new RelayTransportError('bad-token', 'This phone was paired with an older code. Scan the new one in Settings → Phone.'); }).runtime);
  await assert.rejects(refused.call('daemon:status'), /paired with an older code/);
  const broken = createClient(relayHost, fetch, 30000, fakeRelay(() => { throw new Error('socket exploded'); }).runtime);
  await assert.rejects(broken.call('daemon:status'), /Connection lost/);
  const failing = createClient(relayHost, fetch, 30000, fakeRelay(() => reply({ v: 1, error: { message: 'The computer could not be reached' } }, 502)).runtime);
  await assert.rejects(failing.call('daemon:status'), /could not be reached/);
  const locked = createClient(relayHost, fetch, 30000, { ...fakeRelay(() => reply({ v: 1 })).runtime, transport: async () => { throw new Error('Could not read this phone\'s pairing key. Unlock your phone and try again.'); } });
  await assert.rejects(locked.call('daemon:status'), /pairing key/);
});

test('a relay request that never answers times out like a fetch', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = createClient(relayHost, fetch, 30000, fakeRelay(() => new Promise<RelayResponse>(() => {})).runtime);
  const pending = assert.rejects(client.call('daemon:status'), /Connection lost/);
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(30000);
  await pending;
});

test('a relay host is refused without a relay runtime, and its pairing must be well formed', () => {
  assert.throws(() => createClient(relayHost, fetch, 30000), /relay/i);
  assert.throws(() => createClient({ ...relayHost, relay: { ...relayHost.relay, key: 'short' } }, fetch, 30000, fakeRelay(() => reply({ v: 1 })).runtime), /Scan the code again/);
});

test('the live socket of a relay host rides the transport and keeps the same signals', async () => {
  const relay = fakeRelay(() => reply({ v: 1 }));
  const client = createClient(relayHost, fetch, 30000, relay.runtime);
  const signals: string[] = [], statuses: boolean[] = [];
  const live = client.live('/p q', { onSignal: signal => signals.push(signal), onStatus: open => statuses.push(open) });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(relay.lives[0].path, '/live?projectPath=%2Fp%20q');
  relay.lives[0].onStatus(true);
  relay.lives[0].onData('{"type":"runs"}');
  relay.lives[0].onData('{"type":"ping"}');
  relay.lives[0].onData('not json');
  relay.lives[0].onData('{"type":"project"}');
  assert.deepEqual(signals, ['runs', 'project']);
  assert.deepEqual(statuses, [true]);
  live.close();
  assert.equal(relay.lives[0].closed, true);
});

test('a live socket closed before the relay transport is ready never opens', async () => {
  const relay = fakeRelay(() => reply({ v: 1 }));
  const client = createClient(relayHost, fetch, 30000, relay.runtime);
  client.live('/p', { onSignal() {}, onStatus() {} }).close();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(relay.lives.length, 0);
});

test('relay images are fetched once into the cache folder and come back as file URIs', async () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const relay = fakeRelay(async () => { await gate; return { status: 200, headers: { 'content-type': 'image/png' }, body: png }; });
  const client = createClient(relayHost, fetch, 30000, relay.runtime);
  const both = Promise.all([client.mediaFile('/p', '/p/shot.png'), client.mediaFile('/p', '/p/shot.png')]);
  release();
  const [first, second] = await both;
  assert.equal(first, second);
  assert.match(first, /^file:\/\/\/cache\/relay-media\/[a-f0-9]{16}\.png$/);
  assert.equal(relay.sent.length, 1);
  assert.equal(relay.sent[0].method, 'GET');
  assert.equal(relay.sent[0].path, '/media?projectPath=%2Fp&path=%2Fp%2Fshot.png');
  assert.deepEqual([...relay.written.values()], [png]);
  assert.notEqual(await client.mediaFile('/p', '/p/other.png'), first);
  // The same image source each render, so a thumbnail does not reload.
  assert.equal(client.image('/p', '/p/shot.png'), client.image('/p', '/p/shot.png'));
  assert.deepEqual(await client.image('/p', '/p/shot.png'), { uri: first });
  // A new client finds the file already on disk.
  const again = fakeRelay(() => { throw new Error('should not fetch'); });
  again.written.set(first.split('/').pop()!, png);
  assert.equal(await createClient(relayHost, fetch, 30000, again.runtime).mediaFile('/p', '/p/shot.png'), first);
});

test('a relay image that fails to load can be asked for again', async () => {
  let calls = 0;
  const relay = fakeRelay(() => ++calls === 1 ? reply({ v: 1, error: { message: 'Not found' } }, 404) : { status: 200, headers: {}, body: new Uint8Array([1]) });
  const client = createClient(relayHost, fetch, 30000, relay.runtime);
  await assert.rejects(client.mediaFile('/p', '/p/a.jpg'), /image/);
  assert.match(await client.mediaFile('/p', '/p/a.jpg'), /\.jpg$/);
  assert.throws(() => client.media('/p', '/p/a.jpg'), /relay/i);
});

test('an HTTP host keeps its authenticated image URL as the image source', () => {
  const client = createClient({ address: 'https://mac.example.com', token: 'token' }, fetch);
  assert.deepEqual(client.image('/p', '/p/a.png'), client.media('/p', '/p/a.png'));
});

test('relay images load at most 4 at a time, in order, and calls never wait behind them', async () => {
  const held: { path: string; release: () => void }[] = [];
  const relay = fakeRelay(sent => sent.path.startsWith('/media')
    ? new Promise<RelayResponse>(resolve => held.push({ path: sent.path, release: () => resolve({ status: 200, headers: {}, body: new Uint8Array([1]) }) }))
    : reply({ v: 1, result: 'ok' }));
  const client = createClient(relayHost, fetch, 30000, relay.runtime);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const loads = Array.from({ length: 10 }, (_, i) => client.image('/p', `/p/${i}.png`));
  await settle();
  const media = () => relay.sent.filter(sent => sent.path.startsWith('/media')).map(sent => new URLSearchParams(sent.path.split('?')[1]).get('path'));
  assert.deepEqual(media(), ['/p/0.png', '/p/1.png', '/p/2.png', '/p/3.png']);
  assert.equal(await client.call('daemon:status'), 'ok');
  held[0].release();
  await settle();
  assert.deepEqual(media().slice(4), ['/p/4.png']);
  let most = 0;
  while (held.some(item => item.release)) {
    const next = held.find(item => item.release)!;
    const release = next.release;
    next.release = undefined as unknown as () => void;
    release();
    await settle();
    most = Math.max(most, held.filter(item => item.release).length);
  }
  assert.ok(most <= 4, `at most 4 images in flight, saw ${most}`);
  assert.equal((await Promise.all(loads)).length, 10);
  assert.equal(media().length, 10);
});

test('drawer previews use a separate ETag route and accept full snapshots from an older host', async () => {
  const routes: string[] = [];
  const full = { project: { path: '/p' }, runs: { runs: {} } };
  const client = createClient({ address: 'http://127.0.0.1:8787', token: 'token' }, async url => {
    routes.push(String(url));
    return new Response(JSON.stringify({ v: 1, result: full }));
  });
  assert.deepEqual(await client.preview('/p'), full);
  await client.snapshot('/p');
  assert.ok(routes[0].endsWith('/snapshot?projectPath=%2Fp&view=chats'));
  assert.ok(routes[1].endsWith('/snapshot?projectPath=%2Fp'));
});
