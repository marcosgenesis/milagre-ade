let current = "";
/** A brief runs to a few hundred words, so the sheet reads it here instead of from route params. */
export function showBrief(brief: string) {
  current = brief;
}
export function currentBrief() {
  return current;
}
