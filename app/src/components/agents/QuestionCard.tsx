import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { AgentQuestion, QuestionAnswers, QuestionRequest } from "../../model";
import { arrowTab, draftAnswers, draftOf, nextTab, pickOption, primaryAction, primaryEnabled, questionAnswered, sendsOnPick, tabLabel, typeAnswer } from "../../lib/question-answers";
import type { QuestionDrafts } from "../../lib/question-answers";
import { SPRING_PRESS, SPRING_SWAP } from "../../lib/ease";

/**
 * The open chat's oldest question: the agent's options as rows, an answer of the user's own, and Dismiss.
 * Several questions show one at a time, under a tab each.
 */
export function QuestionCard({ request, waiting, answering, onAnswer }: {
  request: QuestionRequest;
  /** How many more questions are queued behind this one. */
  waiting: number;
  /** What was already sent for this question, while the agent takes it. */
  answering: "answered" | "dismissed" | null;
  /** The answers to send, or null to dismiss the question. */
  onAnswer: (answers: QuestionAnswers | null) => void;
}) {
  const reduce = useReducedMotion();
  const [drafts, setDrafts] = useState<QuestionDrafts>({});
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const questions = request.questions;
  const count = questions.length;
  const several = count > 1;
  const question = questions[active];
  const answers = draftAnswers(questions, drafts);
  const pending = answering === null;
  const action = primaryAction(questions, active);
  const ready = primaryEnabled(questions, drafts, active);
  const description = `${count === 1 ? "The agent has a question." : `The agent has ${count} questions.`}${waiting > 0 ? ` ${waiting} more ${waiting === 1 ? "question is" : "questions are"} waiting after this one.` : ""}`;

  function pick(target: AgentQuestion, label: string) {
    const next = pickOption(drafts, target, label);
    setDrafts(next);
    // One single-choice question: the tap is the answer.
    const done = draftAnswers(questions, next);
    if (sendsOnPick(questions) && done) onAnswer(done);
  }

  function advance() {
    if (!ready) return;
    if (action === "next") setActive(nextTab(count, active));
    else if (answers) onAnswer(answers);
  }

  function handleFieldKeyDown(event: KeyboardEvent<HTMLInputElement>, target: AgentQuestion) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      advance();
    }
    // Escape clears a typed answer first; on an empty field it reaches the window, which dismisses the question.
    if (event.key === "Escape" && !event.nativeEvent.isComposing && draftOf(drafts, target.id).typed) {
      event.preventDefault();
      setDrafts(typeAnswer(drafts, target, ""));
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = arrowTab(count, active, event.key);
    if (index === null) return;
    event.preventDefault();
    setActive(index);
    tabRefs.current[index]?.focus();
  }

  const draft = draftOf(drafts, question.id);

  return (
    <motion.section
      role="dialog"
      aria-label="Agent question"
      aria-description={description}
      aria-busy={answering === "answered"}
      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? undefined : { opacity: 0, y: 6, scale: 0.985 }}
      transition={reduce ? { duration: 0 } : SPRING_SWAP}
      className="flex max-h-[min(72vh,620px)] w-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-overlay"
    >
      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto overscroll-contain p-4 [scrollbar-width:thin]">
        {several && (
          <div role="tablist" aria-label="Questions" className="flex flex-wrap gap-1.5">
            {questions.map((item, index) => {
              const selected = index === active;
              return (
                <button
                  key={item.id}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  type="button"
                  role="tab"
                  id={`question-tab-${item.id}`}
                  aria-selected={selected}
                  aria-controls="question-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActive(index)}
                  onKeyDown={handleTabKeyDown}
                  className={`inline-flex items-center gap-1 rounded-chip border px-2 py-1 text-xs font-medium transition-colors ${selected ? "border-line-strong text-ink" : "border-transparent text-ink-3 hover:text-ink-2"}`}
                >
                  {questionAnswered(item, drafts) && <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2.2} color="currentColor" />}
                  {tabLabel(item, index)}
                </button>
              );
            })}
          </div>
        )}

        <div
          key={question.id}
          id="question-panel"
          role={several ? "tabpanel" : question.multiSelect ? "group" : "radiogroup"}
          aria-labelledby={several ? `question-tab-${question.id}` : undefined}
          aria-label={several ? undefined : question.question}
          className="grid gap-1.5"
        >
          <h2 className="text-sm font-semibold text-ink">{question.question}</h2>
          {question.multiSelect && <p className="text-xs text-ink-3">Pick any that apply.</p>}
          {question.options.map((option, index) => {
            const picked = draft.picked.includes(option.label);
            return (
              <motion.button
                key={`${index}-${option.label}`}
                type="button"
                role={question.multiSelect ? "checkbox" : "radio"}
                aria-checked={picked}
                disabled={!pending}
                onClick={() => pick(question, option.label)}
                whileTap={reduce || !pending ? undefined : { scale: 0.99 }}
                transition={SPRING_PRESS}
                className={`flex w-full items-start gap-2.5 rounded-control border px-2.5 py-2 text-left transition-colors disabled:cursor-default ${picked ? "border-line-strong bg-inset" : "border-line bg-surface hover:border-line-strong hover:bg-hover disabled:hover:border-line disabled:hover:bg-surface"}`}
              >
                <span aria-hidden className={`mt-0.5 flex size-4 shrink-0 items-center justify-center border ${question.multiSelect ? "rounded-[5px]" : "rounded-full"} ${picked ? "border-ink bg-ink text-surface" : "border-line-strong bg-surface"}`}>
                  {picked && <HugeiconsIcon icon={Tick02Icon} size={11} strokeWidth={2.4} color="currentColor" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium leading-5 text-ink">{option.label}</span>
                  {option.description && <span className="block text-xs leading-5 text-ink-2">{option.description}</span>}
                </span>
              </motion.button>
            );
          })}
          {question.allowOther && (
            <input
              type={question.secret ? "password" : "text"}
              value={draft.typed}
              disabled={!pending}
              onChange={(event) => setDrafts(typeAnswer(drafts, question, event.target.value))}
              onKeyDown={(event) => handleFieldKeyDown(event, question)}
              placeholder={question.options.length ? "Other…" : "Type your answer"}
              aria-label={`Your own answer to: ${question.question}`}
              autoComplete="off"
              className="w-full rounded-control border border-line bg-field px-2.5 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong"
            />
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {pending && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: 6 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className={`flex flex-wrap gap-2 border-t border-line bg-inset px-4 py-3 ${several ? "justify-start" : "justify-end"}`}
          >
            <motion.button type="button" onClick={() => onAnswer(null)} whileTap={reduce ? undefined : { scale: 0.97 }} transition={SPRING_PRESS} className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-hover">
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.8} color="currentColor" />
              Dismiss
            </motion.button>
            <motion.button type="button" disabled={!ready} onClick={advance} whileTap={reduce || !ready ? undefined : { scale: 0.97 }} transition={SPRING_PRESS} className="inline-flex items-center gap-1.5 rounded-control bg-ink px-3 py-2 text-xs font-medium text-surface transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-40">
              <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} color="currentColor" />
              {action === "next" ? "Next" : count === 1 ? "Send answer" : "Send answers"}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
