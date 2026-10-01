import type { AgentQuestion, QuestionAnswers } from "../model";

/** What the user has picked and typed for one question on a question card. */
export interface QuestionDraft {
  picked: string[];
  typed: string;
}

/** Drafts by question id. */
export type QuestionDrafts = Record<string, QuestionDraft>;

export function draftOf(drafts: QuestionDrafts, questionId: string): QuestionDraft {
  return drafts[questionId] ?? { picked: [], typed: "" };
}

/** Picks an option. A single-choice question keeps only that option and drops a typed answer; a multi-select one toggles it. */
export function pickOption(drafts: QuestionDrafts, question: AgentQuestion, label: string): QuestionDrafts {
  const draft = draftOf(drafts, question.id);
  if (!question.multiSelect) return { ...drafts, [question.id]: { picked: [label], typed: "" } };
  const picked = draft.picked.includes(label) ? draft.picked.filter((item) => item !== label) : [...draft.picked, label];
  return { ...drafts, [question.id]: { ...draft, picked } };
}

/** Types an answer of the user's own. On a single-choice question it replaces the picked option. */
export function typeAnswer(drafts: QuestionDrafts, question: AgentQuestion, typed: string): QuestionDrafts {
  const draft = draftOf(drafts, question.id);
  const picked = !question.multiSelect && typed.trim() ? [] : draft.picked;
  return { ...drafts, [question.id]: { picked, typed } };
}

/** The answers to send: picks in the agent's option order, then the typed answer. Null while a question has none. */
export function draftAnswers(questions: AgentQuestion[], drafts: QuestionDrafts): QuestionAnswers | null {
  const answers: QuestionAnswers = {};
  for (const question of questions) {
    const draft = draftOf(drafts, question.id);
    const picked = question.options.map((option) => option.label).filter((label) => draft.picked.includes(label));
    const typed = question.allowOther ? draft.typed.trim() : "";
    const values = typed ? [...picked, typed] : picked;
    if (!values.length) return null;
    answers[question.id] = values;
  }
  return answers;
}

/** A card with one single-choice question sends as soon as an option is picked. */
export function sendsOnPick(questions: AgentQuestion[]): boolean {
  return questions.length === 1 && !questions[0].multiSelect;
}
