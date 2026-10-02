type ConflictStatus = { url: string; state: string; hasConflicts?: boolean; conflictStatusKnown?: boolean };

export function updateConflictDismissals(dismissed: string[], pr: ConflictStatus | null, clicked = false): string[] {
  if (!pr) return dismissed;
  if (clicked && pr.state === "OPEN" && pr.hasConflicts) {
    return dismissed.includes(pr.url) ? dismissed : [...dismissed, pr.url];
  }
  if (pr.state !== "OPEN" || (pr.hasConflicts === false && pr.conflictStatusKnown !== false)) {
    return dismissed.includes(pr.url) ? dismissed.filter((url) => url !== pr.url) : dismissed;
  }
  return dismissed;
}
