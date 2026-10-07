import type { ArtifactRef } from "./model.ts";

/** A design as `artifact:list` returns it: its newest version, and the screen it is laid out on. */
export type ArtifactSummary = ArtifactRef & { versions: number; width: number; height: number };

/** One version of a design an agent showed, as `artifact:get` returns it. */
export type Artifact = ArtifactSummary & { latest: number; html: string };

export interface ArtifactApi {
  get(request: { chatId: string; id: string; version?: number }): Promise<Artifact>;
  list(request: { chatId: string }): Promise<ArtifactSummary[]>;
}

/** A comment on a design: where on it (fractions of its screen) when it was pinned, and what the user wrote. */
export type DesignComment = { design: ArtifactRef; x?: number; y?: number; text: string };

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
      return `${index + 1}. On ${designName(comment.design)}${at}: ${comment.text.trim()}`;
    });
    parts.push(
      `${comments.length === 1 ? "A comment" : "Comments"} on the designs:\n\n${lines.join("\n")}\n\nRevise them with artifact_show and keep their ids.`,
    );
  }
  return parts.join("\n\n");
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

/** The design's HTML with the policy as the first thing in its head, where it applies to everything after it. */
export function artifactDocument(html: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + policy + html.slice(head.index + head[0].length);
  const root = /<html(\s[^>]*)?>/i.exec(html);
  if (root) return `${html.slice(0, root.index + root[0].length)}<head>${policy}</head>${html.slice(root.index + root[0].length)}`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const at = doctype ? doctype[0].length : 0;
  return `${html.slice(0, at)}${doctype ? "" : "<!doctype html>"}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${policy}</head>${html.slice(at)}`;
}
