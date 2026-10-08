const assert = require("node:assert/strict");
const test = require("node:test");
const { isIssueKey, issueKeyInBranch } = require("./links.cjs");

test("an issue key is a team prefix and a number", () => {
  assert.equal(isIssueKey("ENG-12"), true);
  assert.equal(isIssueKey("eng-12"), true);
  assert.equal(isIssueKey("abcdefg-1"), true);
  assert.equal(isIssueKey("abcdefgh-1"), false);
  assert.equal(isIssueKey("ENG-"), false);
  assert.equal(isIssueKey("1ENG-2"), false);
  assert.equal(isIssueKey("ENG-12 fix"), false);
});

test("a branch names its issue by the first key whose team exists in the workspace", () => {
  const teams = new Set(["ENG", "WEB"]);
  assert.equal(issueKeyInBranch("eng-12-fix-login", teams), "ENG-12");
  assert.equal(issueKeyInBranch("feature/web-34/redo", teams), "WEB-34");
  assert.equal(issueKeyInBranch("milagre/fix-login-ab12", teams), null);
  // A number like 2024-01 or a team nobody has is not an issue.
  assert.equal(issueKeyInBranch("release-2024-01", teams), null);
  assert.equal(issueKeyInBranch("ops-9-then-eng-12", teams), "ENG-12");
  assert.equal(issueKeyInBranch("xeng-12", teams), null);
});
