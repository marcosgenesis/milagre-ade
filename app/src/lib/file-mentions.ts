export type PromptToken = { kind: 'at' | 'slash'; query: string; start: number; end: number };
export function promptToken(draft: string, caret = draft.length): PromptToken | null {
  const match = /(^|\s)([@/])([^\s@"]*)$/.exec(draft.slice(0, caret));
  if (!match) return null;
  return { kind: match[2] === '@' ? 'at' : 'slash', query: match[3].toLowerCase(), start: match.index + match[1].length, end: caret };
}
export function insertFileMention(draft: string, token: Pick<PromptToken, 'start' | 'end'>, path: string): string {
  const mention = /\s|"/.test(path) ? `@${JSON.stringify(path)}` : `@${path}`;
  return insertPromptToken(draft, token, mention);
}
export function insertPromptToken(draft: string, token: Pick<PromptToken, 'start' | 'end'>, mention: string): string {
  const suffix = draft.slice(token.end);
  return `${draft.slice(0, token.start)}${mention}${suffix.startsWith(' ') ? '' : ' '}${suffix}`;
}
