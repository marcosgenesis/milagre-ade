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
