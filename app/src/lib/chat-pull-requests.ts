import type { ChatStep, PullRequest } from "../model";

/**
 * A PR a chat created or merged: its URL, or a number gh looks up in the chat's repository.
 * Read from the chat's commands, since a chat can open PRs on branches its worktree no longer has.
 */
export type PullRequestRef = string;

const PR_URL = /^https?:\/\/[^\s/]+\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
// `gh pr merge` flags followed by a value, so the value isn't read as the PR.
const MERGE_VALUE_FLAGS = new Set(["-t", "--subject", "-b", "--body", "-F", "--body-file", "-A", "--author-email", "--match-head-commit", "-R", "--repo"]);

/** The PRs a chat's commands created (`gh pr create`) or merged (`gh pr merge <pr>`), in the order they ran. */
export function pullRequestRefs(messages: Array<{ steps?: ChatStep[] }>): PullRequestRef[] {
  const refs: PullRequestRef[] = [];
  const add = (ref: PullRequestRef | null) => {
    if (ref && !refs.includes(ref)) refs.push(ref);
  };
  for (const step of messages.flatMap((message) => message.steps ?? [])) {
    // Saved shell steps are "$ command" then the output; a failed one has no PR to show.
    if (step.kind !== "shell" || step.status !== "done" || !step.detail?.startsWith("$ ")) continue;
    if (/\bgh\s+pr\s+create\b/.test(step.detail)) add(createdUrl(step.detail));
    for (const match of step.detail.matchAll(/\bgh\s+pr\s+merge\b([^\n;&|]*)/g)) add(mergedRef(match[1]));
  }
  // A number that a created URL already covers is the same PR (both run in the chat's repository).
  return refs.filter((ref) => !/^\d+$/.test(ref) || !refs.some((other) => other.endsWith(`/pull/${ref}`)));
}

// gh prints the new PR's URL alone on the last line; URLs in the body come before it.
function createdUrl(detail: string) {
  const lines = detail.split("\n").map((line) => line.trim()).filter(Boolean);
  const index = lines.map((line) => PR_URL.test(line)).lastIndexOf(true);
  return index > 0 ? lines[index] : null;
}

function mergedRef(args: string) {
  // Quoted values stay one word, so `--body "two words"` doesn't read "words" as the PR.
  const words = [...args.matchAll(/"[^"]*"|'[^']*'|\S+/g)].map(([word]) => word.replace(/^['"]|['"]$/g, ""));
  let repo: string | undefined;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word === "-R" || word === "--repo") repo = words[index + 1];
    if (MERGE_VALUE_FLAGS.has(word)) index++;
    else if (word.startsWith("-")) continue;
    else if (PR_URL.test(word)) return word;
    else if (/^\d+$/.test(word)) return repo && REPO.test(repo) ? `https://github.com/${repo}/pull/${word}` : word;
    // A branch name, a variable or anything else isn't followed: the branch PR shows on its own.
    else return null;
  }
  return null;
}

/** The chat's PRs that could be read, in the order it made them, with the worktree branch's PR included once. */
export function chatPullRequests(refs: PullRequestRef[], found: Record<PullRequestRef, PullRequest | null | undefined>, branch: PullRequest | undefined): PullRequest[] {
  const prs: PullRequest[] = [];
  for (const pr of [...refs.map((ref) => found[ref]), branch]) {
    if (pr && !prs.some((other) => other.url === pr.url)) prs.push(pr);
  }
  return prs;
}

/** The order the row shows them in: conflicts, then other open PRs, then merged ones. */
export function rowPullRequests(prs: PullRequest[]): PullRequest[] {
  const rank = (pr: PullRequest) => (pr.state === "MERGED" ? 2 : pr.hasConflicts ? 0 : 1);
  return prs.map((pr, index) => ({ pr, index })).sort((a, b) => rank(a.pr) - rank(b.pr) || a.index - b.index).map(({ pr }) => pr);
}
