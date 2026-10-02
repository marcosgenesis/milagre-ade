import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaKind, mediaUrl, attachmentPrompt } from './media.ts';

test('classifies disk media and preserves special characters in paths', () => {
  assert.equal(mediaKind('/tmp/Photo.JPG'), 'image');
  assert.equal(mediaKind('/tmp/clip.mov'), 'video');
  assert.equal(mediaKind('/tmp/note.txt'), null);
  assert.equal(new URL(mediaUrl('/tmp/a #?%.png')).searchParams.get('path'), '/tmp/a #?%.png');
});
test('file-only messages and mixed messages deliver paths without changing visible text', () => {
  assert.equal(attachmentPrompt('Review', ['/tmp/a b.txt', '/tmp/c.mp4']), 'Review\n\nAttached files:\n/tmp/a b.txt\n/tmp/c.mp4');
  assert.equal(attachmentPrompt('', ['/tmp/a.txt']), 'Please review the attached files.\n\nAttached files:\n/tmp/a.txt');
  assert.equal(attachmentPrompt('hello', []), 'hello');
});
