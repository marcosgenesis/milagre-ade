import { providerName } from "./providers.mjs";
// System notifications for chats that wait on the user, built by the main process, which sees every
// project's chats (see notifications.cjs). Types: attention.d.mts.
import { chatTitle } from "./chats.mjs";
import { chatInProject, projectOfKey } from "./agent-runs.mjs";
import { isLinkScopeKey } from "./chat-scopes.mjs";

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

/** Chat keys outside `currentPath` whose turn waits on an approval or question, oldest key first. Link Chats are left out. */
export function chatsNeedingAttention(runs, currentPath = "") {
  return Object.entries(runs ?? {})
    .filter(([key, run]) => (run?.approvals?.length || run?.questions?.length) && !isLinkScopeKey(projectOfKey(key)) && !chatInProject(currentPath, key))
    .map(([key]) => key);
}

/** The attention button's words for the projects waiting, by name: "shop needs attention", "shop and api need attention", "shop and 2 more need attention". */
export function attentionLabel(names) {
  if (names.length <= 1) return `${names[0] ?? "A project"} needs attention`;
  if (names.length === 2) return `${names[0]} and ${names[1]} need attention`;
  return `${names[0]} and ${names.length - 1} more need attention`;
}

/** What a waiting run asks for, in one line: the approval's command or title, or its first question. */
export function waitingFor(run) {
  const approval = run?.approvals?.[0];
  if (approval) return approval.command?.split("\n")[0].trim() || approval.title;
  return run?.questions?.[0]?.questions?.[0]?.question;
}
