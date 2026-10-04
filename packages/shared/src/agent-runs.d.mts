import type { AgentEvent, AgentTask, ChatStep, CoordinatorState, PermissionDecision, PermissionRequest, QuestionRequest } from "./model.ts";

/** What the user sent for a request the turn waits on: an approval decision, or a question answered or dismissed. */
export type SentAnswer = PermissionDecision | "answered" | "dismissed";

/** A turn streaming in a chat, keyed by chat key (see `chatKey`). */
export interface AgentRun {
  text: string;
  model: string;
  /** When this turn began, in milliseconds since epoch. Older hosts may omit it. */
  startedAt?: number;
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
  /** The agent waits on its subagents, so the indicator says so instead of "Working". */
  waitingForSubagents?: boolean;
  /** The agent's to-do list as it last reported it; gone with the run when the turn ends. */
  tasks?: AgentTask[];
}

export type AgentRuns = Record<string, AgentRun>;

export type AppliedEvent = { state: CoordinatorState; runs: AgentRuns; changed: boolean };

export const MAX_OUTPUT: number;
export function capOutput(text: string): string;
export function lastUserModel(state: CoordinatorState, sessionId: number): string;
export function chatKey(projectPath: string, sessionId: number): string;
export function sessionIdFromKey(key: string): number;
export function projectOfKey(key: string): string;
export function chatInProject(projectPath: string, key: string): boolean;
export function startRun(runs: AgentRuns, chatId: string, model: string): AgentRuns;
export function isTurnEnd(event: AgentEvent): boolean;
export function runStatus(run: AgentRun | undefined): "idle" | "working" | "waiting";
export function applyRunEvent(runs: AgentRuns, chatId: string, event: AgentEvent, model?: string): AgentRuns;
export function applyAgentEvent(state: CoordinatorState, runs: AgentRuns, projectPath: string, chatId: string, event: AgentEvent): AppliedEvent;
export function splitRunForSteer(state: CoordinatorState, runs: AgentRuns, projectPath: string, chatId: string): AppliedEvent;
export function recordAnswers(state: CoordinatorState, runs: AgentRuns, projectPath: string, chatId: string, body: string): { state: CoordinatorState; runs: AgentRuns; messageId: number | null };
