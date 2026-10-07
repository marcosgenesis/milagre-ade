import assert from "node:assert/strict";
import { test } from "node:test";
import { ARTIFACT_CSP, artifactDocument, chosenDesign, designChoiceMessage, designCommentsMessage } from "./artifact.ts";
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

test("comments name each design and where on it they were pinned", () => {
  const login = { id: "login", version: 2, title: "Login" };
  assert.equal(
    designCommentsMessage([
      { design: login, x: 0.42, y: 0.181, text: " Bigger button " },
      { design: { id: "home", version: 1, title: "Home" }, text: "Too busy" },
    ]),
    'Comments on the designs:\n\n1. On the design "Login" (login, version 2), 42% across and 18% down: Bigger button\n2. On the design "Home" (home, version 1): Too busy\n\nRevise them with artifact_show and keep their ids.',
  );
});

test("the chosen design reads back from the last choice message", () => {
  const choice = designChoiceMessage({ id: "home-b", version: 3, title: "Home, variant B" });
  assert.equal(choice, 'I chose the design "Home, variant B" (home-b, version 3). Continue from this one.');
  assert.deepEqual(chosenDesign(["hi", designChoiceMessage({ id: "a", version: 1, title: "A" }), choice, "thanks"]), { id: "home-b", version: 3 });
  assert.equal(chosenDesign(['I chose the design "x" (y, version 1). Continue from this one. And more']), null);
});
