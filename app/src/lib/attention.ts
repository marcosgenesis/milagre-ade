import type { AgentEvent, ModelProvider } from "../model";

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

const AGENT_NAMES: Record<ModelProvider, string> = { claude: "Claude", codex: "Codex" };

/**
 * The notification for an approval or question a turn waits on, e.g. "shop / fix-login - Claude needs input",
 * or null for any other event.
 */
export function attentionNotice(event: AgentEvent, context: AttentionContext): AttentionNotice | null {
  if (event.type !== "permission-request" && event.type !== "question-request") return null;
  const where = context.worktreeName && context.worktreeName !== context.projectName ? `${context.projectName} / ${context.worktreeName}` : context.projectName;
  const agent = context.provider ? AGENT_NAMES[context.provider] : "Agent";
  const subtitle = context.chatTitle || undefined;
  if (event.type === "question-request") {
    const [first, ...rest] = event.questions;
    const more = rest.length ? ` (+${rest.length} more)` : "";
    return { title: `${where} - ${agent} needs input`, subtitle, body: `${first?.question ?? "Asked a question"}${more}` };
  }
  const command = event.command?.split("\n")[0].trim();
  return { title: `${where} - ${agent} needs approval`, subtitle, body: command ? `Run: ${command}` : event.title };
}
