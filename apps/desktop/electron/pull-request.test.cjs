const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readPullRequest, readPullRequests } = require("./pull-request.cjs");

const title = "Show pull requests in the chat sidebar";
const url = "https://github.com/example/project/pull/10213";
for (const state of ["OPEN", "MERGED"]) {
  test(`reads the current worktree's ${state.toLowerCase()} PR`, async () => {
    const exec = async (command, args, options) => {
      if (command === "git") return { stdout: "feature/sidebar\n" };
      assert.equal(command, "gh");
      assert.deepEqual(args, ["pr", "list", "--head", "feature/sidebar", "--state", "all", "--limit", "1", "--json", "number,url,state,title,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup"]);
      assert.equal(options.cwd, "/project/worktree");
      assert.ok(options.timeout > 0);
      return { stdout: JSON.stringify([{ number: 10213, url, state, title }]) };
    };
    assert.deepEqual(await readPullRequest("/project/worktree", exec), { number: 10213, url, state, title, readyToMerge: false, hasConflicts: false, conflictStatusKnown: false, isBehind: false, changesRequested: false });
  });
}

test("hides closed PRs and invalid metadata", async () => {
  for (const pr of [
    { number: 10213, url, state: "CLOSED" },
    { number: 10213, url: "javascript:alert(1)", state: "OPEN" },
    { number: 0, url, state: "OPEN" },
    null,
  ]) {
    assert.equal(await readPullRequest("/project", async () => ({ stdout: JSON.stringify(pr ? [pr] : []) })), null);
  }
});

test("missing PRs, unavailable gh, authentication failures and malformed responses do not break the sidebar", async () => {
  for (const message of ["no pull requests found", "ENOENT", "authentication required", "timeout"]) {
    assert.equal(await readPullRequest("/project", async () => { throw new Error(message); }), null);
  }
  assert.equal(await readPullRequest("/project", async () => ({ stdout: "not json" })), null);
});

