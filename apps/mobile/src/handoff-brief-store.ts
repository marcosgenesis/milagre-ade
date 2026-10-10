let current = { title: "Handoff brief", text: "" };
/** A brief (or a Link's summary) runs to a few hundred words, so the sheet reads it here instead of from route params. */
export function showBrief(text: string, title = "Handoff brief") {
  current = { title, text };
}
export function currentBrief() {
  return current;
}
