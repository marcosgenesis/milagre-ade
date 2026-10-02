import test from 'node:test';
import assert from 'node:assert/strict';
import { promptToken, insertFileMention, insertPromptToken } from './file-mentions.ts';
test('file queries accept directories and names at the caret, preserving following text', () => {
  assert.deepEqual(promptToken('Look at @src/app.ts please', 19), { kind: 'at', query: 'src/app.ts', start: 8, end: 19 });
  assert.equal(insertFileMention('Look at @src/app.ts please', { start: 8, end: 19 }, 'src/my app.ts'), 'Look at @"src/my app.ts" please');
  assert.equal(promptToken('mail@example.com', 16), null);
  assert.equal(promptToken('/rev', 4)?.kind, 'slash');
});

test('slash selection preserves text after the caret', () => {
  assert.equal(insertPromptToken('/rev explain the failing tests', { start: 0, end: 4 }, '/review'), '/review explain the failing tests');
});
