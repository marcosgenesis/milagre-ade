import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMarkdownImage } from './markdown-image.ts';

test('image sources distinguish web URLs from files on the connected computer', () => {
  assert.deepEqual(resolveMarkdownImage('https://example.org/a.png'), { url: 'https://example.org/a.png' });
  for (const source of ['/tmp/a%20b.png', 'file:///tmp/a%20b.png']) assert.deepEqual(resolveMarkdownImage(source), { path: '/tmp/a b.png' });
  assert.deepEqual(resolveMarkdownImage('../a.png', '/Code/repo/worktree'), { path: '/Code/repo/a.png' });
  for (const source of ['javascript:alert(1)', 'file://other/secret.png', 'https://user:pass@host/a.png', '//host/a.png', '/tmp/secret.txt', 'data:text/html,x']) assert.equal(resolveMarkdownImage(source), null);
  assert.equal(resolveMarkdownImage('a.png'), null);
});
