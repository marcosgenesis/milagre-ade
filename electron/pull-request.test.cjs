const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readPullRequest } = require("./pull-request.cjs");

const title = "Show pull requests in the chat sidebar";
const url = "https://github.com/example/project/pull/10213";
for (const state of ["OPEN", "MERGED"]) {
  test(`reads the current worktree's ${state.toLowerCase()} PR`, async () => {
    const exec = async (command, args, options) => {
      if (command === "git") return { stdout: "feature/sidebar\n" };
      assert.equal(command, "gh");
      assert.deepEqual(args, ["pr", "list", "--head", "feature/sidebar", "--state", "all", "--limit", "1", "--json", "number,url,state,title,isDraft,reviewDecision,mergeStateStatus"]);
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
    assert.deepEqual(args, ["pr", "list", "--head", "project-menu", "--state", "all", "--limit", "1", "--json", "number,url,state,title,isDraft,reviewDecision,mergeStateStatus"]);
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