// Fork PRs can be absent from `gh pr view` even though `gh pr list --head` finds them.
test("uses the checked-out branch for fork PRs instead of its upstream base", async () => {
  const exec = async (command, args) => {
    if (command === "git") {
      assert.deepEqual(args, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      return { stdout: "project-menu\n" };
    }
    assert.deepEqual(args, ["pr", "list", "--head", "project-menu", "--state", "all", "--limit", "1", "--json", "number,url,state,title,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup"]);
    return { stdout: JSON.stringify([{ number: 49, url: "https://github.com/example/project/pull/49", state: "MERGED", title }]) };
  };
  assert.deepEqual(await readPullRequest("/project", exec), { number: 49, url: "https://github.com/example/project/pull/49", state: "MERGED", title, readyToMerge: false, hasConflicts: false, conflictStatusKnown: false, isBehind: false, changesRequested: false });
});

for (const [name, overrides, ready] of [
  ["approved and clean", {}, true],
  ["not yet approved", { reviewDecision: "REVIEW_REQUIRED" }, false],
  ["changes requested", { reviewDecision: "CHANGES_REQUESTED" }, false],
  ["no review decision", { reviewDecision: null }, false],
  ["draft", { isDraft: true }, false],
  ["blocked", { mergeStateStatus: "BLOCKED" }, false],
  ["conflicts", { mergeStateStatus: "DIRTY" }, false],
  ["outdated branch", { mergeStateStatus: "BEHIND" }, false],
  ["non-passing checks", { mergeStateStatus: "UNSTABLE" }, false],
  ["unknown merge status", { mergeStateStatus: "UNKNOWN" }, false],
  ["already merged", { state: "MERGED" }, false],
]) {
  test(`merge readiness: ${name}`, async () => {
    const pr = { number: 10213, url, title, state: "OPEN", isDraft: false, reviewDecision: "APPROVED", mergeStateStatus: "CLEAN", ...overrides };
    const result = await readPullRequest("/project", async (command) => ({ stdout: command === "git" ? "feature/sidebar\n" : JSON.stringify([pr]) }));
    assert.equal(result.readyToMerge, ready);
  });
}

for (const [state, mergeStateStatus, expected] of [
  ["OPEN", "DIRTY", true],
  ["OPEN", "CLEAN", false],
  ["OPEN", "UNKNOWN", false],
  ["OPEN", "BLOCKED", false],
  ["MERGED", "DIRTY", false],
]) {
  test(`conflict status: ${state} / ${mergeStateStatus}`, async () => {
    const pr = { number: 10213, url, title, state, mergeStateStatus };
    const result = await readPullRequest("/project", async (command) => ({ stdout: command === "git" ? "feature/sidebar\n" : JSON.stringify([pr]) }));
    assert.equal(result.hasConflicts, expected);
    assert.equal(result.conflictStatusKnown, mergeStateStatus !== "UNKNOWN");
  });
}

test("reads a PR the chat created or merged by its URL or number", async () => {
  const calls = [];
  const exec = async (command, args, options) => {
    calls.push([command, args, options.cwd]);
    const ref = args[2];
    const number = Number(ref.split("/").at(-1));
    return { stdout: JSON.stringify({ number, url: `https://github.com/example/project/pull/${number}`, state: number === 84 ? "MERGED" : "OPEN", title, mergeStateStatus: number === 90 ? "DIRTY" : "CLEAN" }) };
  };
  assert.deepEqual(await readPullRequests("/project", ["https://github.com/example/project/pull/84", "90"], exec), [
    { number: 84, url: "https://github.com/example/project/pull/84", state: "MERGED", title, readyToMerge: false, hasConflicts: false, conflictStatusKnown: true, isBehind: false, changesRequested: false },
    { number: 90, url: "https://github.com/example/project/pull/90", state: "OPEN", title, readyToMerge: false, hasConflicts: true, conflictStatusKnown: true, isBehind: false, changesRequested: false },
  ]);
  assert.deepEqual(calls.map(([command, args, cwd]) => [command, args.slice(0, 3), cwd]), [
    ["gh", ["pr", "view", "https://github.com/example/project/pull/84"], "/project"],
    ["gh", ["pr", "view", "90"], "/project"],
  ]);
});

test("never passes a ref gh could read as a flag, and a failed lookup is null", async () => {
  let ran = 0;
  const exec = async () => { ran++; throw new Error("not found"); };
  assert.deepEqual(await readPullRequests("/project", ["--web", "-R", "javascript:alert(1)", "feature/x", 12, "91"], exec), [null, null, null, null, null, null]);
  assert.equal(ran, 1, "Only the numeric ref reached gh");
  assert.deepEqual(await readPullRequests("/project", "90", exec), []);
});

for (const [name, overrides, behind, changesRequested] of [
  ["outdated branch", { mergeStateStatus: "BEHIND" }, true, false],
  ["changes requested", { reviewDecision: "CHANGES_REQUESTED", mergeStateStatus: "BLOCKED" }, false, true],
  ["both", { reviewDecision: "CHANGES_REQUESTED", mergeStateStatus: "BEHIND" }, true, true],
  ["clean and approved", {}, false, false],
  ["merged", { state: "MERGED", reviewDecision: "CHANGES_REQUESTED", mergeStateStatus: "BEHIND" }, false, false],
]) {
  test(`blocking status: ${name}`, async () => {
    const pr = { number: 10213, url, title, state: "OPEN", isDraft: false, reviewDecision: "APPROVED", mergeStateStatus: "CLEAN", ...overrides };
    const result = await readPullRequest("/project", async (command) => ({ stdout: command === "git" ? "feature/sidebar\n" : JSON.stringify([pr]) }));
    assert.equal(result.isBehind, behind);
    assert.equal(result.changesRequested, changesRequested);
  });
}

const checkRun = (status, conclusion = null) => ({ __typename: "CheckRun", name: "CI / javascript", status, conclusion });
const commitStatus = (state) => ({ __typename: "StatusContext", context: "ci/legacy", state });
for (const [name, rollup, expected] of [
  ["one check still running", [checkRun("COMPLETED", "SUCCESS"), checkRun("IN_PROGRESS")], "running"],
  ["a queued check", [checkRun("QUEUED")], "running"],
  ["a pending commit status", [commitStatus("PENDING")], "running"],
  ["an expected commit status", [commitStatus("EXPECTED")], "running"],
  ["a failed check outranks running ones", [checkRun("IN_PROGRESS"), checkRun("COMPLETED", "FAILURE")], "failed"],
  ["a cancelled check", [checkRun("COMPLETED", "CANCELLED")], "failed"],
  ["a timed out check", [checkRun("COMPLETED", "TIMED_OUT")], "failed"],
  ["a failed commit status", [commitStatus("FAILURE")], "failed"],
  ["an errored commit status", [commitStatus("ERROR")], "failed"],
  ["all passed", [checkRun("COMPLETED", "SUCCESS"), commitStatus("SUCCESS")], undefined],
  ["skipped and neutral checks", [checkRun("COMPLETED", "SKIPPED"), checkRun("COMPLETED", "NEUTRAL")], undefined],
  ["no checks", [], undefined],
  ["rollup missing", undefined, undefined],
  ["malformed entries", [null, "x", {}], undefined],
]) {
  test(`checks state: ${name}`, async () => {
    const pr = { number: 10213, url, title, state: "OPEN", mergeStateStatus: "BLOCKED", statusCheckRollup: rollup };
    const result = await readPullRequest("/project", async (command) => ({ stdout: command === "git" ? "feature/sidebar\n" : JSON.stringify([pr]) }));
    assert.equal(result.checks, expected);
    assert.equal("checks" in result, expected !== undefined, "The field is only present while checks are running or failed");
  });
}

test("a merged PR reports no checks state even if its last run failed", async () => {
  const pr = { number: 10213, url, title, state: "MERGED", statusCheckRollup: [checkRun("COMPLETED", "FAILURE")] };
  const result = await readPullRequest("/project", async (command) => ({ stdout: command === "git" ? "feature/sidebar\n" : JSON.stringify([pr]) }));
  assert.equal("checks" in result, false);
});
