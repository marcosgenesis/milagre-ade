import assert from "node:assert/strict";
import test from "node:test";
import { updateConflictDismissals } from "./conflict-action.ts";

const pr = { url: "https://github.com/example/repo/pull/77", state: "OPEN", hasConflicts: true };

test("a clicked conflict action stays dismissed through refreshes and failed lookups", () => {
  const dismissed = updateConflictDismissals([], pr, true);
  assert.deepEqual(dismissed, [pr.url]);
  assert.deepEqual(updateConflictDismissals(dismissed, pr), dismissed);
  assert.deepEqual(updateConflictDismissals(dismissed, null), dismissed);
  assert.deepEqual(updateConflictDismissals(dismissed, { ...pr, hasConflicts: false, conflictStatusKnown: false }), dismissed);
});

test("confirmed resolution allows the action for a later conflict", () => {
  const dismissed = updateConflictDismissals([], pr, true);
  const cleared = updateConflictDismissals(dismissed, { ...pr, hasConflicts: false });
  assert.deepEqual(cleared, []);
  assert.deepEqual(updateConflictDismissals(cleared, pr), []);
});

test("PR dismissal is independent of other repositories and PRs", () => {
  const other = { ...pr, url: "https://github.com/example/other/pull/77" };
  const dismissed = updateConflictDismissals([other.url], pr, true);
  assert.deepEqual(updateConflictDismissals(dismissed, { ...pr, state: "MERGED" }), [other.url]);
});
