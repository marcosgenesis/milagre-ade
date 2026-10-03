import assert from 'node:assert/strict';
import test from 'node:test';
import { safeLink, markdownTokens } from './chat-presentation.ts';

test('links can open web pages but cannot invoke local commands or read local files', () => {
  for (const link of ['https://expo.dev', 'http://localhost:3000', 'mailto:hello@example.org']) assert.equal(safeLink(link), link);
  for (const link of ['javascript:alert(1)', 'file:///etc/passwd', 'milagre-local://connect', 'data:text/html,hello', '/Users/me/private']) assert.equal(safeLink(link), null);
});

test('streaming markdown closes open bold while code fences and HTML stay inert', () => {
  const tokens = markdownTokens('A **live answer', true);
  assert.ok(tokens[1].children?.some(token => token.type === 'strong_open'));
  const code = markdownTokens('```sh\nnpm test', true);
  assert.equal(code[0].type, 'fence'); assert.equal(code[0].content, 'npm test');
  assert.ok(!markdownTokens('<script>alert(1)</script>').some(token => token.type === 'html_block'));
});
