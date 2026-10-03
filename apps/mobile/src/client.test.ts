import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, localEndpoint } from './client.ts';

test('endpoint accepts HTTPS and emulator loopback, rejecting plaintext remote and credential/path tricks', () => {
  assert.equal(localEndpoint('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
  assert.equal(localEndpoint('http://10.0.2.2:8787'), 'http://10.0.2.2:8787');
  assert.equal(localEndpoint('https://my-computer.example.com/'), 'https://my-computer.example.com');
  for (const input of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?token=x', 'http://127.0.0.1.evil.com:8787', 'http://user@127.0.0.1', 'http://127.0.0.1/path', 'http://127.0.0.1?token=x']) assert.throws(() => localEndpoint(input), /HTTPS|address/);
});

test('one send carries token/version and is never retried after a network failure', async () => {
  let calls = 0;
  const client = createClient('http://127.0.0.1:8787', 'token', async (_url, init) => {
    calls++;
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer token');
    assert.deepEqual(JSON.parse(init?.body as string), { v: 1, method: 'chat:send', args: [{ body: 'hello' }] });
    throw new Error('offline');
  });
  await assert.rejects(client.call('chat:send', [{ body: 'hello' }]), /Connection lost.*Check the Chat before sending again/);
  assert.equal(calls, 1);
});

test('errors and incompatible responses are explicit, and timeouts abort the fetch', async () => {
  const response = (body: unknown, status = 200) => createClient('http://127.0.0.1:8787', 'token', async () => new Response(JSON.stringify(body), { status }));
  await assert.rejects(response({ v: 1, error: { message: 'Wrong token' } }, 401).call('daemon:status'), /Wrong token/);
  await assert.rejects(response({ v: 9, result: {} }).call('daemon:status'), /Incompatible/);
  const client = createClient('http://127.0.0.1:8787', 'token', (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))); }), 10);
  await assert.rejects(client.call('daemon:status'), /Connection lost/);
});


test('HTTPS sends authenticate once, refuse redirects and reject a changed response origin', async () => {
  const client = createClient('https://computer.example.com', 'private-token', async (_url, init) => {
    assert.equal(init?.redirect, 'error');
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
  const client = createClient('https://mac.example.cloud', 'token', async (_url, init) => { seen = init?.headers as Record<string, string>; return new Response(JSON.stringify({ v: 1, result: 'ok' })); }, 30000, access);
  assert.equal(await client.call('daemon:status'), 'ok');
  assert.equal(seen['CF-Access-Client-Id'], access.id);
  assert.equal(seen['CF-Access-Client-Secret'], access.secret);
  assert.equal(seen.Authorization, 'Bearer token');
  assert.equal(client.media('/p', '/p/a.png').headers['CF-Access-Client-Secret'], access.secret);
  assert.throws(() => createClient('http://127.0.0.1:8797', 'token', fetch, 30000, access), /HTTPS/);
});

test('an HTML page from Cloudflare becomes a plain message instead of a JSON parse error', async () => {
  const page = (status: number) => createClient('https://mac.example.cloud', 'token', async () => new Response('<!doctype html><title>Error</title>', { status, headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(page(502).call('daemon:status'), /isn't answering/);
  await assert.rejects(page(530).call('daemon:status'), /isn't answering/);
  await assert.rejects(page(401).call('daemon:status'), /access was refused/);
  await assert.rejects(page(200).call('daemon:status'), /Unexpected response/);
});
