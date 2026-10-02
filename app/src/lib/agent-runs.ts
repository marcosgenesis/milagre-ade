import type { AgentEvent, ChatMessage, ChatStep, CoordinatorState, ModelOption, ModelProvider, PermissionDecision, PermissionRequest, QuestionRequest } from "../model";

/** What the user sent for a request the turn waits on: an approval decision, or a question answered or dismissed. */
export type SentAnswer = PermissionDecision | "answered" | "dismissed";

/** A turn streaming in a chat, keyed by chat key (see `chatKey`). */
export interface AgentRun {
  text: string;
  model: string;
  /** Tool steps in the order they started; each one's offset is where it sits in `text`. */
  steps: ChatStep[];
  /** Approval requests the turn waits on, oldest first. */
  approvals: PermissionRequest[];
  /** Questions the turn waits on, oldest first. */
  questions: QuestionRequest[];
  /** What was sent for each approval or question (by request id) until the agent takes it. */
  answered: Record<string, SentAnswer>;
  /** A steering message split the reply, so a turn that ends with nothing more to show saves nothing more. */
  split?: boolean;
}

export type AgentRuns = Record<string, AgentRun>;

const MAX_OUTPUT = 20_000;

/** Command output keeps its end, where results and errors are (as the main process does). */
export function capOutput(text: string): string {
  return text.length > MAX_OUTPUT ? `… truncated\n${text.slice(-MAX_OUTPUT)}` : text;
}

/**
 * Names a chat for the agent host. Session ids are counters per project, so every project has
 * a chat 2; the key carries the project path so chats in different projects never share a session.
 */
export function chatKey(projectPath: string, sessionId: number): string {
  return `${projectPath}#${sessionId}`;
}

/** Session ids of the project's chats that wait on at least one approval or question, so the sidebar can mark them. */
export function chatsWaitingForUser(runs: AgentRuns, projectPath: string): Set<number> {
  const waiting = new Set<number>();
  for (const [key, run] of Object.entries(runs)) {
    if ((run.approvals.length > 0 || run.questions.length > 0) && chatInProject(projectPath, key)) waiting.add(sessionIdFromKey(key));
  }
  return waiting;
}

/** Session ids of the project's chats with a turn running, so the sidebar can mark them. */
export function chatsRunning(runs: AgentRuns, projectPath: string): Set<number> {
  return new Set(Object.keys(runs).filter((key) => chatInProject(projectPath, key)).map(sessionIdFromKey));
}

/** The session id at the end of a chat key (after the last `#`), or NaN. */
export function sessionIdFromKey(key: string): number {
  const match = /#(\d+)$/.exec(key);
  return match ? Number(match[1]) : Number.NaN;
}

/** Whether a chat key names a chat of the project at `projectPath`, and not of a path that merely starts with it. */
export function chatInProject(projectPath: string, key: string): boolean {
  return key === chatKey(projectPath, sessionIdFromKey(key));
}

export function startRun(runs: AgentRuns, chatId: string, model: string): AgentRuns {
  return { ...runs, [chatId]: { text: "", model, steps: [], approvals: [], questions: [], answered: {} } };
}

/** The run with one step changed, or null when it has no such step or `update` declines. */
function updateStep(run: AgentRun, id: string, update: (step: ChatStep) => ChatStep | null): AgentRun | null {
  const index = run.steps.findIndex((step) => step.id === id);
  const next = index === -1 ? null : update(run.steps[index]);
  return next ? { ...run, steps: run.steps.map((step, position) => (position === index ? next : step)) } : null;
}

/** The detail a step ends with replaces what streamed into it; a step that ends without one keeps none. */
function endStep({ detail: _streamed, ...step }: ChatStep, end: { status: "done" | "failed"; title?: string; detail?: string; durationMs?: number }): ChatStep {
  return { ...step, status: end.status, title: end.title ?? step.title, ...(end.detail === undefined ? {} : { detail: end.detail }), ...(end.durationMs === undefined ? {} : { durationMs: end.durationMs }) };
}

/**
 * Steps as saved with a reply: none left running, and offsets into the reply's trimmed text.
 * A step still running when the turn ends is saved as `closeAs`, except thinking, which just stops.
 */
function savedSteps(text: string, steps: ChatStep[], closeAs: "done" | "failed"): { steps?: ChatStep[] } {
  if (!steps.length) return {};
  const lead = text.length - text.trimStart().length;
  const length = text.trim().length;
  return {
    steps: steps.map((step) => ({ ...step, status: step.status !== "running" ? step.status : step.kind === "thinking" ? "done" : closeAs, offset: Math.min(Math.max((step.offset ?? text.length) - lead, 0), length) })),
  };
}

