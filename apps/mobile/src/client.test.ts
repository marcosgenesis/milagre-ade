import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, localEndpoint } from './client.ts';

test('endpoint accepts simulator loopback only and rejects credential/path tricks', () => {
  assert.equal(localEndpoint('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
  assert.equal(localEndpoint('http://10.0.2.2:8787'), 'http://10.0.2.2:8787');
  for (const input of ['https://example.com', 'http://127.0.0.1.evil.com:8787', 'http://user@127.0.0.1', 'http://127.0.0.1/path', 'http://127.0.0.1?token=x']) assert.throws(() => localEndpoint(input), /local simulator/);
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
