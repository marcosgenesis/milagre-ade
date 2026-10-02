const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

/** Resolve the latest PR for the checked-out branch, including PRs submitted from a fork. */
async function readPullRequest(cwd, exec = execFileAsync) {
  try {
    const options = {
      cwd, encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    };
    const { stdout: branchOutput } = await exec("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], options);
    const branch = branchOutput.trim();
    if (!branch) return null;
    // `pr view` can infer the wrong head repository for a fork or a branch tracking main.
    const { stdout } = await exec("gh", ["pr", "list", "--head", branch, "--state", "all", "--limit", "1", "--json", "number,url,state,title,isDraft,reviewDecision,mergeStateStatus"], options);
    const pr = JSON.parse(stdout)[0];
    if (!pr || !["OPEN", "MERGED"].includes(pr.state) || !Number.isSafeInteger(pr.number) || pr.number <= 0) return null;
    const url = new URL(pr.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // CLEAN means GitHub reports the PR mergeable with passing commit status. Unknown or blocked
    // states must never advertise readiness, even if a reviewer has already approved.
    const readyToMerge = pr.state === "OPEN" && pr.isDraft === false && pr.reviewDecision === "APPROVED" && pr.mergeStateStatus === "CLEAN";
    const hasConflicts = pr.state === "OPEN" && pr.mergeStateStatus === "DIRTY";
    const conflictStatusKnown = typeof pr.mergeStateStatus === "string" && pr.mergeStateStatus !== "UNKNOWN";
    return { number: pr.number, url: url.href, state: pr.state, title: typeof pr.title === "string" ? pr.title : "", readyToMerge, hasConflicts, conflictStatusKnown };
  } catch {
    // No PR, offline, or gh unavailable: this optional metadata never blocks a chat.
    return null;
  }
}

module.exports = { readPullRequest };
