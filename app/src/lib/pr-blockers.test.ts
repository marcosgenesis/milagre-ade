import assert from "node:assert/strict";
import test from "node:test";
import { blockerPrompt, isBlockerDismissed, pullRequestBlockers, updateBlockerDismissals } from "./pr-blockers.ts";

const pr = { number: 77, url: "https://github.com/example/repo/pull/77", state: "OPEN", hasConflicts: true };

test("a clicked conflict action stays dismissed through refreshes and failed lookups", () => {
  const dismissed = updateBlockerDismissals([], pr, "conflicts");
  assert.deepEqual(dismissed, [pr.url]);
  assert.deepEqual(updateBlockerDismissals(dismissed, pr), dismissed);
  assert.deepEqual(updateBlockerDismissals(dismissed, null), dismissed);
  assert.deepEqual(updateBlockerDismissals(dismissed, { ...pr, hasConflicts: false, conflictStatusKnown: false }), dismissed);
});

test("confirmed resolution allows the action for a later conflict", () => {
  const dismissed = updateBlockerDismissals([], pr, "conflicts");
  const cleared = updateBlockerDismissals(dismissed, { ...pr, hasConflicts: false });
  assert.deepEqual(cleared, []);
  assert.deepEqual(updateBlockerDismissals(cleared, pr), []);
});

test("PR dismissal is independent of other repositories and PRs", () => {
  const other = { ...pr, url: "https://github.com/example/other/pull/77" };
  const dismissed = updateBlockerDismissals([other.url], pr, "conflicts");
  assert.deepEqual(updateBlockerDismissals(dismissed, { ...pr, state: "MERGED" }), [other.url]);
});

test("blockers are ordered conflicts, requested changes, then an outdated branch", () => {
  assert.deepEqual(pullRequestBlockers({ ...pr, isBehind: true, changesRequested: true }), ["conflicts", "changes-requested", "behind"]);
  assert.deepEqual(pullRequestBlockers({ ...pr, hasConflicts: false, isBehind: true }), ["behind"]);
  assert.deepEqual(pullRequestBlockers({ ...pr, state: "MERGED", changesRequested: true }), []);
  assert.deepEqual(pullRequestBlockers(null), []);
});

test("each blocker is dismissed and cleared on its own", () => {
  const blocked = { ...pr, hasConflicts: false, isBehind: true, changesRequested: true };
  let dismissed = updateBlockerDismissals([], blocked, "behind");
  dismissed = updateBlockerDismissals(dismissed, blocked, "changes-requested");
  assert.ok(isBlockerDismissed(dismissed, "behind", blocked));
  assert.ok(isBlockerDismissed(dismissed, "changes-requested", blocked));
  assert.ok(!isBlockerDismissed(dismissed, "conflicts", blocked));

  // The branch was updated but the reviewer hasn't approved yet.
  dismissed = updateBlockerDismissals(dismissed, { ...blocked, isBehind: false });
  assert.ok(!isBlockerDismissed(dismissed, "behind", blocked));
  assert.ok(isBlockerDismissed(dismissed, "changes-requested", blocked));
});

test("an unknown merge state doesn't clear an outdated-branch dismissal", () => {
  const behind = { ...pr, hasConflicts: false, isBehind: true };
  const dismissed = updateBlockerDismissals([], behind, "behind");
  assert.deepEqual(updateBlockerDismissals(dismissed, { ...behind, isBehind: false, conflictStatusKnown: false }), dismissed);
});

test("clicking an action for a blocker the PR no longer has dismisses nothing", () => {
  assert.deepEqual(updateBlockerDismissals([], pr, "behind"), []);
});

test("the review prompt names the PR so the agent can read its comments", () => {
  assert.match(blockerPrompt("changes-requested", pr), /#77/);
  assert.match(blockerPrompt("changes-requested", pr), /pulls\/77\/comments/);
});
