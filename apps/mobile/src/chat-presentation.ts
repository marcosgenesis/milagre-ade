import MarkdownIt from 'markdown-it';
import type { ChatStep } from '@milagre/shared/model';
import { closeOpenMarkdown } from '@milagre/shared/streaming-markdown';

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });
export function markdownTokens(text: string, streaming = false) {
  return markdown.parse(streaming ? closeOpenMarkdown(text) : text, {});
}
export function safeLink(href: string): string | null {
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(href).protocol) ? href : null; }
  catch { return null; }
}
type LiveState = { approvals: readonly unknown[]; questions: readonly unknown[]; waitingForSubagents?: boolean };
export function activityState(steps: ChatStep[], run?: LiveState) {
  if (run?.approvals.length) return { label: 'Waiting for approval', working: false };
  if (run?.questions.length) return { label: 'Waiting for your answer', working: false };
  if (run?.waitingForSubagents) return { label: 'Waiting for agents', working: true };
  if (run) return { label: [...steps].reverse().find(step => step.status === 'running')?.title.replace(/`/g, '') || 'Working', working: true };
  const failed = steps.filter(step => step.status === 'failed').length;
  return { label: failed ? `${failed} tool${failed === 1 ? '' : 's'} failed` : 'Finished', working: false };
}
