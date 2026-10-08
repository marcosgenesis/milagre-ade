import type { ArtifactRef } from "./model.ts";

/** A design as `artifact:list` returns it: its newest version, and the screen it is laid out on. */
export type ArtifactSummary = ArtifactRef & { versions: number; width: number; height: number };

/** One version of a design an agent showed, as `artifact:get` returns it. */
export type Artifact = ArtifactSummary & { latest: number; html: string };

export interface ArtifactApi {
  get(request: { chatId: string; id: string; version?: number }): Promise<Artifact>;
  list(request: { chatId: string }): Promise<ArtifactSummary[]>;
  /** Records comments the user is sending; returns them with their ids. */
  addComments(request: { chatId: string; comments: DesignComment[] }): Promise<ArtifactComment[]>;
  comments(request: { chatId: string }): Promise<ArtifactComment[]>;
}

/** A comment on a design: where on it (fractions of its screen) when it was pinned, and what the user wrote. */
export type DesignComment = { design: ArtifactRef; x?: number; y?: number; text: string; id?: string };

/** A comment as the host keeps it: with its id, and, once the agent has addressed it, its note on what it did. */
export type ArtifactComment = DesignComment & { id: string; createdAt: number; resolved?: { note: string; at: number } };

// Plain text: the message shows in the user's bubble as typed, without markdown.
const designName = (design: ArtifactRef) => `the design "${design.title}" (${design.id}, version ${design.version})`;

const CHOICE = /^I chose the design ".*?" \(([a-z0-9-]+), version (\d+)\)\. Continue from this one\.(?:\n|$)/;

/**
 * The message that sends the user's feedback on designs to the agent: the design they chose, if they chose one, then
 * their comments. The choice comes first, on a line of its own, where chosenDesign reads it back.
 */
export function designFeedbackMessage({ choice, comments }: { choice?: ArtifactRef | null; comments: DesignComment[] }): string {
  const parts: string[] = [];
  if (choice) parts.push(`I chose ${designName(choice)}. Continue from this one.`);
  if (comments.length) {
    const lines = comments.map((comment, index) => {
      const at = comment.x === undefined || comment.y === undefined ? "" : `, ${Math.round(comment.x * 100)}% across and ${Math.round(comment.y * 100)}% down`;
      // The id lets the agent resolve the comment; a message from before ids has none.
      return `${index + 1}. ${comment.id ? `(comment ${comment.id}) ` : ""}On ${designName(comment.design)}${at}: ${comment.text.trim()}`;
    });
    parts.push(
      `${comments.length === 1 ? "A comment" : "Comments"} on the designs:\n\n${lines.join("\n")}\n\n${comments.some((comment) => comment.id) ? RESOLVE : REVISE}`,
    );
  }
  return parts.join("\n\n");
}

const REVISE = "Revise them with artifact_show and keep their ids.";
const RESOLVE = `${REVISE} Once you have addressed a comment, resolve it with artifact_resolve_comment and its comment id.`;
const COMMENT = /^(\d+)\. (?:\(comment ([a-f0-9]{8})\) )?On the design "(.*)" \(([a-z0-9-]+), version (\d+)\)(?:, (\d+)% across and (\d+)% down)?: (.*)$/;

/**
 * The feedback a message designFeedbackMessage wrote carries, read back to show it as a card instead of its text; null
 * for any other message. Only the exact shape it writes reads back, so a message the user typed stays text.
 */
export function parseDesignFeedback(body: string): { choice: ArtifactRef | null; comments: DesignComment[] } | null {
  const blocks = body.split("\n\n");
  let choice: ArtifactRef | null = null;
  const chose = /^I chose the design "(.*)" \(([a-z0-9-]+), version (\d+)\)\. Continue from this one\.$/.exec(blocks[0] ?? "");
  if (chose) {
    choice = { title: chose[1]!, id: chose[2]!, version: Number(chose[3]) };
    blocks.shift();
  }
  if (!blocks.length) return choice ? { choice, comments: [] } : null;
  const [heading, list, closing, ...rest] = blocks;
  if (rest.length || !/^(A comment|Comments) on the designs:$/.test(heading ?? "") || (closing !== REVISE && closing !== RESOLVE)) return null;
  const comments: DesignComment[] = [];
  for (const line of (list ?? "").split("\n")) {
    const match = COMMENT.exec(line);
    if (!match) return null;
    const [, , commentId, title, id, version, x, y, text] = match;
    comments.push({
      design: { id: id!, version: Number(version), title: title! },
      ...(x === undefined || y === undefined ? {} : { x: Number(x) / 100, y: Number(y) / 100 }),
      text: text!,
      ...(commentId ? { id: commentId } : {}),
    });
  }
  return { choice, comments };
}

/** The design the user last chose in these messages, read back from the message designFeedbackMessage wrote. */
export function chosenDesign(bodies: string[]): { id: string; version: number } | null {
  for (const body of [...bodies].reverse()) {
    const [, id, version] = CHOICE.exec(body) ?? [];
    if (id && version) return { id, version: Number(version) };
  }
  return null;
}

/**
 * What a design may load: its own inline code, plus https images, fonts, stylesheets and scripts (Tailwind's CDN,
 * Google Fonts). No requests of its own (fetch, XHR, WebSocket, beacons), frames or form posts, so a design can't send
 * anything anywhere. The desktop also sandboxes it in an iframe with no same origin.
 */
export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'unsafe-inline' https:",
  "img-src data: blob: https:",
  "font-src data: https:",
  "media-src data: blob: https:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * The design's HTML with the policy as the first thing the parser meets after the doctype, before anything the design
 * wrote: searching for its <head> could land inside a comment or a script string and leave the design without one. A
 * <meta> ahead of <html> still goes into the head, and applies to everything after it.
 */
export function artifactDocument(html: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;
  // Leading comments and whitespace, then the doctype; without one the design gets standards mode.
  const doctype = /^(?:\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i.exec(html);
  const at = doctype ? doctype[0].length : 0;
  // A bare fragment (no <html> of its own) also gets the charset and a phone-sized viewport a page would set.
  const page = /<html[\s>]/i.test(html) ? "" : '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
  return `${doctype ? html.slice(0, at) : "<!doctype html>"}${policy}${page}${html.slice(at)}`;
}

/** Escapes text for an HTML attribute value in double quotes. */
const attribute = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * A page that shows the design in a sandboxed frame, for a web view with no sandbox of its own (the phone's). The
 * frame runs the design's scripts but has no same origin and no say over the page around it, so it can't navigate
 * it. The frame inherits the page's policy, so the page carries the design's (the page itself has no script), plus
 * frame-src 'none': the frame loads nothing but the design, so the design can't navigate it away either. With an
 * opaque origin, the design can't read the files beside the page, whatever the web view lets the page itself read.
 */
export function artifactShell(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}; frame-src 'none'"><style>html,body{margin:0;height:100%;background:#fff}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${attribute(artifactDocument(html))}"></iframe></body></html>`;
}
