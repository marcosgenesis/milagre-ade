import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, AgentStartTurnRequest, CoordinatorState, PermissionDecision, QuestionAnswers } from "../model";
import { applyAgentEvent, chatInProject, clearAnswered, markAnswered, recordAnswers, sessionIdFromKey, splitRunForSteer, startRun } from "../lib/agent-runs";
import { patchSession } from "../lib/chat-list";
import { stopTurns } from "../lib/project-switch";
import { answerSummary } from "../lib/question-answers";
import type { AgentRuns, SentAnswer } from "../lib/agent-runs";

const TURN_ENDS = new Set<AgentEvent["type"]>(["turn-completed", "turn-cancelled", "turn-failed"]);

/**
 * Streams agent turns per chat and saves each finished turn into the open project's state.
 * Chats are named by chat key (`chatKey`); events for another project's chats are ignored.
 * A turn that ends in a chat that isn't open (`isOpen`) leaves the chat unread.
 */
export function useAgentRuns(projectPath: string, getState: () => CoordinatorState | null, commit: (next: CoordinatorState) => void, isOpen: (sessionId: number) => boolean = () => false) {
  const [runs, setRuns] = useState<AgentRuns>({});
  const runsRef = useRef(runs);
  const projectPathRef = useRef(projectPath);
  const getStateRef = useRef(getState);
  const commitRef = useRef(commit);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  projectPathRef.current = projectPath;
  getStateRef.current = getState;
  commitRef.current = commit;

  const apply = useCallback((chatId: string, event: AgentEvent) => {
    const state = getStateRef.current();
    if (!state) return;
    const result = applyAgentEvent(state, runsRef.current, projectPathRef.current, chatId, event);
    runsRef.current = result.runs;
    setRuns(result.runs);
    if (!result.changed) return;
    const sessionId = sessionIdFromKey(chatId);
    const ended = TURN_ENDS.has(event.type) && !isOpenRef.current(sessionId) && !result.state.sessions[sessionId]?.archived;
    commitRef.current(ended ? patchSession(result.state, sessionId, { unread: true }) : result.state);
  }, []);

  useEffect(() => window.milagre.onAgentEvent(({ chatId, event }) => {
    if (chatInProject(projectPathRef.current, chatId)) apply(chatId, event);
  }), [apply]);

  // A switch stops the project's turns and waits for them first (stopProject). One that still hadn't ended
  // is interrupted here and forgotten; as when the window closes, its partial reply is not saved.
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

  /** The project's chats with a turn running right now (the rendered runs can lag behind an event). */
  const runningIn = useCallback((path: string) => Object.keys(runsRef.current).filter((chatId) => chatInProject(path, chatId)), []);

  /** Stops the project's turns and waits (5 seconds at most) until they have ended, each reply so far saved in its chat. */
  const stopProject = useCallback((path: string) => {
    const running = () => Object.keys(runsRef.current).filter((chatId) => chatInProject(path, chatId));
    return stopTurns({ chatIds: running(), interrupt: (chatId) => window.milagre.interruptAgent(chatId), remaining: running });
  }, []);

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

  /**
   * Sends the answers to a question, or dismisses it (null). The answers show in the chat as the user's
   * message right away, so whatever the agent streams next lands below them; they are taken back if they don't arrive.
   */
  const answerQuestion = useCallback(async (chatId: string, requestId: string, answers: QuestionAnswers | null) => {
    const request = runsRef.current[chatId]?.questions.find((item) => item.requestId === requestId);
    const state = getStateRef.current();
    let messageId: number | null = null;
    if (answers && request && state) {
      const recorded = recordAnswers(state, runsRef.current, projectPathRef.current, chatId, answerSummary(request.questions, answers));
      messageId = recorded.messageId;
      if (messageId !== null) {
        runsRef.current = recorded.runs;
        setRuns(recorded.runs);
        commitRef.current(recorded.state);
      }
    }
    const takeBack = () => {
      const latest = getStateRef.current();
      if (messageId !== null && latest) commitRef.current({ ...latest, messages: latest.messages.filter((message) => message.id !== messageId) });
    };
    try {
      const accepted = await send(chatId, requestId, answers ? "answered" : "dismissed", () => window.milagre.answerQuestion(chatId, requestId, answers));
      if (!accepted) takeBack();
      return accepted;
    } catch (error) {
      takeBack();
      throw error;
    }
  }, [send]);

  return { runs, start, interrupt, runningIn, stopProject, respond, answerQuestion, splitForSteer };
}
