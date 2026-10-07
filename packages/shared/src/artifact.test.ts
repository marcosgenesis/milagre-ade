import assert from "node:assert/strict";
import { test } from "node:test";
import { ARTIFACT_CSP, artifactDocument, chosenDesign, designFeedbackMessage, parseDesignFeedback } from "./artifact.ts";
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

test("feedback names each design and where on it a comment was pinned", () => {
  const login = { id: "login", version: 2, title: "Login" };
  assert.equal(
    designFeedbackMessage({
      comments: [
        { design: login, x: 0.42, y: 0.181, text: " Bigger button " },
        { design: { id: "home", version: 1, title: "Home" }, text: "Too busy" },
      ],
    }),
    'Comments on the designs:\n\n1. On the design "Login" (login, version 2), 42% across and 18% down: Bigger button\n2. On the design "Home" (home, version 1): Too busy\n\nRevise them with artifact_show and keep their ids.',
  );
});

test("a choice leads the feedback, and reads back as the chosen design", () => {
  const choice = { id: "home-b", version: 3, title: "Home, variant B" };
  const alone = designFeedbackMessage({ choice, comments: [] });
  assert.equal(alone, 'I chose the design "Home, variant B" (home-b, version 3). Continue from this one.');
  const both = designFeedbackMessage({ choice, comments: [{ design: choice, text: "Darker" }] });
  assert.match(both, /^I chose the design "Home, variant B" \(home-b, version 3\)\. Continue from this one\.\n\nA comment on the designs:/);
  assert.deepEqual(chosenDesign(["hi", designFeedbackMessage({ choice: { id: "a", version: 1, title: "A" }, comments: [] }), both, "thanks"]), {
    id: "home-b",
    version: 3,
  });
  assert.equal(chosenDesign(['I chose the design "x" (y, version 1). Continue from this one. And more']), null);
});

test("a reply shows each design once, at the newest version it made", () => {
  const show = (id: string, version: number) => ({
    id: `${id}${version}`,
    kind: "artifact" as const,
    title: "Showed",
    status: "done" as const,
    offset: 0,
    artifact: { id, version, title: id },
  });
  const reply = replyActivity("Three designs.", [show("home", 1), show("alt-b", 1), show("home", 2), show("alt-c", 1)]);
  assert.deepEqual(
    reply.artifacts.map((step) => [step.artifact.id, step.artifact.version]),
    [
      ["home", 2],
      ["alt-b", 1],
      ["alt-c", 1],
    ],
  );
});

test("feedback reads back from its message, and nothing else does", () => {
  const choice = { id: "home", version: 2, title: 'Home "B"' };
  const comments = [
    { design: { id: "login", version: 1, title: "Login" }, x: 0.55, y: 0.38, text: "I don't like this yellow" },
    { design: choice, text: "More air: here" },
  ];
  assert.deepEqual(parseDesignFeedback(designFeedbackMessage({ choice, comments })), { choice, comments });
  assert.deepEqual(parseDesignFeedback(designFeedbackMessage({ choice, comments: [] })), { choice, comments: [] });
  assert.deepEqual(parseDesignFeedback(designFeedbackMessage({ comments: [comments[0]!] })), { choice: null, comments: [comments[0]] });
  assert.equal(parseDesignFeedback("make it warmer"), null);
  assert.equal(parseDesignFeedback(`${designFeedbackMessage({ comments })}\n\nAnd one more thing`), null);
});
