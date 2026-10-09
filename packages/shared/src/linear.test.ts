import assert from "node:assert/strict";
import { test } from "node:test";
import { issueChipLabel, issueFirstMessage, LINK_PR_HINT, linearStatusLine, restoredDraft, type LinearIssue, type LinearStatus } from "./linear.ts";

const connected: LinearStatus = {
  connected: true,
  viewer: { name: "Victor", email: "victor@example.com" },
  organization: { name: "Acme", urlKey: "acme" },
};

test("a connected status names the user and the workspace on both platforms", () => {
  assert.equal(linearStatusLine(connected, "mac"), "Connected as Victor to Acme");
  assert.equal(linearStatusLine(connected, "phone"), "Connected as Victor to Acme");
});

test("a disconnected phone is told to connect on the Mac", () => {
  assert.equal(linearStatusLine({ connected: false }, "mac"), "Not connected");
  assert.equal(linearStatusLine({ connected: false }, "phone"), "Connect Linear from Settings on your Mac");
});

const issue: LinearIssue = {
  key: "ENG-12",
  title: "Fix login redirect",
  url: "https://linear.app/acme/issue/ENG-12/fix-login-redirect",
  branchName: "eng-12-fix-login-redirect",
  state: { name: "In Progress", type: "started", color: "#f2c94c" },
};

test("a Chat started from an issue opens with its key, title, description and URL, then what the user typed", () => {
  assert.equal(issueFirstMessage(issue), `Work on Linear issue ENG-12: Fix login redirect\n\n${issue.url}`);
  assert.equal(
    issueFirstMessage({ ...issue, description: "Users bounce to /home." }, "  check Safari too  "),
    `Work on Linear issue ENG-12: Fix login redirect\n\nUsers bounce to /home.\n\n${issue.url}\n\ncheck Safari too`,
  );
  assert.equal(issueFirstMessage(issue, "   "), issueFirstMessage(issue));
});

test("an issue chip reads its key and state name", () => {
  assert.equal(issueChipLabel(issue), "ENG-12 · In Progress");
});

test("a failed send from an issue restores only what the user typed, never the issue message", () => {
  const message = issueFirstMessage(issue, "fix it");
  assert.equal(restoredDraft(message, "fix it", true), "fix it");
  assert.equal(restoredDraft(message, "", true), "");
  assert.equal(restoredDraft("plain text", "plain text", false), "plain text");
  assert.equal(restoredDraft("plain text", "", false), "plain text");
});

test("a linked branch that doesn't name its issue tells the user to put the key in the PR", () => {
  assert.equal(LINK_PR_HINT("ENG-12"), 'Add "Fixes ENG-12" to the PR description so Linear tracks it.');
});
