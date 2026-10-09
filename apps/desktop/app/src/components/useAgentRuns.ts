import { useCallback, useEffect, useRef, useState } from "react";
import { LOCAL_COMPUTER, computerOfKey } from "@milagre/shared/chat-scopes";
import type { ChatSendRequest, CoordinatorState, LinkState, PermissionDecision, QuestionAnswers } from "../model";
import { applyRunEvent, clearAnswered, dropComputerRuns, eventIsNew, markAnswered, projectOfKey, replaceComputerEntries } from "../lib/agent-runs";
import { answerSummary } from "../lib/question-answers";
import { stateEvents } from "../lib/state-events";
import { bridgeFor, bridgeForKey } from "../lib/computer-bridge";
import { useComputers } from "../lib/computers";
import type { AgentRuns, SentAnswer } from "../lib/agent-runs";

/**
 * Streams agent turns per chat, in every project of every computer, so a chat in a project that isn't open keeps
 * its run and its cards for when the project opens again, and a reload picks them up. Each computer's main process
 * saves its turns; an event that changed a project's state brings that state along, handed to `onState`.
 * `modelFor(chatId)` names the model of a turn that starts without a message from this window.
 */
export function useAgentRuns(onState: (projectPath: string, state: CoordinatorState | LinkState) => void, modelFor: (chatId: string) => string = () => "") {
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
  // Per computer, the number of the last agent event its snapshot holds: events it already folded in are skipped.
  const taken = useRef(new Map<string, number>());
  // Per computer, which snapshot is the latest: a getRuns() answer that lands after a newer one, or a removal, is stale.
  const generation = useRef(new Map<string, number>());
  const take = useCallback(
    (computerId: string, snapshot: { runs: AgentRuns; seq: number }) => {
      generation.current.set(computerId, (generation.current.get(computerId) ?? 0) + 1);
      taken.current.set(computerId, snapshot.seq);
      setAll(replaceComputerEntries(runsRef.current, computerId, snapshot.runs));
    },
    [setAll],
  );

  // The run and the state change in one render, so a finished reply never shows twice or goes missing.
  // A window that loads mid-turn takes the turns from the main process, and skips the events they hold.
  useEffect(() => {
    let recovered = false;
    const unsubscribe = stateEvents.onAgentEvent(({ chatId, event, state, seq }) => {
      if (eventIsNew(taken.current, chatId, seq))
        setAll(applyRunEvent(runsRef.current, chatId, event, event.type === "turn-started" ? modelForRef.current(chatId) : ""));
      if (state) onStateRef.current(projectOfKey(chatId), state);
    });
    const recover = window.milagre.onRuntimeSnapshot?.((snapshot) => {
      recovered = true;
      take(LOCAL_COMPUTER, snapshot.runs);
    });
    // A computer's runtime sends a snapshot each time it reconnects (daemon-runtime.cjs).
    const recoverRemote = window.milagre.onComputerEvent?.((event) => {
      if (event.channel === "runtime:snapshot" && event.payload?.runs) take(event.computerId, event.payload.runs);
    });
    void window.milagre
      .getRuns()
      .then((snapshot) => {
        if (!recovered) take(LOCAL_COMPUTER, snapshot);
      })
      .catch(() => {});
    return () => {
      recovered = true;
      unsubscribe();
      recover?.();
      recoverRemote?.();
    };
  }, [setAll, take]);

  // A computer that comes online is asked for its turns: its runtime's first connection sends no snapshot. One that
  // is removed, or every one once Other computers is off, takes its turns with it.
  const { computers } = useComputers();
  const online = computers
    .filter((computer) => computer.state === "online")
    .map((computer) => computer.id)
    .join("\n");
  const known = computers.map((computer) => computer.id).join("\n");
  const away = computers
    .filter((computer) => computer.state !== "online")
    .map((computer) => computer.id)
    .join("\n");
  useEffect(() => {
    for (const id of online.split("\n").filter(Boolean)) {
      const asked = generation.current.get(id) ?? 0;
      void bridgeFor(id)
        .getRuns()
        .then((snapshot) => {
          if ((generation.current.get(id) ?? 0) === asked) take(id, snapshot);
        })
        .catch(() => {});
    }
  }, [online, take]);
  // A computer that isn't online has no turn running that this window can know of: its spinners and approvals go (its
  // chats stay, from its offline copy), and the snapshot asked for when it comes back online brings its turns again.
  useEffect(() => {
    if (!away) return;
    let next = runsRef.current;
    for (const id of away.split("\n").filter(Boolean)) {
      if (!Object.keys(next).some((key) => computerOfKey(key) === id)) continue;
      next = dropComputerRuns(next, id);
      taken.current.delete(id);
      generation.current.set(id, (generation.current.get(id) ?? 0) + 1);
    }
    if (next !== runsRef.current) setAll(next);
  }, [away, setAll]);
  useEffect(() => {
    const ids = new Set(known.split("\n").filter(Boolean));
    let next = runsRef.current;
    for (const key of Object.keys(next)) {
      const id = computerOfKey(key);
      if (id !== LOCAL_COMPUTER && !ids.has(id)) {
        next = dropComputerRuns(next, id);
        taken.current.delete(id);
        generation.current.set(id, (generation.current.get(id) ?? 0) + 1);
      }
    }
    if (next !== runsRef.current) setAll(next);
  }, [known, setAll]);

  /** Saves the message and starts or steers its chat's turn, on the chat's own Mac; resolves with the chat's session id. */
  const send = useCallback((request: ChatSendRequest) => bridgeForKey(request.projectPath).sendMessage(request), []);

  const interrupt = useCallback((chatId: string) => bridgeForKey(chatId).interruptAgent(chatId), []);

  /** Sends the user's answer. The card shows it as sent until the agent takes it, and goes back to pending if it doesn't arrive. */
  const answer = useCallback(
    async (chatId: string, requestId: string, sent: SentAnswer, deliver: () => Promise<boolean>) => {
      setAll(markAnswered(runsRef.current, chatId, requestId, sent));
      try {
        const accepted = await deliver();
        if (!accepted) setAll(clearAnswered(runsRef.current, chatId, requestId));
        return accepted;
      } catch (error) {
        setAll(clearAnswered(runsRef.current, chatId, requestId));
        throw error;
      }
    },
    [setAll],
  );

  const respond = useCallback(
    (chatId: string, requestId: string, decision: PermissionDecision) =>
      answer(chatId, requestId, decision, () => bridgeForKey(chatId).respondToPermission(chatId, requestId, decision)),
    [answer],
  );

  /**
   * Sends the answers to a question, or dismisses it (null). The main process shows the answers in the chat
   * as the user's message, so whatever the agent streams next lands below them, and takes them back if they don't arrive.
   */
  const answerQuestion = useCallback(
    (chatId: string, requestId: string, answers: QuestionAnswers | null) => {
      const request = runsRef.current[chatId]?.questions.find((item) => item.requestId === requestId);
      const summary = answers && request ? answerSummary(request.questions, answers) : "";
      return answer(chatId, requestId, answers ? "answered" : "dismissed", () => bridgeForKey(chatId).answerQuestion(chatId, requestId, answers, summary));
    },
    [answer],
  );

  return { runs, send, interrupt, respond, answerQuestion };
}
