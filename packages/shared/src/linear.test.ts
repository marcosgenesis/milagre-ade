import assert from "node:assert/strict";
import { test } from "node:test";
import { issueChipLabel, issueFirstMessage, linearStatusLine, type LinearIssue, type LinearStatus } from "./linear.ts";

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