/** Records what the user sent for a chat's approval or question. Kept on the run, so another chat's request with the same id is untouched. */
export function markAnswered(runs: AgentRuns, chatId: string, requestId: string, decision: SentAnswer): AgentRuns {
  const run = runs[chatId];
  if (!run) return runs;
  return { ...runs, [chatId]: { ...run, answered: { ...run.answered, [requestId]: decision } } };
}

/** The decision sent for an approval, while the agent takes it. */
export function sentDecision(run: AgentRun | undefined, requestId: string): PermissionDecision | null {
  const sent = run?.answered[requestId];
  return sent === "allow" || sent === "allow-for-chat" || sent === "deny" ? sent : null;
}

/** Whether a question's answers were sent or it was dismissed, while the agent takes it. */
export function sentReply(run: AgentRun | undefined, requestId: string): "answered" | "dismissed" | null {
  const sent = run?.answered[requestId];
  return sent === "answered" || sent === "dismissed" ? sent : null;
}

/** Forgets an answer, so the card is pending again (the answer didn't reach the agent). */
export function clearAnswered(runs: AgentRuns, chatId: string, requestId: string): AgentRuns {
  const run = runs[chatId];
  if (!run || !(requestId in run.answered)) return runs;
  const { [requestId]: _forgotten, ...answered } = run.answered;
  return { ...runs, [chatId]: { ...run, answered } };
}

/**
 * Folds one agent event into the saved state (the project at `projectPath`) and the in-memory
 * runs. `changed` is true when `state` changed and must be saved; streamed text only lives in
 * `runs` until the turn ends. Events for another project's chats, or for a session this state
 * doesn't have, change nothing.
 */
export function applyAgentEvent(state: CoordinatorState, runs: AgentRuns, projectPath: string, chatId: string, event: AgentEvent): { state: CoordinatorState; runs: AgentRuns; changed: boolean } {
  const sessionId = sessionIdFromKey(chatId);
  const session = state.sessions[sessionId];
  if (!chatInProject(projectPath, chatId) || !session) return { state, runs, changed: false };
  const run = runs[chatId];
  switch (event.type) {
    case "session-started": {
      if (session.native_session_id === event.nativeId) return { state, runs, changed: false };
      return { state: { ...state, sessions: { ...state.sessions, [sessionId]: { ...session, native_session_id: event.nativeId } } }, runs, changed: true };
    }
    case "session-reset": {
      if (!session.native_session_id) return { state, runs, changed: false };
      const { native_session_id: _forgotten, ...rest } = session;
      return { state: { ...state, sessions: { ...state.sessions, [sessionId]: rest } }, runs, changed: true };
    }
    case "turn-started": {
      // A turn this window didn't start, such as a steering message that arrived as the last turn ended.
      if (run) return { state, runs, changed: false };
      const model = [...state.messages].reverse().find((message) => message.session_id === sessionId && message.role === "user")?.model ?? "";
      return { state, runs: startRun(runs, chatId, model), changed: false };
    }
    case "permission-request": {
      if (!run) return { state, runs, changed: false };
      const { type: _type, ...request } = event;
      const approvals = [...run.approvals.filter((item) => item.requestId !== request.requestId), request];
      return { state, runs: { ...runs, [chatId]: { ...run, approvals } }, changed: false };
    }
    case "permission-resolved": {
      if (!run) return { state, runs, changed: false };
      const approvals = run.approvals.filter((item) => item.requestId !== event.requestId);
      const { [event.requestId]: _answered, ...answered } = run.answered;
      if (approvals.length === run.approvals.length && !(event.requestId in run.answered)) return { state, runs, changed: false };
      return { state, runs: { ...runs, [chatId]: { ...run, approvals, answered } }, changed: false };
    }
    case "question-request": {
      if (!run) return { state, runs, changed: false };
      const { type: _type, ...request } = event;
      const questions = [...run.questions.filter((item) => item.requestId !== request.requestId), request];
      return { state, runs: { ...runs, [chatId]: { ...run, questions } }, changed: false };
    }
    case "question-resolved": {
      if (!run) return { state, runs, changed: false };
      const questions = run.questions.filter((item) => item.requestId !== event.requestId);
      const { [event.requestId]: _answered, ...answered } = run.answered;
      if (questions.length === run.questions.length && !(event.requestId in run.answered)) return { state, runs, changed: false };
      return { state, runs: { ...runs, [chatId]: { ...run, questions, answered } }, changed: false };
    }
    case "text-delta": {
      if (!run) return { state, runs, changed: false };
      return { state, runs: { ...runs, [chatId]: { ...run, text: run.text + event.text } }, changed: false };
    }
    case "step-started": {
      if (!run) return { state, runs, changed: false };
      const step: ChatStep = { ...event.step, ...(event.step.detail === undefined ? {} : { detail: capOutput(event.step.detail) }), status: "running", offset: run.text.length };
      return { state, runs: { ...runs, [chatId]: { ...run, steps: [...run.steps.filter((item) => item.id !== step.id), step] } }, changed: false };
    }
    case "step-output": {
      const next = run && updateStep(run, event.id, (step) => (step.status === "running" ? { ...step, detail: capOutput((step.detail ?? "") + event.text) } : null));
      return next ? { state, runs: { ...runs, [chatId]: next }, changed: false } : { state, runs, changed: false };
    }
    case "step-completed": {
      const next = run && updateStep(run, event.id, (step) => endStep(step, event));
      return next ? { state, runs: { ...runs, [chatId]: next }, changed: false } : { state, runs, changed: false };
    }
    case "turn-completed":
    case "turn-cancelled":
    case "turn-failed": {
      if (!run) return { state, runs, changed: false };
      const { [chatId]: _finished, ...remaining } = runs;
      // The reply so far was saved when a steering message split it; there is nothing left to show.
      if (event.type === "turn-completed" && run.split && !run.text.trim() && !run.steps.length) return { state, runs: remaining, changed: false };
      const message: ChatMessage = {
        id: state.next_id,
        session_id: sessionId,
        body: replyBody(run.text, event, run.steps.length > 0),
        context: null,
        role: "assistant",
        model: run.model,
        outcome: event.type === "turn-completed" ? "completed" : event.type === "turn-cancelled" ? "cancelled" : "failed",
        // Codex sends no end for a command still running when a turn stops, so the turn's end closes it.
        ...savedSteps(run.text, run.steps, event.type === "turn-completed" ? "done" : "failed"),
      };
      return { state: { ...state, next_id: state.next_id + 1, messages: [...state.messages, message] }, runs: remaining, changed: true };
    }
    // Event types added by later steps are not turn endings.
    default:
      return { state, runs, changed: false };
  }
}

