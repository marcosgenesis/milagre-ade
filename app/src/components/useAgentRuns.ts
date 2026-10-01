import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, AgentStartTurnRequest, CoordinatorState, PermissionDecision, QuestionAnswers } from "../model";
import { applyAgentEvent, chatInProject, clearAnswered, markAnswered, splitRunForSteer, startRun } from "../lib/agent-runs";
import type { AgentRuns, SentAnswer } from "../lib/agent-runs";

/**
 * Streams agent turns per chat and saves each finished turn into the open project's state.
 * Chats are named by chat key (`chatKey`); events for another project's chats are ignored.
 */
export function useAgentRuns(projectPath: string, getState: () => CoordinatorState | null, commit: (next: CoordinatorState) => void) {
  const [runs, setRuns] = useState<AgentRuns>({});
  const runsRef = useRef(runs);
  const projectPathRef = useRef(projectPath);
  const getStateRef = useRef(getState);
  const commitRef = useRef(commit);
  projectPathRef.current = projectPath;
  getStateRef.current = getState;
  commitRef.current = commit;

  const apply = useCallback((chatId: string, event: AgentEvent) => {
    const state = getStateRef.current();
    if (!state) return;
    const result = applyAgentEvent(state, runsRef.current, projectPathRef.current, chatId, event);
    runsRef.current = result.runs;
    setRuns(result.runs);
    if (result.changed) commitRef.current(result.state);
  }, []);

  useEffect(() => window.milagre.onAgentEvent(({ chatId, event }) => {
    if (chatInProject(projectPathRef.current, chatId)) apply(chatId, event);
  }), [apply]);

  // Opening another project interrupts the turns still running in the one left behind and
  // forgets them; as when the window closes, their partial replies are not saved.
  useEffect(() => {
    const left = Object.keys(runsRef.current).filter((chatId) => !chatInProject(projectPath, chatId));
    if (!left.length) return;
    for (const chatId of left) void window.milagre.interruptAgent(chatId).catch(() => {});
    runsRef.current = Object.fromEntries(Object.entries(runsRef.current).filter(([chatId]) => chatInProject(projectPath, chatId)));
    setRuns(runsRef.current);
  }, [projectPath]);

  const start = useCallback(async (request: AgentStartTurnRequest) => {
    // A chat whose turn is running keeps its run: the message steers that turn.
    if (!runsRef.current[request.chatId]) {
      runsRef.current = startRun(runsRef.current, request.chatId, request.model);
      setRuns(runsRef.current);
    }
    try {
      await window.milagre.startTurn(request);
      // The project was left while the turn was starting, before it could be interrupted.
      if (!runsRef.current[request.chatId] && !chatInProject(projectPathRef.current, request.chatId)) void window.milagre.interruptAgent(request.chatId).catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      apply(request.chatId, { type: "turn-failed", message: message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") });
    }
  }, [apply]);

  const interrupt = useCallback((chatId: string) => window.milagre.interruptAgent(chatId), []);

  /** Saves the reply streamed so far in a chat, so a steering message can follow it. */
  const splitForSteer = useCallback((chatId: string) => {
    const state = getStateRef.current();
    if (!state) return;
    const result = splitRunForSteer(state, runsRef.current, projectPathRef.current, chatId);
    if (!result.changed) return;
    runsRef.current = result.runs;
    setRuns(result.runs);
    commitRef.current(result.state);
  }, []);

  /** Sends the user's answer. The card shows it as sent until the agent takes it, and goes back to pending if it doesn't arrive. */
  const send = useCallback(async (chatId: string, requestId: string, sent: SentAnswer, deliver: () => Promise<boolean>) => {
    const setAnswers = (next: AgentRuns) => {
      runsRef.current = next;
      setRuns(next);
    };
    setAnswers(markAnswered(runsRef.current, chatId, requestId, sent));
    try {
      const accepted = await deliver();
      if (!accepted) setAnswers(clearAnswered(runsRef.current, chatId, requestId));
      return accepted;
    } catch (error) {
      setAnswers(clearAnswered(runsRef.current, chatId, requestId));
      throw error;
    }
  }, []);

  const respond = useCallback((chatId: string, requestId: string, decision: PermissionDecision) => send(chatId, requestId, decision, () => window.milagre.respondToPermission(chatId, requestId, decision)), [send]);

  /** Sends the answers to a question, or dismisses it (null). */
  const answerQuestion = useCallback((chatId: string, requestId: string, answers: QuestionAnswers | null) => send(chatId, requestId, answers ? "answered" : "dismissed", () => window.milagre.answerQuestion(chatId, requestId, answers)), [send]);

  return { runs, start, interrupt, respond, answerQuestion, splitForSteer };
}
