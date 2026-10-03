const { createGit, callbackExec } = require("./git/client.cjs");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const FIELDS = "number,url,state,title,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup";
// What a chat's commands can name: a PR URL or a number in the chat's repository. Nothing gh reads as a flag.
const PR_REF = /^(?:\d+|https?:\/\/[^\s/]+\/[\w.-]+\/[\w.-]+\/pull\/\d+)$/;
// A chat that ran a long loop of `gh pr create` still makes a bounded number of lookups.
const MAX_REFS = 20;

const execOptions = (cwd) => ({
  cwd, encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024,
  env: { ...process.env, GH_PROMPT_DISABLED: "1" },
});

/** Resolve the latest PR for the checked-out branch, including PRs submitted from a fork. */
async function readPullRequest(cwd, exec = execFileAsync) {
  try {
    const options = execOptions(cwd);
    const git = createGit({ execFile: callbackExec(exec) }).read;
    const { stdout: branchOutput } = await git.checked(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const branch = branchOutput.trim();
    if (!branch) return null;
    // `pr view` can infer the wrong head repository for a fork or a branch tracking main.
    const { stdout } = await exec("gh", ["pr", "list", "--head", branch, "--state", "all", "--limit", "1", "--json", FIELDS], options);
    return toPullRequest(JSON.parse(stdout)[0]);
  } catch {
    // No PR, offline, or gh unavailable: this optional metadata never blocks a chat.
    return null;
  }
}

/** The PRs a chat created or merged, by URL or number, looked up from its folder; null where one can't be read. */
async function readPullRequests(cwd, refs, exec = execFileAsync) {
  if (!Array.isArray(refs)) return [];
  return Promise.all(refs.slice(0, MAX_REFS).map(async (ref) => {
    if (typeof ref !== "string" || !PR_REF.test(ref)) return null;
    try {
      const { stdout } = await exec("gh", ["pr", "view", ref, "--json", FIELDS], execOptions(cwd));
      return toPullRequest(JSON.parse(stdout));
    } catch {
      return null;
    }
  }));
}

function toPullRequest(pr) {
  if (!pr || !["OPEN", "MERGED"].includes(pr.state) || !Number.isSafeInteger(pr.number) || pr.number <= 0) return null;
  const url = new URL(pr.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // CLEAN means GitHub reports the PR mergeable with passing commit status. Unknown or blocked
  // states must never advertise readiness, even if a reviewer has already approved.
  const readyToMerge = pr.state === "OPEN" && pr.isDraft === false && pr.reviewDecision === "APPROVED" && pr.mergeStateStatus === "CLEAN";
  const hasConflicts = pr.state === "OPEN" && pr.mergeStateStatus === "DIRTY";
  const conflictStatusKnown = typeof pr.mergeStateStatus === "string" && pr.mergeStateStatus !== "UNKNOWN";
  // BEHIND only shows up when the base branch requires PRs to be up to date before merging.
  const isBehind = pr.state === "OPEN" && pr.mergeStateStatus === "BEHIND";
  const changesRequested = pr.state === "OPEN" && pr.reviewDecision === "CHANGES_REQUESTED";
  const checks = pr.state === "OPEN" ? checksState(pr.statusCheckRollup) : undefined;
  return { number: pr.number, url: url.href, state: pr.state, title: typeof pr.title === "string" ? pr.title : "", readyToMerge, hasConflicts, conflictStatusKnown, isBehind, changesRequested, ...(checks && { checks }) };
}

// GitHub counts these check-run conclusions and commit-status states against the PR, as its merge box does.
const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
const RUNNING_STATES = new Set(["PENDING", "EXPECTED"]);

/**
 * "failed" when any check or commit status failed, "running" when none failed but some are still
 * to finish; nothing when they all passed or the PR has none. A failure outranks running checks,
 * since the branch needs a fix either way.
 */
function checksState(rollup) {
  if (!Array.isArray(rollup)) return undefined;
  let running = false;
  for (const check of rollup) {
    if (!check || typeof check !== "object") continue;
    // A check run reports status + conclusion; a commit status (legacy API) reports a single state.
    const outcome = typeof check.conclusion === "string" ? check.conclusion : typeof check.state === "string" ? check.state : "";
    if (FAILED_CONCLUSIONS.has(outcome)) return "failed";
    const done = typeof check.status === "string" ? check.status === "COMPLETED" : !RUNNING_STATES.has(outcome);
    if (!done) running = true;
  }
  return running ? "running" : undefined;
}

module.exports = { readPullRequest, readPullRequests };
