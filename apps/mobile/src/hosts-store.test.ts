import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHostsStore } from './hosts-store.ts';
import { parsePairing } from './pairing.ts';

const token = 'a'.repeat(64);
function storage() {
  const values = new Map<string, string>();
  return { values, getItemAsync: async (key: string) => values.get(key) ?? null, setItemAsync: async (key: string, value: string) => { values.set(key, value); }, deleteItemAsync: async (key: string) => { values.delete(key); } };
}

test('saved computers list newest first and re-pairing replaces the same address', async () => {
  let clock = 1;
  const store = createHostsStore(storage(), () => clock++);
  await store.save({ name: 'MacBook Pro', address: 'https://mac.example.com', token });
  await store.save({ name: 'Studio', address: 'https://studio.example.com', token });
  await store.save({ name: 'MacBook Pro (new token)', address: 'https://mac.example.com/', token: 'b'.repeat(64) });
  const hosts = await store.list();
  assert.deepEqual(hosts.map(host => host.name), ['MacBook Pro (new token)', 'Studio']);
  assert.equal(hosts[0].token, 'b'.repeat(64));
});

test('the single connection saved before multiple computers is migrated', async () => {
  const driver = storage();
  driver.values.set('milagre.connection.v1', JSON.stringify({ address: 'http://127.0.0.1:8787', token }));
  const store = createHostsStore(driver, () => 5);
  assert.deepEqual((await store.list()).map(host => host.address), ['http://127.0.0.1:8787']);
  await store.rename('http://127.0.0.1:8787', 'Simulator host');
  assert.equal(driver.values.has('milagre.connection.v1'), false);
  assert.equal((await store.list())[0].name, 'Simulator host');
});

test('forget removes only that computer and waits for a pending save', async () => {
  const driver = storage();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store = createHostsStore({ ...driver, setItemAsync: async (key, value) => { await gate; await driver.setItemAsync(key, value); } });
  const saving = store.save({ name: 'Mac', address: 'https://mac.example.com', token });
  const forgetting = store.forget('https://mac.example.com');
  release();
  await Promise.all([saving, forgetting]);
  assert.deepEqual(await store.list(), []);
});

test('remote plaintext addresses and bad tokens are rejected', async () => {
  const store = createHostsStore(storage());
  await assert.rejects(store.save({ name: 'Mac', address: 'http://192.168.0.4:8787', token }), /HTTPS/);
  await assert.rejects(store.save({ name: 'Mac', address: 'https://mac.example.com', token: 'short' }), /token/);
});

test('pairing links from the host QR parse into a computer', () => {
  const link = `milagre://pair?address=${encodeURIComponent('https://mac.example.com')}&token=${token}&name=${encodeURIComponent("Victor's MacBook Pro")}`;
  assert.deepEqual(parsePairing(link), { address: 'https://mac.example.com', token, name: "Victor's MacBook Pro" });
  assert.equal(parsePairing(`milagre://pair?address=${encodeURIComponent('http://127.0.0.1:8787')}&token=${token}`).name, '127.0.0.1');
  assert.equal(parsePairing(`milagre-local://pair?address=${encodeURIComponent('http://127.0.0.1:8787')}&token=${token}`).address, 'http://127.0.0.1:8787');
  assert.throws(() => parsePairing('https://example.com/pair?token=x'), /not a Milagre pairing link/);
  assert.throws(() => parsePairing(`milagre://pair?address=x&token=short`), /valid token/);
});

test('a damaged saved entry is dropped instead of blocking the others and new pairings', async () => {
  const driver = storage();
  const store = createHostsStore(driver, () => 1);
  await store.save({ name: 'Studio', address: 'https://studio.example.com', token });
  const key = [...driver.values.keys()][0];
  driver.values.set(key, JSON.stringify([...JSON.parse(driver.values.get(key)!), { address: 'ftp://bad', token: 'short' }]));
  assert.deepEqual((await store.list()).map(host => host.name), ['Studio']);
  await store.save({ name: 'MacBook Pro', address: 'https://mac.example.com', token });
  assert.equal((await store.list()).length, 2);
});
