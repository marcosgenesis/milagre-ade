import assert from "node:assert/strict";
import test from "node:test";
import type { AgentQuestion } from "../model";
import { arrowTab, draftAnswers, nextTab, pickOption, primaryAction, primaryEnabled, questionAnswered, sendsOnPick, tabLabel, typeAnswer } from "./question-answers.ts";
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

test("a question is answered once it has a pick, or a typed answer where one is allowed", () => {
  assert.equal(questionAnswered(color, {}), false);
  assert.equal(questionAnswered(color, pickOption({}, color, "Red")), true);
  assert.equal(questionAnswered(color, typeAnswer({}, color, " x ")), true);
  assert.equal(questionAnswered(strict, typeAnswer({}, strict, "x")), false);
});

test("tabs are named by the question's header, or by position", () => {
  assert.equal(tabLabel(color, 0), "Color");
  assert.equal(tabLabel({ ...color, header: "  " }, 1), "Question 2");
});

test("the primary button is Next until the last question, then Send answers", () => {
  const questions = [color, fruits, strict];
  assert.equal(primaryAction(questions, 0), "next");
  assert.equal(primaryAction(questions, 1), "next");
  assert.equal(primaryAction(questions, 2), "send");
  assert.equal(primaryAction([color], 0), "send");
  const drafts = pickOption({}, fruits, "Apple");
  assert.equal(primaryEnabled(questions, drafts, 0), false);
  assert.equal(primaryEnabled(questions, drafts, 1), true);
  // Send needs every question answered, not just the active one.
  assert.equal(primaryEnabled(questions, pickOption(drafts, strict, "Red"), 2), false);
  assert.equal(primaryEnabled(questions, pickOption(pickOption(drafts, strict, "Red"), color, "Blue"), 2), true);
});

test("Next moves on by one and stays on the last question; arrows wrap around the tabs", () => {
  assert.equal(nextTab(3, 0), 1);
  assert.equal(nextTab(3, 2), 2);
  assert.equal(arrowTab(3, 0, "ArrowRight"), 1);
  assert.equal(arrowTab(3, 2, "ArrowRight"), 0);
  assert.equal(arrowTab(3, 0, "ArrowLeft"), 2);
  assert.equal(arrowTab(3, 1, "Home"), 0);
  assert.equal(arrowTab(3, 1, "End"), 2);
  assert.equal(arrowTab(3, 1, "Enter"), null);
});
