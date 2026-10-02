import type { ChatStep } from "../model";

export type ReplyPart = { type: "text"; text: string } | { type: "steps"; steps: ChatStep[] };

/**
 * A reply's text and tool steps in the order they happened. Each step sits at its offset (the
 * length of the reply's text when it started); steps next to each other form one group, and a step
 * without an offset goes after the text. Text that is only whitespace is left out.
 */
export function replyParts(body: string, steps: ChatStep[] = []): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let cursor = 0;
  for (const step of steps) {
    const at = Math.min(Math.max(step.offset ?? body.length, cursor), body.length);
    const text = body.slice(cursor, at);
    cursor = at;
    if (text.trim()) parts.push({ type: "text", text });
    const last = parts.at(-1);
    if (last?.type === "steps") last.steps.push(step);
    else parts.push({ type: "steps", steps: [step] });
  }
  const rest = body.slice(cursor);
  if (rest.trim()) parts.push({ type: "text", text: rest });
  return parts;
}

/** A step title split into plain text and code: "Ran `npm test`" → "Ran ", then the code "npm test". */
export function titleSpans(title: string): Array<{ text: string; code: boolean }> {
  return title.split("`").map((text, index) => ({ text, code: index % 2 === 1 })).filter((span) => span.text);
}
