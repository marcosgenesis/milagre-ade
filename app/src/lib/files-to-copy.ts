/** What the Settings field shows when nothing is set, and what applies. */
export const DEFAULT_FILES_TO_COPY = ".env*";

/** The patterns in the field: one per line, blank lines dropped. */
export function parsePatterns(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** The preview line: "Matches 3 files: .env, .env.local, apps/web/.env". */
export function previewSentence(matches: string[], shown = 6): string {
  if (matches.length === 0) return "Matches no files.";
  const names = matches.slice(0, shown).join(", ");
  const more = matches.length > shown ? ` and ${matches.length - shown} more` : "";
  return `Matches ${matches.length} ${matches.length === 1 ? "file" : "files"}: ${names}${more}`;
}
