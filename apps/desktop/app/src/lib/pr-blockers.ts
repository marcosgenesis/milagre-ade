type BlockerStatus = {
  number?: number;
  url: string;
  state: string;
  hasConflicts?: boolean;
  conflictStatusKnown?: boolean;
  isBehind?: boolean;
  changesRequested?: boolean;
  checks?: "running" | "failed";
};

/** Something on GitHub that stops an open PR from merging and that the agent can fix. */
export type PullRequestBlocker = "conflicts" | "changes-requested" | "checks-failed" | "behind";

/**
 * Most urgent first: conflicts must be fixed before a branch can be updated, and both before review lands.
 * Failed CI comes before an outdated branch, since updating the branch reruns the checks anyway.
 */
const ORDER: PullRequestBlocker[] = ["conflicts", "changes-requested", "checks-failed", "behind"];

export const BLOCKERS: Record<PullRequestBlocker, { short: string; long: string; action: string; tone: "red" | "orange" }> = {
  conflicts: { short: "Conflicts", long: "Merge conflicts", action: "Resolve conflicts", tone: "red" },
  "changes-requested": { short: "Needs changes", long: "Changes requested", action: "Address review", tone: "red" },
  "checks-failed": { short: "CI failed", long: "CI checks failed", action: "Fix CI", tone: "red" },
  behind: { short: "Out of date", long: "Out of date with the base branch", action: "Update branch", tone: "orange" },
};

function blocks(pr: BlockerStatus, blocker: PullRequestBlocker) {
  if (pr.state !== "OPEN") return false;
  if (blocker === "conflicts") return Boolean(pr.hasConflicts);
  if (blocker === "behind") return Boolean(pr.isBehind);
  if (blocker === "checks-failed") return pr.checks === "failed";
  return Boolean(pr.changesRequested);
}

/** A false flag only proves the blocker is gone when GitHub actually computed the merge state. */
function clears(pr: BlockerStatus, blocker: PullRequestBlocker) {
  if (pr.state !== "OPEN") return true;
  if (blocks(pr, blocker)) return false;
  return blocker === "changes-requested" || blocker === "checks-failed" || pr.conflictStatusKnown !== false;
}

export function pullRequestBlockers(pr: BlockerStatus | null | undefined): PullRequestBlocker[] {
  return pr ? ORDER.filter((blocker) => blocks(pr, blocker)) : [];
}

export function blockerPrompt(blocker: PullRequestBlocker, pr: BlockerStatus): string {
  if (blocker === "conflicts") {
    return "Resolve the merge conflicts in this branch against the pull request's base branch. Preserve the intended changes from both sides and run the relevant checks.";
  }
  if (blocker === "behind") {
    return "This branch is out of date with the pull request's base branch. Merge the latest base branch into it, fix anything the merge breaks, run the relevant checks, and push.";
  }
  const ref = pr.number ? `pull request #${pr.number}` : "this branch's pull request";
  if (blocker === "checks-failed") {
    return `The CI checks on ${ref} failed. Find the failing runs (\`gh pr checks ${pr.number ?? ""}\`) and read their logs (\`gh run view <run-id> --log-failed\`), fix the cause, run the same checks locally, and push.`;
  }
  return `A reviewer requested changes on ${ref}. Read every review and inline comment (\`gh pr view ${pr.number ?? ""} --comments\` and \`gh api repos/{owner}/{repo}/pulls/${pr.number ?? "<number>"}/comments\`), address each one, run the relevant checks, and push. Then list what you changed for each comment.`;
}

const key = (blocker: PullRequestBlocker, url: string) => (blocker === "conflicts" ? url : `${blocker}:${url}`);

export function isBlockerDismissed(dismissed: string[], blocker: PullRequestBlocker, pr: BlockerStatus) {
  return dismissed.includes(key(blocker, pr.url));
}

/**
 * Once the agent is asked to fix a blocker, its action stays hidden through refreshes and failed lookups,
 * and comes back only after GitHub confirms that blocker cleared and it then recurs.
 */
export function updateBlockerDismissals(dismissed: string[], pr: BlockerStatus | null, clicked?: PullRequestBlocker): string[] {
  if (!pr) return dismissed;
  if (clicked) {
    const entry = key(clicked, pr.url);
    return blocks(pr, clicked) && !dismissed.includes(entry) ? [...dismissed, entry] : dismissed;
  }
  const cleared = ORDER.filter((blocker) => clears(pr, blocker)).map((blocker) => key(blocker, pr.url));
  return cleared.some((entry) => dismissed.includes(entry)) ? dismissed.filter((entry) => !cleared.includes(entry)) : dismissed;
}
