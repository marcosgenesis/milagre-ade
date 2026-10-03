import MarkdownIt from 'markdown-it';
import { closeOpenMarkdown } from '@milagre/shared/streaming-markdown';

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });
export function markdownTokens(text: string, streaming = false) {
  return markdown.parse(streaming ? closeOpenMarkdown(text) : text, {});
}
export function safeLink(href: string): string | null {
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(href).protocol) ? href : null; }
  catch { return null; }
}
