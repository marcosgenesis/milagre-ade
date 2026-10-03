import { test } from 'node:test';
import assert from 'node:assert/strict';
test('state reconciliation keeps unchanged messages and steps by id across edits and reordering', async () => {
 const { reconcileState } = await import('./reconcile.mjs');
 const prior = { sessions: {1:{id:1,title:'Chat'}},messages:[{id:1,body:'first',steps:[{id:'s',detail:'output'}]},{id:2,body:'second'}] };
 const same=structuredClone(prior);assert.equal(reconcileState(prior,same),prior);
 const next=structuredClone(prior); next.messages.reverse();next.messages[0].body='changed';
 const actual=reconcileState(prior,next);assert.equal(actual.messages[1],prior.messages[0]);assert.notEqual(actual.messages[0],prior.messages[1]);assert.equal(actual.sessions,prior.sessions);
 const updated=structuredClone(prior);updated.messages[0].body='edited';const changed=reconcileState(prior,updated);
 assert.equal(changed.messages[0].steps,prior.messages[0].steps);
 assert.equal(reconcileState(prior,{...same,messages:[]}).messages.length,0);
});
