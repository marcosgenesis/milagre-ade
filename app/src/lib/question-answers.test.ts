import assert from "node:assert/strict";
import test from "node:test";
import type { AgentQuestion } from "../model";
import { draftAnswers, pickOption, sendsOnPick, typeAnswer } from "./question-answers.ts";
import type { QuestionDrafts } from "./question-answers.ts";

const color: AgentQuestion = { id: "color", header: "Color", question: "Which color?", options: [{ label: "Red" }, { label: "Green" }, { label: "Blue" }], multiSelect: false, allowOther: true, secret: false };
const fruits: AgentQuestion = { id: "fruits", header: "Fruit", question: "Which fruits?", options: [{ label: "Apple" }, { label: "Banana" }, { label: "Cherry" }], multiSelect: true, allowOther: true, secret: false };
const strict: AgentQuestion = { ...color, id: "strict", allowOther: false };

test("a single-choice question keeps one option, and a typed answer replaces it", () => {
  let drafts: QuestionDrafts = {};
  drafts = pickOption(drafts, color, "Red");
  drafts = pickOption(drafts, color, "Green");
  assert.deepEqual(drafts.color, { picked: ["Green"], typed: "" });
  drafts = typeAnswer(drafts, color, "Purple");
  assert.deepEqual(drafts.color, { picked: [], typed: "Purple" });
  drafts = pickOption(drafts, color, "Blue");
  assert.deepEqual(drafts.color, { picked: ["Blue"], typed: "" });
  assert.deepEqual(typeAnswer(drafts, color, "   ").color, { picked: ["Blue"], typed: "   " });
});

test("a multi-select question toggles options and adds a typed answer", () => {
  let drafts: QuestionDrafts = {};
  for (const label of ["Cherry", "Apple", "Banana", "Banana"]) drafts = pickOption(drafts, fruits, label);
  drafts = typeAnswer(drafts, fruits, " Mango ");
  assert.deepEqual(drafts.fruits, { picked: ["Cherry", "Apple"], typed: " Mango " });
  assert.deepEqual(draftAnswers([fruits], drafts), { fruits: ["Apple", "Cherry", "Mango"] });
});

test("answers are ready only once every question has one", () => {
  const drafts = pickOption({}, color, "Red");
  assert.equal(draftAnswers([color, fruits], drafts), null);
  assert.deepEqual(draftAnswers([color, fruits], typeAnswer(drafts, fruits, "Kiwi")), { color: ["Red"], fruits: ["Kiwi"] });
  assert.equal(draftAnswers([color], typeAnswer({}, color, "  ")), null);
  assert.equal(draftAnswers([strict], typeAnswer({}, strict, "Purple")), null);
  assert.deepEqual(draftAnswers([strict], pickOption({}, strict, "Red")), { strict: ["Red"] });
});

test("only a lone single-choice question sends on the first pick", () => {
  assert.equal(sendsOnPick([color]), true);
  assert.equal(sendsOnPick([fruits]), false);
  assert.equal(sendsOnPick([color, strict]), false);
  assert.equal(sendsOnPick([]), false);
});
