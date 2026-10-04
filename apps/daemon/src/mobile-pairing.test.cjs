const test = require('node:test');
const assert = require('node:assert/strict');
const { relayPairingLink } = require('./mobile-pairing.cjs');

const base = { relay: 'wss://relay.milagre.cloud', hostId: 'a'.repeat(22), key: 'b'.repeat(43), token: 'c'.repeat(64), name: 'Test Mac' };

test('the relay link carries the relay origin, host id, host key, token and name', () => {
  assert.equal(relayPairingLink(base), `milagre://pair?relay=wss%3A%2F%2Frelay.milagre.cloud&host=${base.hostId}&key=${base.key}&token=${base.token}&name=Test%20Mac`);
  assert.match(relayPairingLink({ ...base, relay: 'wss://relay.milagre.cloud/some/path?x=1' }), /^milagre:\/\/pair\?relay=wss%3A%2F%2Frelay\.milagre\.cloud&host=/);
});

test('the relay link refuses anything that is not a ws URL, a host id, a key or a token', () => {
  assert.throws(() => relayPairingLink({ ...base, relay: 'nope' }), /URL/);
  assert.throws(() => relayPairingLink({ ...base, relay: 'https://relay.milagre.cloud' }), /ws or wss/);
  assert.throws(() => relayPairingLink({ ...base, hostId: 'short' }), /host id/);
  assert.throws(() => relayPairingLink({ ...base, key: 'short' }), /host key/);
  assert.throws(() => relayPairingLink({ ...base, token: 'short' }), /token/);
});
