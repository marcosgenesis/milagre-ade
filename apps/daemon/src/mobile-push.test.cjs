const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createMobilePush } = require('./mobile-push.cjs');

const deviceId = 'b6e2df4b-972b-4e7b-bc65-6cda0a173798';
const token = 'ExpoPushToken[phone-one]';
const chatId = '/project#1';
const approval = { type: 'permission-request', requestId: 'request-1', kind: 'command', title: 'Run?', command: 'ls', tool: 'Shell' };
const registration = (extra = {}) => ({ deviceId, token, hostId: 'https://mac.example.com', notifyWhenWaiting: true, notifyOnCompletion: true, ...extra });

test('accepted input followed by a startup failure starts a fresh notification lifecycle', async t => {
  const { push, messages } = await fixture(t);
  await push.register(registration());
  push.observe(chatId, { type: 'turn-started', turnId: 'old' });
  push.observe(chatId, { type: 'turn-completed' });
  await push.settled();
  push.observe(chatId, { type: 'message-sent' });
  push.observe(chatId, { type: 'turn-failed', message: 'CLI unavailable' });
  push.observe(chatId, { type: 'turn-failed', message: 'CLI unavailable' });
  await push.settled();
  assert.equal(messages.length, 2);
  assert.equal(messages[1].body, 'CLI unavailable');
});

test('steering an active turn preserves request deduplication', async t => {
  const { push, messages } = await fixture(t);
  await push.register(registration());
  push.observe(chatId, { type: 'turn-started' });
  push.observe(chatId, approval);
  await push.settled();
  push.observe(chatId, { type: 'message-sent' });
  push.observe(chatId, approval);
  await push.settled();
  assert.equal(messages.length, 1);
});
async function fixture(t, options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-push-'));
  const messages = [];
  let clock = 1000;
  const push = createMobilePush({ dataDir, now: () => clock, send: async (message, current) => { if (current()) messages.push(message); },
    context: async () => ({ projectName: 'Project', worktreeName: 'fix-login', chatTitle: 'Login', provider: 'codex' }), ...options });
  await push.load();
  t.after(async () => { await push.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  return { push, dataDir, messages, advance: ms => { clock += ms; } };
}

test('sends approvals, questions, completion and failure without an attached client', async t => {
  const { push, messages } = await fixture(t);
  await push.register(registration());
  push.observe(chatId, { type: 'turn-started', turnId: 'turn-1' });
  push.observe(chatId, approval);
  await push.settled();
  assert.match(messages[0].title, /needs approval/);
  assert.equal(messages[0].body, 'Run: ls');
  assert.deepEqual(messages[0].data, { kind: 'milagre-chat', hostId: 'https://mac.example.com', projectPath: '/project', sessionId: 1, eventId: messages[0].data.eventId });
  push.observe(chatId, { type: 'question-request', requestId: 'question-1', questions: [{ question: 'Which branch?' }] });
  await push.settled();
  assert.match(messages[1].title, /needs input/);
  assert.equal(messages[1].body, 'Which branch?');
  push.observe(chatId, { type: 'text-delta', text: 'Done fixing login.' });
  push.observe(chatId, { type: 'turn-completed' });
  await push.settled();
  assert.match(messages[2].title, /Turn completed/);
  assert.equal(messages[2].body, 'Done fixing login.');
  push.observe(chatId, { type: 'turn-started', turnId: 'turn-2' });
  push.observe(chatId, { type: 'turn-failed', message: 'Provider unavailable' });
  await push.settled();
  assert.match(messages[3].title, /Turn failed/);
  assert.equal(messages[3].body, 'Provider unavailable');
  push.observe(chatId, { type: 'turn-started', turnId: 'turn-3' });
  push.observe(chatId, { type: 'turn-cancelled' });
  await push.settled();
  assert.equal(messages.length, 4);
});

test('duplicates and requests resolved before delivery never produce another alert', async t => {
  let release;
  const contextReady = new Promise(resolve => { release = resolve; });
  const { push, messages } = await fixture(t, { context: () => contextReady });
  await push.register(registration());
  push.observe(chatId, { type: 'turn-started' });
  push.observe(chatId, approval);
  push.observe(chatId, approval);
  push.observe(chatId, { type: 'permission-resolved', requestId: approval.requestId });
  release({ projectName: 'Project' });
  await push.settled();
  assert.equal(messages.length, 0);
  push.observe(chatId, { ...approval, requestId: 'still-open' });
  await push.settled();
  push.observe(chatId, { ...approval, requestId: 'still-open' });
  push.observe(chatId, { type: 'turn-completed' });
  push.observe(chatId, { type: 'turn-completed' });
  await push.settled();
  assert.equal(messages.length, 2);
});

test('focus suppresses only the viewing device and expires after 15 seconds', async t => {
  const { push, messages, advance } = await fixture(t);
  await push.register(registration());
  await push.register(registration({ deviceId: '4ca2caa8-0c0f-4c7e-8f84-b1de42861eb6', token: 'ExpoPushToken[phone-two]' }));
  push.focus({ deviceId, chatId });
  push.observe(chatId, approval);
  await push.settled();
  assert.deepEqual(messages.map(message => message.to), ['ExpoPushToken[phone-two]']);
  advance(15001);
  push.observe(chatId, { ...approval, requestId: 'after-suspend' });
  await push.settled();
  assert.equal(messages.length, 3);
  push.focus({ deviceId, chatId: null });
  push.observe(chatId, { ...approval, requestId: 'unfocused' });
  await push.settled();
  assert.equal(messages.length, 5);
});

test('preferences, token rotation and unregister are private and survive restart', async t => {
  const { push, dataDir, messages } = await fixture(t);
  await push.register(registration({ notifyWhenWaiting: false }));
  const file = path.join(dataDir, 'mobile-push.json');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  push.observe(chatId, approval);
  await push.settled();
  assert.equal(messages.length, 0);
  const second = createMobilePush({ dataDir, send: async message => messages.push(message), context: async () => ({ projectName: 'Project' }) });
  await second.load();
  await second.register(registration({ token: 'ExpoPushToken[rotated]', notifyOnCompletion: false }));
  second.observe(chatId, approval);
  second.observe(chatId, { type: 'turn-completed' });
  await second.settled();
  // Ending the turn invalidates the queued approval too.
  assert.equal(messages.length, 0);
  second.observe(chatId, { type: 'turn-started' });
  second.observe(chatId, approval);
  await second.settled();
  assert.equal(messages[0].to, 'ExpoPushToken[rotated]');
  await second.unregister({ deviceId });
  second.observe(chatId, { ...approval, requestId: 'after-forget' });
  await second.settled();
  assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), []);
  await second.close();
});

