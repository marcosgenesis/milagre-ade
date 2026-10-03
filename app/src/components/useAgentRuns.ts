import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSendRequest, CoordinatorState, PermissionDecision, QuestionAnswers } from "../model";
import { applyRunEvent, clearAnswered, markAnswered, projectOfKey } from "../lib/agent-runs";
import { answerSummary } from "../lib/question-answers";
import type { AgentRuns, SentAnswer } from "../lib/agent-runs";

/**
 * Streams agent turns per chat, in every project, so a chat in a project that isn't open keeps
 * its run and its cards for when the project opens again, and a reload picks them up. The main process saves each turn; an
 * event that changed a project's state brings that state along, handed to `onState`.
 * `modelFor(chatId)` names the model of a turn that starts without a message from this window.
 */
export function useAgentRuns(onState: (projectPath: string, state: CoordinatorState) => void, modelFor: (chatId: string) => string = () => "") {
  const [runs, setRuns] = useState<AgentRuns>({});
  const runsRef = useRef(runs);
  const onStateRef = useRef(onState);
  const modelForRef = useRef(modelFor);
  onStateRef.current = onState;
  modelForRef.current = modelFor;

  const setAll = useCallback((next: AgentRuns) => {
    runsRef.current = next;
    setRuns(next);
  }, []);

  // The run and the state change in one render, so a finished reply never shows twice or goes missing.
  // A window that loads mid-turn takes the turns from the main process, and skips the events they hold.
  useEffect(() => {
    let taken = 0;
    const unsubscribe = window.milagre.onAgentEvent(({ chatId, event, state, seq }) => {
      if (seq === undefined || seq > taken) setAll(applyRunEvent(runsRef.current, chatId, event, event.type === "turn-started" ? modelForRef.current(chatId) : ""));
      if (state) onStateRef.current(projectOfKey(chatId), state);
    });
    void window.milagre.getRuns().then((snapshot) => {
      taken = snapshot.seq;
      setAll(snapshot.runs);
    }).catch(() => {});
    return unsubscribe;
  }, [setAll]);

  /** Saves the message and starts or steers its chat's turn; resolves with the chat's session id. */
  const send = useCallback((request: ChatSendRequest) => window.milagre.sendMessage(request), []);

  const interrupt = useCallback((chatId: string) => window.milagre.interruptAgent(chatId), []);

  /** Sends the user's answer. The card shows it as sent until the agent takes it, and goes back to pending if it doesn't arrive. */
  const answer = useCallback(async (chatId: string, requestId: string, sent: SentAnswer, deliver: () => Promise<boolean>) => {
    setAll(markAnswered(runsRef.current, chatId, requestId, sent));
    try {
      const accepted = await deliver();
      if (!accepted) setAll(clearAnswered(runsRef.current, chatId, requestId));
      return accepted;
    } catch (error) {
      setAll(clearAnswered(runsRef.current, chatId, requestId));
      throw error;
    }
  }, [setAll]);

  const respond = useCallback((chatId: string, requestId: string, decision: PermissionDecision) => answer(chatId, requestId, decision, () => window.milagre.respondToPermission(chatId, requestId, decision)), [answer]);

  /**
   * Sends the answers to a question, or dismisses it (null). The main process shows the answers in the chat
   * as the user's message, so whatever the agent streams next lands below them, and takes them back if they don't arrive.
   */
  const answerQuestion = useCallback((chatId: string, requestId: string, answers: QuestionAnswers | null) => {
    const request = runsRef.current[chatId]?.questions.find((item) => item.requestId === requestId);
    const summary = answers && request ? answerSummary(request.questions, answers) : "";
    return answer(chatId, requestId, answers ? "answered" : "dismissed", () => window.milagre.answerQuestion(chatId, requestId, answers, summary));
  }, [answer]);

  return { runs, send, interrupt, respond, answerQuestion };
}
