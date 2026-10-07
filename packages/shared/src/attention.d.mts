import type { AgentRun, AgentRuns } from "./agent-runs.mjs";
import type { AgentEvent, CoordinatorState, ModelProvider } from "./model.ts";

/** What a system notification says about a chat that waits on the user. */
export interface AttentionNotice {
  title: string;
  subtitle?: string;
  body: string;
}

export interface AttentionContext {
  projectName: string;
  worktreeName?: string;
  chatTitle?: string;
  provider?: ModelProvider;
}

/**
 * The notification for an approval or question a turn waits on, e.g. "shop / fix-login - Claude needs input",
 * or null for any other event.
 */
export function attentionNotice(event: AgentEvent, context: AttentionContext): AttentionNotice | null;
export function attentionContext(state: CoordinatorState, projectName: string, sessionId: number): AttentionContext;
/** Chat keys outside `currentPath` whose turn waits on an approval or question. Link Chats are left out. */
export function chatsNeedingAttention(runs: AgentRuns | undefined, currentPath?: string): string[];
/** The attention button's words for the projects waiting, by name. */
export function attentionLabel(names: string[]): string;
/** What a waiting run asks for, in one line: the approval's command or title, or its first question. */
export function waitingFor(run: AgentRun | undefined): string | undefined;