function replyBody(text: string, event: AgentEvent, hasSteps: boolean) {
  const reply = text.trim();
  if (event.type === "turn-failed") return reply ? `${reply}\n\nAgent error: ${event.message}` : `Agent error: ${event.message}`;
  if (event.type === "turn-cancelled") return reply ? `${reply}\n\nAgent run cancelled.` : "Agent run cancelled.";
  return reply || (hasSteps ? "" : "The agent finished without a reply.");
}

/**
 * Before a steering message joins a running turn, the reply streamed so far is saved as its own
 * message, so the chat reads in order: the reply so far, the new message, then the rest of the reply.
 * Finished steps are saved with it; steps still running carry on at the start of the rest of the reply.
 */
export function splitRunForSteer(state: CoordinatorState, runs: AgentRuns, projectPath: string, chatId: string): { state: CoordinatorState; runs: AgentRuns; changed: boolean } {
  const sessionId = sessionIdFromKey(chatId);
  const run = runs[chatId];
  if (!chatInProject(projectPath, chatId) || !state.sessions[sessionId] || !run) return { state, runs, changed: false };
  const body = run.text.trim();
  const finished = run.steps.filter((step) => step.status !== "running");
  if (!body && !finished.length) return { state, runs, changed: false };
  const message: ChatMessage = { id: state.next_id, session_id: sessionId, body, context: null, role: "assistant", model: run.model, ...savedSteps(run.text, finished, "done") };
  const running = run.steps.filter((step) => step.status === "running").map((step) => ({ ...step, offset: 0 }));
  return {
    state: { ...state, next_id: state.next_id + 1, messages: [...state.messages, message] },
    runs: { ...runs, [chatId]: { ...run, text: "", steps: running, split: true } },
    changed: true,
  };
}

/** The model to use for a chat. A chat bound to a provider never runs another provider's model. */
export function modelForChat(selected: ModelOption, provider: ModelProvider | undefined, messages: ChatMessage[], catalog: ModelOption[]): ModelOption {
  if (!provider || selected.provider === provider) return selected;
  const lastUsed = [...messages].reverse().find((message) => catalog.some((option) => option.id === message.model && option.provider === provider));
  return catalog.find((option) => option.id === lastUsed?.model) ?? catalog.find((option) => option.provider === provider) ?? selected;
}
