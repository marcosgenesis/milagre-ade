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
      assert.deepEqual(args, ["pr", "list", "--head", "feature/sidebar", "--state", "all", "--limit", "1", "--json", "number,url,state,title"]);
      assert.equal(options.cwd, "/project/worktree");
      assert.ok(options.timeout > 0);
      return { stdout: JSON.stringify([{ number: 10213, url, state, title }]) };
    };
    assert.deepEqual(await readPullRequest("/project/worktree", exec), { number: 10213, url, state, title });
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
    assert.deepEqual(args, ["pr", "list", "--head", "project-menu", "--state", "all", "--limit", "1", "--json", "number,url,state,title"]);
    return { stdout: JSON.stringify([{ number: 49, url: "https://github.com/example/project/pull/49", state: "MERGED", title }]) };
  };
  assert.deepEqual(await readPullRequest("/project", exec), { number: 49, url: "https://github.com/example/project/pull/49", state: "MERGED", title });
});
