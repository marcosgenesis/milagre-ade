import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, AgentStartTurnRequest, CoordinatorState } from "../model";
import { applyAgentEvent, startRun } from "../lib/agent-runs";
import type { AgentRuns } from "../lib/agent-runs";

/** Streams agent turns per chat and saves each finished turn into the project state. */
export function useAgentRuns(getState: () => CoordinatorState | null, commit: (next: CoordinatorState) => void) {
  const [runs, setRuns] = useState<AgentRuns>({});
  const runsRef = useRef(runs);
  const getStateRef = useRef(getState);
  const commitRef = useRef(commit);
  getStateRef.current = getState;
  commitRef.current = commit;

  const apply = useCallback((chatId: string, event: AgentEvent) => {
    const state = getStateRef.current();
    if (!state) return;
    const result = applyAgentEvent(state, runsRef.current, chatId, event);
    runsRef.current = result.runs;
    setRuns(result.runs);
    if (result.changed) commitRef.current(result.state);
  }, []);

  useEffect(() => window.milagre.onAgentEvent(({ chatId, event }) => apply(chatId, event)), [apply]);

  const start = useCallback(async (request: AgentStartTurnRequest) => {
    runsRef.current = startRun(runsRef.current, request.chatId, request.model);
    setRuns(runsRef.current);
    try {
      await window.milagre.startTurn(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      apply(request.chatId, { type: "turn-failed", message: message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") });
    }
  }, [apply]);

  const interrupt = useCallback((chatId: string) => window.milagre.interruptAgent(chatId), []);

  return { runs, start, interrupt };
}
