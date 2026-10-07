import type { ArtifactRef } from "./model.ts";

/** One version of a design an agent showed, as `artifact:get` returns it. */
export type Artifact = ArtifactRef & { versions: number; latest: number; html: string };

export interface ArtifactApi {
  get(request: { chatId: string; id: string; version?: number }): Promise<Artifact>;
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
