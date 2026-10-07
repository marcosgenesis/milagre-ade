import assert from "node:assert/strict";
import { test } from "node:test";
import { ARTIFACT_CSP, artifactDocument } from "./artifact.ts";
import { replyActivity } from "./reply-parts.ts";

const policy = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;

test("the policy opens the design's head", () => {
  assert.equal(
    artifactDocument('<!doctype html><html><head lang="en"><title>x</title></head></html>'),
    `<!doctype html><html><head lang="en">${policy}<title>x</title></head></html>`,
  );
});

test("a design without a head gets one inside its html element", () => {
  assert.equal(artifactDocument("<html><body>hi</body></html>"), `<html><head>${policy}</head><body>hi</body></html>`);
});

test("a fragment becomes a document that starts with the policy", () => {
  const html = artifactDocument("<div>hi</div>");
  assert.match(html, /^<!doctype html><head>.*Content-Security-Policy.*<\/head><div>hi<\/div>$/);
});

test("the policy blocks requests the design makes itself", () => {
  assert.match(ARTIFACT_CSP, /default-src 'none'/);
  assert.doesNotMatch(ARTIFACT_CSP, /connect-src/);
});

test("a finished design leaves the activity to show as a card; one still running or failed stays a row", () => {
  const done = {
    id: "a",
    kind: "artifact" as const,
    title: "Showed `Login`",
    status: "done" as const,
    offset: 0,
    artifact: { id: "x1", version: 1, title: "Login" },
  };
  const running = { id: "b", kind: "artifact" as const, title: "Showed `Card`", status: "running" as const, offset: 0 };
  const reply = replyActivity("Here it is.", [done, running]);
  assert.deepEqual(reply.artifacts, [done]);
  assert.deepEqual(reply.activity, [{ type: "step", step: running }]);
});
