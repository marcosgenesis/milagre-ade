import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinkOperations } from './link-operations.ts';

test('a retry after leaving the Link reuses its operation while another scope stays independent', () => {
  const operations = createLinkOperations(); let calls = 0; const makeId = () => String(++calls);
  assert.equal(operations.forSend('mac|link#new', 'body', makeId), '1');
  assert.equal(operations.forSend('mac|other#new', 'body', makeId), '2');
  assert.equal(operations.forSend('mac|link#new', 'body', makeId), '1');
  assert.equal(operations.forSend('mac|link#new', 'changed body', makeId), '3');
  operations.accepted('mac|link#new', '1');
  assert.equal(operations.forSend('mac|link#new', 'changed body', makeId), '3', 'late reply cannot retire a newer draft');
  operations.accepted('mac|link#new', '3');
  assert.equal(operations.forSend('mac|link#new', 'changed body', makeId), '4');
});
