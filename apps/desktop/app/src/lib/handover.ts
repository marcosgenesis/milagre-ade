import { providerName } from "@milagre/shared/providers";
import { isHandoverChat } from "@milagre/shared/chats";
import type { AgentSession, LinkChatSession, ChatMessage, ModelOption, ModelProvider, PermissionMode } from "../model";
import { modelForChat } from "./agent-runs.ts";
import { chatTitle } from "./chat-list.ts";

export const otherProvider = (provider: ModelProvider): ModelProvider => (provider === "codex" ? "claude" : "codex");
export const providerLabel = providerName;

/** Why the handover row is disabled, or null. A running turn would leave work out of the brief. */
export function handoverBlocker({ running, cli }: { running: boolean; cli: string | null }): string | null {
  if (running) return "The agent is still running. Stop the turn or wait for it to finish to hand over.";
  return cli;
}

/** The model a handover to `provider` runs on: the last one used on that provider in the project, else its first. Undefined when the catalog has none. */
export function handoverModel(selected: ModelOption, provider: ModelProvider, projectMessages: ChatMessage[], models: ModelOption[]): ModelOption | undefined {
  const model = modelForChat(selected, provider, projectMessages, models);
  return model.provider === provider ? model : undefined;
}

// Shared with native Chats so both lists hide the same empty chats.
export { isHandoverChat };

export type HandoverLinks = { to?: { id: number; title: string; provider: ModelProvider }; from?: { id: number; title: string }; pending: boolean; live: boolean };

/** The chats a chat was handed over to and from, by title; a link to a chat no longer in the project is dropped. */
export function handoverLinks(session: AgentSession | LinkChatSession | undefined, state: { sessions: Record<number, AgentSession | LinkChatSession>; messages: ChatMessage[] }): HandoverLinks {
  const links: HandoverLinks = { pending: Boolean(session?.handoverPending), live: isHandoverChat(session) };
  const titleOf = (other: AgentSession | LinkChatSession) => chatTitle(other, state.messages.filter((message) => message.session_id === other.id));
  const to = session?.handedOverTo != null ? state.sessions[session.handedOverTo] : undefined;
  const from = session?.handedOverFrom != null ? state.sessions[session.handedOverFrom] : undefined;
  if (to?.provider) links.to = { id: to.id, title: titleOf(to), provider: to.provider };
  if (from) links.from = { id: from.id, title: titleOf(from) };
  return links;
}

/** What the permission mode does on `provider`, from the Codex policy and the Claude permission modes the agents start with. */
const MODE_BEHAVIOR: Record<ModelProvider, Record<PermissionMode, string>> = {
  codex: {
    ask: "runs commands in a sandbox that can write to this worktree and temp folders, with no network, and asks before anything but known-safe commands",
    auto: "runs commands in a sandbox that can write to this worktree and temp folders, with no network, and asks before leaving it",
    full: "runs commands with no sandbox and no approval prompts, so nothing limits files or network",
  },
  claude: {
    ask: "asks before edits and commands your Claude settings don't already allow",
    auto: "applies edits inside this worktree without asking and asks before most commands and anything outside it",
    full: "skips every approval prompt, so nothing limits files or network",
  },
};

/** The lines of the note shown before a handed-over chat's first message: what stays behind, and how the mode behaves on the new provider. */
export function handoverNotes({ from, to, permissionMode }: { from: ModelProvider; to: ModelProvider; permissionMode: PermissionMode }): string[] {
  const source = providerLabel(from);
  // The short forms of the PERMISSION_MODES names ("Ask approval", "Auto mode", "Full permission").
  const modeName = { ask: "Ask", auto: "Auto", full: "Full" }[permissionMode];
  return [
    `Approvals you allowed for the whole chat ("Always allow in this chat") stay with the ${source} chat.`,
    `Subagents still running in the ${source} chat keep running there.`,
    `On ${providerLabel(to)}, ${modeName} ${MODE_BEHAVIOR[to][permissionMode]}.`,
  ];
}
