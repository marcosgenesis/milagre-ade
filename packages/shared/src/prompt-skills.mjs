/** Standalone slash tokens in prose. Offsets refer to the original prompt. */
export function promptSkillTokens(prompt) {
  const prose = prompt.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g, code => code.replace(/[^\n]/g, ' '));
  return Array.from(prose.matchAll(/(^|\s)\/([a-zA-Z0-9][\w.:-]*)(?=$|\s|[,!?;()[\]{}](?=$|\s))/g), match => ({
    name: match[2], start: match.index + match[1].length, end: match.index + match[0].length,
  }));
}

/** Complete commands from the catalog, with the prompt kept verbatim. */
export function promptSkillParts(prompt, names) {
  const known = new Set(names.map(name => name.toLowerCase()));
  const parts = [];
  let end = 0;
  for (const token of promptSkillTokens(prompt)) {
    let name = token.name;
    if (!known.has(name.toLowerCase())) name = name.replace(/[.:]+$/, '');
    if (!known.has(name.toLowerCase())) continue;
    if (token.start > end) parts.push({ text: prompt.slice(end, token.start), skill: false });
    end = token.start + name.length + 1;
    parts.push({ text: prompt.slice(token.start, end), skill: true });
  }
  if (end < prompt.length) parts.push({ text: prompt.slice(end), skill: false });
  return parts;
}

/** A native caret or selected range contained inside a recognized command. */
export function promptSkillAtSelection(parts, selection) {
  let start = 0;
  for (const part of parts) {
    const end = start + part.text.length;
    if (part.skill && selection.start >= start && selection.end <= end) return part.text.slice(1).toLowerCase();
    start = end;
  }
  return null;
}
