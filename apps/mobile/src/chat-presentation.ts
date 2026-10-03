import MarkdownIt from 'markdown-it';
import { closeOpenMarkdown } from '@milagre/shared/streaming-markdown';

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });
export function markdownTokens(text: string, streaming = false) {
  return markdown.parse(streaming ? closeOpenMarkdown(text) : text, {});
}
/**
 * Splits a reply into top-level Markdown blocks so each is parsed on its own: while a reply streams, only the last
 * block changes. A blank line followed by an unindented line starts a block; code fences are never split.
 */
export function markdownChunks(text: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let fence = '';
  let blank = false;
  for (const line of text.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (!fence && blank && current.length && /^\S/.test(line)) { chunks.push(current.join('\n')); current = []; }
    current.push(line);
    if (marker && !fence) fence = marker[0];
    else if (marker && marker[0] === fence) fence = '';
    blank = !fence && line.trim() === '';
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks;
}
export function safeLink(href: string): string | null {
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(href).protocol) ? href : null; }
  catch { return null; }
}
