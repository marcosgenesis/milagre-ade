import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { KeyboardEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, HelpCircleIcon, Loading03Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { AgentQuestion, QuestionAnswers, QuestionRequest } from "../../model";
import { draftAnswers, draftOf, pickOption, sendsOnPick, typeAnswer } from "../../lib/question-answers";
import type { QuestionDrafts } from "../../lib/question-answers";
import { SPRING_PRESS, SPRING_SWAP } from "../../lib/ease";

/** The open chat's oldest question: the agent's options as rows, an answer of the user's own, and Dismiss. */
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
  const answers = draftAnswers(request.questions, drafts);
  const pending = answering === null;
  const count = request.questions.length;
  const queued = waiting > 0 ? `${waiting} more ${waiting === 1 ? "question is" : "questions are"} waiting after this one.` : "";

  function pick(question: AgentQuestion, label: string) {
    const next = pickOption(drafts, question, label);
    setDrafts(next);
    // One single-choice question: the tap is the answer.
    const ready = draftAnswers(request.questions, next);
    if (sendsOnPick(request.questions) && ready) onAnswer(ready);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, question: AgentQuestion) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (answers) onAnswer(answers);
    }
    // Escape clears a typed answer first; on an empty field it reaches the window, which dismisses the question.
    if (event.key === "Escape" && !event.nativeEvent.isComposing && draftOf(drafts, question.id).typed) {
      event.preventDefault();
      setDrafts(typeAnswer(drafts, question, ""));
    }
  }

  return (
    <motion.section
      role="dialog"
      aria-label="Agent question"
      aria-busy={answering === "answered"}
      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? undefined : { opacity: 0, y: 6, scale: 0.985 }}
      transition={reduce ? { duration: 0 } : SPRING_SWAP}
      className="flex max-h-[min(72vh,620px)] w-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-overlay"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-ink-3">{count === 1 ? "The agent has a question" : `The agent has ${count} questions`}</p>
          {queued && <p className="mt-0.5 text-xs leading-5 text-ink-2">{queued}</p>}
        </div>
        <StatusChip answering={answering} reduce={Boolean(reduce)} />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto overscroll-contain px-4 pt-3 pb-4 [scrollbar-width:thin]">
        {request.questions.map((question) => {
          const draft = draftOf(drafts, question.id);
          return (
            <div key={question.id} role={question.multiSelect ? "group" : "radiogroup"} aria-label={question.question} className="grid gap-1.5">
              <div className="flex flex-wrap items-baseline gap-2">
                {question.header && <span className="rounded-chip bg-inset px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">{question.header}</span>}
                <h2 className="text-sm font-semibold text-ink">{question.question}</h2>
              </div>
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
                    className={`flex w-full items-start gap-2.5 rounded-control border px-2.5 py-2 text-left transition-colors disabled:cursor-default ${picked ? "border-accent/40 bg-accent-tint" : "border-line bg-surface hover:border-line-strong hover:bg-hover disabled:hover:border-line disabled:hover:bg-surface"}`}
                  >
                    <span aria-hidden className={`mt-0.5 flex size-4 shrink-0 items-center justify-center border ${question.multiSelect ? "rounded-[5px]" : "rounded-full"} ${picked ? "border-accent bg-accent text-white" : "border-line-strong bg-surface"}`}>
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
                  onKeyDown={(event) => handleKeyDown(event, question)}
                  placeholder={question.options.length ? "Or type your own answer" : "Type your answer"}
                  aria-label={`Your own answer to: ${question.question}`}
                  autoComplete="off"
                  className={`w-full rounded-control border bg-field px-2.5 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent/50 ${draft.typed.trim() ? "border-accent/40" : "border-line"}`}
                />
              )}
            </div>
          );
        })}
      </div>

      <AnimatePresence initial={false}>
        {pending && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: 6 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="flex flex-wrap justify-end gap-2 border-t border-line bg-inset px-4 py-3"
          >
            <motion.button type="button" onClick={() => onAnswer(null)} whileTap={reduce ? undefined : { scale: 0.97 }} transition={SPRING_PRESS} className="rounded-control border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-hover">
              Dismiss
            </motion.button>
            <motion.button type="button" disabled={!answers} onClick={() => answers && onAnswer(answers)} whileTap={reduce || !answers ? undefined : { scale: 0.97 }} transition={SPRING_PRESS} className="rounded-control bg-ink px-3 py-2 text-xs font-medium text-surface transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-40">
              {count === 1 ? "Send answer" : "Send answers"}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function StatusChip({ answering, reduce }: { answering: "answered" | "dismissed" | null; reduce: boolean }) {
  if (answering === "dismissed") return <span className="inline-flex shrink-0 items-center gap-1 rounded-chip border border-line bg-inset px-2 py-1 text-[10px] font-semibold text-ink-3"><HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.8} color="currentColor" />Dismissed</span>;
  if (answering === "answered") return <span className="inline-flex shrink-0 items-center gap-1 rounded-chip border border-accent/30 bg-accent-tint px-2 py-1 text-[10px] font-semibold text-accent-ink"><span className={reduce ? undefined : "animate-spin"}><HugeiconsIcon icon={Loading03Icon} size={14} strokeWidth={1.8} color="currentColor" /></span>Sending</span>;
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-chip border border-orange/30 bg-orange-tint px-2 py-1 text-[10px] font-semibold text-orange"><HugeiconsIcon icon={HelpCircleIcon} size={14} strokeWidth={1.8} color="currentColor" />Needs your answer</span>;
}
