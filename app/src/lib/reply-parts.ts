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

export type ActivityEntry = { type: "text"; text: string } | { type: "step"; step: ChatStep };

/**
 * A reply as its activity and its answer. The answer is the reply's last text; the activity is
 * everything else (thinking, tool steps and the text between them) in the order it happened.
 */
export function replyActivity(body: string, steps: ChatStep[] = []): { activity: ActivityEntry[]; answer: string } {
  const parts = replyParts(body, steps);
  const answerIndex = parts.map((part) => part.type).lastIndexOf("text");
  const activity = parts.flatMap((part, index): ActivityEntry[] => {
    if (index === answerIndex) return [];
    return part.type === "text" ? [part] : part.steps.map((step) => ({ type: "step", step }));
  });
  const answer = answerIndex === -1 ? "" : (parts[answerIndex] as { text: string }).text;
  return { activity, answer };
}

/**
 * What a reply that never wrote an answer concluded: its last thinking, when the agent kept it all
 * there. Shown under the fold so the answer isn't hidden in a step the user rarely opens.
 */
export function unspokenThought(activity: ActivityEntry[], answer: string): string {
  if (answer.trim() || activity.some((entry) => entry.type === "text")) return "";
  const thought = [...activity].reverse().find((entry) => entry.type === "step" && entry.step.kind === "thinking" && entry.step.detail?.trim());
  return thought?.type === "step" ? thought.step.detail?.trim() ?? "" : "";
}

const count = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", String(n)));

/** "4s", "1m 15s" */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * What a reply's activity did, in one line: "Thought for 12s · read 2 files · ran 3 commands".
 * Files count once however often they were read or edited; failed is how many steps failed.
 */
export function activitySummary(steps: ChatStep[]): { text: string; failed: number } {
  const of = (kind: ChatStep["kind"]) => steps.filter((step) => step.kind === kind);
  const files = (kind: ChatStep["kind"]) => new Set(of(kind).map((step) => step.title)).size;
  const thinking = of("thinking");
  const thinkingMs = thinking.reduce((total, step) => total + (step.durationMs ?? 0), 0);
  const parts = [
    thinking.length ? (thinkingMs ? `thought for ${formatDuration(thinkingMs)}` : "thought") : "",
    files("read") ? count(files("read"), "read 1 file", "read # files") : "",
    of("search").length ? count(of("search").length, "searched once", "searched # times") : "",
    files("edit") ? count(files("edit"), "edited 1 file", "edited # files") : "",
    of("shell").length ? count(of("shell").length, "ran 1 command", "ran # commands") : "",
    of("other").length ? count(of("other").length, "used 1 tool", "used # tools") : "",
  ].filter(Boolean);
  const text = parts.join(" · ");
  return { text: text.charAt(0).toUpperCase() + text.slice(1), failed: steps.filter((step) => step.status === "failed").length };
}

/** A step title split into plain text and code: "Ran `npm test`" → "Ran ", then the code "npm test". */
export function titleSpans(title: string): Array<{ text: string; code: boolean }> {
  return title.split("`").map((text, index) => ({ text, code: index % 2 === 1 })).filter((span) => span.text);
}
