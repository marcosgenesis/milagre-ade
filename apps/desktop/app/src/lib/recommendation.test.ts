import assert from "node:assert/strict";
import test from "node:test";
import { parseRecommendation } from "./recommendation.ts";

const victor = `Good call. That means a diff stat cached per worktree. Here's the plan:
- **Where it's stored:** on each worktree in \`coordination.json\`.
- **When it's recalculated:** when a turn ends; when the window gets focus.

Two answers are still open:
1. **Getting archived chats back:** (a) an "Archived" filter in search with Unarchive, recommended, or (b) hide only.
2. **Archiving a running chat:** (a) stop the turn first, then archive, recommended, or (b) grey the item out while the chat runs.`;

const intro = "Some context.\n\n- **Stored:** per worktree.\n- **Updated:** on turn end.";
const valid = `${intro}\n\nWhich should I do first?\n\n1. **Archived filter** (recommended)\n2. Hide only\n`;

test("a reply that lists its own open questions is not a card", () => {
  assert.equal(parseRecommendation(victor), null);
});

test("a step list with no question is not a card", () => {
  assert.equal(parseRecommendation("Steps:\n1. Install\n2. Run"), null);
});

test("a valid card keeps the intro verbatim", () => {
  const result = parseRecommendation(valid);
  assert.ok(result);
  assert.equal(result.intro, intro);
  assert.equal(result.question, "Which should I do first?");
  assert.deepEqual(result.options, [
    { id: "recommendation-1", label: "Archived filter", recommended: true },
    { id: "recommendation-2", label: "Hide only", recommended: false },
  ]);
});

test("the question is the last sentence of its line", () => {
  const result = parseRecommendation("I looked at both. Which one?\n1. A\n2. B");
  assert.ok(result);
  assert.equal(result.question, "Which one?");
  assert.equal(result.intro, "I looked at both.");
});

test("without a marker nothing is recommended", () => {
  const result = parseRecommendation("Which one?\n1. A\n2. B");
  assert.deepEqual(result?.options.map((option) => option.recommended), [false, false]);
});

test("marker forms are recognised and only the first counts", () => {
  const result = parseRecommendation("Which?\n1. Alpha - Recommended\n2. Recommended: Beta\n3. Gamma, recommended");
  assert.deepEqual(result?.options.map((option) => [option.label, option.recommended]), [["Alpha", true], ["Beta", false], ["Gamma", false]]);
});

test("text after the list is not a card", () => {
  assert.equal(parseRecommendation("Which?\n1. A\n2. B\nLet me know."), null);
  assert.ok(parseRecommendation("Which?\n1. A\n2. B\n\n\n"));
});

test("an option ending in a question mark is not a card", () => {
  assert.equal(parseRecommendation("Which?\n1. A\n2. Or B?"), null);
});

test("an option over 120 characters is not a card", () => {
  assert.equal(parseRecommendation(`Which?\n1. ${"x".repeat(121)}\n2. B`), null);
  assert.ok(parseRecommendation(`Which?\n1. ${"x".repeat(120)}\n2. B`));
});

test("options that carry their own choices are not a card", () => {
  assert.equal(parseRecommendation("Which?\n1. (a) this or (b) that\n2. B"), null);
  assert.equal(parseRecommendation("Which?\n1. a) this b) that\n2. B"), null);
});

test("numbering must run 1..n with 2 to 6 items", () => {
  assert.equal(parseRecommendation("Which?\n2. A\n3. B"), null);
  assert.equal(parseRecommendation("Which?\n1. A\n3. B"), null);
  assert.equal(parseRecommendation("Which?\n1. A\n2. B\n3. C\n4. D\n5. E\n6. F\n7. G"), null);
  assert.ok(parseRecommendation("Which?\n1. A\n2. B\n3. C\n4. D\n5. E\n6. F"));
  assert.equal(parseRecommendation("Which?\n1. A"), null);
});

test("a list inside a code fence is not a card", () => {
  assert.equal(parseRecommendation("```\nWhich?\n1. A\n2. B"), null);
});

test("1) numbering works", () => {
  const result = parseRecommendation("Which?\n1) A\n2) B");
  assert.deepEqual(result?.options.map((option) => option.label), ["A", "B"]);
});
