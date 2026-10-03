import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatIndicator, agentCounts } from './indicators.ts';
import type { AgentRun } from '@milagre/shared/agent-runs';
import type { AgentSession, Subagent } from '@milagre/shared/model';
import { pullRequestBlockers } from '@milagre/shared/pr-blockers';
test('questions and approvals take precedence over running and unread indicators', () => {
  const run = { questions: [{}], approvals: [{}] } as AgentRun;
  assert.equal(chatIndicator({ unread: true } as AgentSession, run).label, 'Asking you');
  run.questions = [];
  assert.equal(chatIndicator(undefined, run).label, 'Waiting for approval');
  run.approvals = [];
  assert.equal(chatIndicator(undefined, run).label, 'Running');
});
test('agent counts exclude archived agents and preserve waiting and failure', () => {
  const agents = ['running', 'initializing', 'waiting', 'failed', 'completed'].map(status => ({ status })) as Subagent[];
  agents.push({ status: 'failed', archived: true } as Subagent);
  assert.deepEqual(agentCounts(agents), { running: 2, waiting: 1, failed: 1, total: 5 });
});
test('mobile uses the desktop PR blocker precedence without calling unknown conflict state clean', () => {
  assert.deepEqual(pullRequestBlockers({ state: 'OPEN', url: 'https://github.com/a/b/pull/1', hasConflicts: true, checks: 'failed', isBehind: true }), ['conflicts', 'checks-failed', 'behind']);
  assert.deepEqual(pullRequestBlockers({ state: 'MERGED', url: 'x', hasConflicts: true }), []);
});
