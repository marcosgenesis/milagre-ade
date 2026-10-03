import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionStore } from './connection-store.ts';

const connection = { address: 'https://computer.example.com', token: 'a'.repeat(64) };
function storage() {
  const values = new Map<string, string>();
  return { values, getItemAsync: async (key: string) => values.get(key) ?? null, setItemAsync: async (key: string, value: string) => { values.set(key, value); }, deleteItemAsync: async (key: string) => { values.delete(key); } };
}

test('connection round-trips through secure storage and forget removes it', async () => {
  const driver = storage();
  const store = createConnectionStore(driver);
  assert.equal(await store.load(), null);
  await store.save(connection);
  assert.deepEqual(await store.load(), connection);
  await store.forget();
  assert.equal(await store.load(), null);
  assert.equal(driver.values.size, 0);
});

test('forget waits for a pending save so a late write cannot restore a forgotten token', async () => {
  const driver = storage();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const store = createConnectionStore({ ...driver, setItemAsync: async (key, value) => { await pending; await driver.setItemAsync(key, value); } });
  const saving = store.save(connection);
  const forgetting = store.forget();
  release();
  await Promise.all([saving, forgetting]);
  assert.equal(await store.load(), null);
});

test('invalid stored data is rejected and storage failures do not poison later operations', async () => {
  const driver = storage();
  const store = createConnectionStore(driver);
  await store.save(connection);
  const key = [...driver.values.keys()][0];
  driver.values.set(key, '{broken');
  await assert.rejects(store.load(), /saved connection/);
  await store.forget();
  await assert.rejects(store.save({ address: 'http://remote.example.com', token: connection.token }), /HTTPS/);
  await store.save(connection);
  assert.deepEqual(await store.load(), connection);
});
