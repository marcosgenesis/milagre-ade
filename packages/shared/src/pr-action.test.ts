import assert from "node:assert/strict";
import test from "node:test";
import { PR_ACTIONS, isPullRequestAction, pullRequestActionBody, pullRequestActionContext, pullRequestActionPrompt } from "./pr-action.mjs";
import { BLOCKERS } from "./pr-blockers.ts";

const url = "https://github.com/the-ptf/milagre-ade/pull/77";

test("a valid request becomes a pr-action context", () => {
  assert.deepEqual(pullRequestActionContext({ action: "checks-failed", pr: 77, url }), { kind: "pr-action", action: "checks-failed", pr: 77, url });
});

test("GitHub Enterprise pull request URLs are accepted", () => {
  const enterprise = "https://github.example.com/org/repo/pull/12";
  assert.equal(pullRequestActionContext({ action: "behind", pr: 12, url: enterprise })?.url, enterprise);
});

test("malformed requests are refused", () => {
  for (const request of [
    null,
    "checks-failed",
    { action: "deploy", pr: 77, url },
    { action: "checks-failed", url },
    { action: "checks-failed", pr: 0, url },
    { action: "checks-failed", pr: 7.5, url },
    { action: "checks-failed", pr: 78, url },
    { action: "checks-failed", pr: 77, url: "http://github.com/a/b/pull/77" },
    { action: "checks-failed", pr: 77, url: "https://github.com/a/b/pull/77/files" },
    { action: "toString", pr: 77, url },
  ]) {
    assert.equal(pullRequestActionContext(request), null, JSON.stringify(request));
  }
});

test("body is the short line the chat shows; prompt adds the URL and the skill token", () => {
  const context = pullRequestActionContext({ action: "checks-failed", pr: 77, url })!;
  assert.equal(pullRequestActionBody(context), "Fix CI on pull request #77");
  assert.equal(pullRequestActionPrompt(context), `Fix CI on pull request #77 (${url}). /milagre-fix-ci`);
});

test("every blocker has an action whose pill label is the one BLOCKERS shows", () => {
  for (const blocker of Object.keys(BLOCKERS) as (keyof typeof BLOCKERS)[]) {
    assert.equal(BLOCKERS[blocker].action, PR_ACTIONS[blocker].label);
    assert.match(PR_ACTIONS[blocker].skill, /^milagre-[a-z-]+$/);
  }
});

test("isPullRequestAction tells a pr-action context from the others", () => {
  assert.equal(isPullRequestAction({ kind: "pr-action", action: "behind", pr: 1, url }), true);
  assert.equal(isPullRequestAction({ kind: "git-action" }), false);
  assert.equal(isPullRequestAction(null), false);
  assert.equal(isPullRequestAction("handover"), false);
});