test('clear and token rotation invalidate deliveries already queued in a sender', async t => {
  const queued = [];
  const { push } = await fixture(t, { send: async (message, current) => queued.push({ message, current }) });
  await push.register(registration());
  push.observe(chatId, approval);
  await push.settled();
  assert.equal(queued[0].current(), true);
  await push.register(registration({ token: 'ExpoPushToken[new]' }));
  assert.equal(queued[0].current(), false);
  push.observe(chatId, { ...approval, requestId: 'new' });
  await push.settled();
  await push.clear();
  assert.equal(queued[1].current(), false);
});

test('invalid receipt removes only the matching token, never a newer registration', async t => {
  const { push, dataDir } = await fixture(t);
  await push.register(registration());
  await push.register(registration({ token: 'ExpoPushToken[new]' }));
  await push.invalidate(token);
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'mobile-push.json'), 'utf8')).length, 1);
  await push.invalidate('ExpoPushToken[new]');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir, 'mobile-push.json'), 'utf8')), []);
});

test('registration rejects invalid tokens, origins, device IDs and preferences', async t => {
  const { push } = await fixture(t);
  for (const extra of [{ deviceId: '../file' }, { token: 'secret' }, { hostId: 'http://evil.example' }, { hostId: 'https://user:secret@mac.example' }, { hostId: 'https://mac.example/path' }, { notifyWhenWaiting: 'yes' }, { notifyOnCompletion: 1 }]) {
    await assert.rejects(push.register(registration(extra)), /Invalid/);
  }
  assert.throws(() => push.focus({ deviceId, chatId }), /not registered/);
});

test('caps notification copy, isolates errors and never places credentials in data', async t => {
  const errors = [];
  const { push, messages } = await fixture(t, { onError: error => errors.push(error), context: async () => ({ projectName: 'x'.repeat(200), chatTitle: 'y'.repeat(200) }) });
  await push.register(registration());
  push.observe(chatId, { ...approval, command: 'z'.repeat(1000) });
  await push.settled();
  assert.ok(messages[0].title.length <= 120);
  assert.ok(messages[0].body.length <= 240);
  assert.ok(!JSON.stringify(messages[0].data).includes(token));
  const failing = await fixture(t, { send: async () => { throw new Error('private payload'); }, onError: error => errors.push(error) });
  await failing.push.register(registration());
  failing.push.observe(chatId, approval);
  await failing.push.settled();
  assert.equal(errors.length, 1);
  assert.ok(!errors[0].message.includes('private payload'));
});

test('a relay computer registers, survives a restart, and a malformed relay id is rejected', async t => {
  const relayId = 'relay://AbCdEfGhIjKlMnOpQrSt_-';
  const { push, dataDir, messages } = await fixture(t);
  assert.deepEqual(await push.register(registration({ hostId: relayId })), { registered: true });
  const errors = [];
  const second = createMobilePush({ dataDir, send: async message => messages.push(message), context: async () => ({ projectName: 'Project' }), onError: error => errors.push(error) });
  await second.load();
  assert.deepEqual(errors, []);
  second.observe(chatId, approval);
  await second.settled();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].data.hostId, relayId);
  await second.close();
  for (const hostId of ['relay://short', 'relay://AbCdEfGhIjKlMnOpQrSt_-x', 'relay://AbCdEfGhIjKlMnOpQrSt+/', 'relay://AbCdEfGhIjKlMnOpQrSt_-/', 'RELAY://AbCdEfGhIjKlMnOpQrSt_-']) {
    await assert.rejects(push.register(registration({ hostId })), /Invalid push computer address/, hostId);
  }
});
