import { providerName } from "./providers.mjs";
// System notifications for chats that wait on the user, built by the main process, which sees every
// project's chats (see notifications.cjs). Types: attention.d.mts.
import { chatTitle } from "./chats.mjs";

/**
 * The notification for an approval or question a turn waits on, e.g. "shop / fix-login - Claude needs input",
 * or null for any other event.
 */
export function attentionNotice(event, context) {
  if (event.type !== "permission-request" && event.type !== "question-request") return null;
  const where = context.worktreeName && context.worktreeName !== context.projectName ? `${context.projectName} / ${context.worktreeName}` : context.projectName;
  const agent = context.provider ? providerName(context.provider) : "Agent";
  const subtitle = context.chatTitle || undefined;
  if (event.type === "question-request") {
    const [first, ...rest] = event.questions;
    const more = rest.length ? ` (+${rest.length} more)` : "";
    return { title: `${where} - ${agent} needs input`, subtitle, body: `${first?.question ?? "Asked a question"}${more}` };
  }
  const command = event.command?.split("\n")[0].trim();
  return { title: `${where} - ${agent} needs approval`, subtitle, body: command ? `Run: ${command}` : event.title };
}

/** What a notice names about a chat: its project, worktree, title and agent. */
export function attentionContext(state, projectName, sessionId) {
  const session = state.sessions[sessionId];
  if (!session) return { projectName };
  return {
    projectName,
    worktreeName: state.worktrees?.[session.worktree_id]?.name,
    chatTitle: chatTitle(
      session,
      state.messages.filter((message) => message.session_id === session.id),
    ),
    provider: session.provider,
  };
}
