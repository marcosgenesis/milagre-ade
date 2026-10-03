const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { wire } = require('./protocol.cjs');

function harness(options = {}) {
  const socket = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, writableLength: 0, written: [], write(frame) { this.written.push(frame); }, destroy() { this.destroyed = true; } });
  const messages = [];
  const errors = [];
  const connection = wire(socket, { onMessage: message => messages.push(message), onInvalid: error => errors.push(error.code), ...options });
  return { socket, messages, errors, connection, feed: chunk => socket.emit('data', Buffer.from(chunk)) };
}

test('a frame split across many chunks is parsed once its newline arrives', () => {
  const { messages, errors, feed } = harness();
  const text = 'é'.repeat(50000);
  const bytes = Buffer.from(JSON.stringify({ id: 1, text }) + '\n');
  // 1-byte-ish slices, including ones that cut a multi-byte character in half.
  for (let at = 0; at < bytes.length; at += 777) feed(bytes.subarray(at, at + 777));
  assert.deepEqual(errors, []);
  assert.deepEqual(messages, [{ id: 1, text }]);
});

test('several frames and a partial one in the same chunk keep their order', () => {
  const { messages, feed } = harness();
  feed('{"a":1}\n{"a":2}\n{"a"');
  assert.deepEqual(messages, [{ a: 1 }, { a: 2 }]);
  feed(':3');
  feed('}\n{"a":4}\n');
  assert.deepEqual(messages, [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]);
});

test('a partial frame over the limit fails without waiting for a newline', () => {
  const { messages, errors, feed } = harness({ maxFrameBytes: 100 });
  for (let index = 0; index < 11; index++) feed('x'.repeat(10));
  assert.deepEqual(errors, ['FRAME_TOO_LARGE']);
  feed('{"a":1}\n');
  assert.deepEqual(messages, []);
});

test('a frame exactly at the limit passes, one byte over fails', () => {
  const ok = harness({ maxFrameBytes: 20 });
  ok.feed('{"k":"');
  ok.feed('x'.repeat(12) +'"}\n'); // 20 bytes before the newline
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.messages.length, 1);
  const over = harness({ maxFrameBytes: 20 });
  over.feed('{"k":"');
  over.feed('x'.repeat(13) +'"}\n');
  assert.deepEqual(over.errors, ['FRAME_TOO_LARGE']);
});

test('invalid JSON is reported once and later data is ignored', () => {
  const { messages, errors, feed } = harness();
  feed('nope\n{"a":1}\n');
  feed('{"a":2}\n');
  assert.deepEqual(errors, ['INVALID_REQUEST']);
  assert.deepEqual(messages, []);
});

test('send measures a frame once and applies both limits', () => {
  const { socket, connection } = harness({ maxFrameBytes: 20 });
  assert.equal(connection.send({ a: 1 }), true);
  assert.deepEqual(socket.written, ['{"a":1}\n']);
  assert.throws(() => connection.send({ k: 'x'.repeat(30) }), { code: 'FRAME_TOO_LARGE' });
  socket.writableLength = 35;
  assert.equal(connection.send({ a: 1 }), false);
  assert.equal(socket.destroyed, true);
});
