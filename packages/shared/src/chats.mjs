// How a chat is named, shared by the sidebar and the main process's notifications. Types: chats.d.mts.

/** The chat's name: the one the user gave it, else the first line of its first message. */
export function chatTitle(session, messages) {
  if (session.title?.trim()) return session.title.trim();
  if (session.generatedTitle?.trim()) return session.generatedTitle.trim();
  const line = messages.find((message) => message.role !== "assistant" && message.body.trim())?.body.trim().split("\n")[0] ?? "";
  if (!line) return session.agent_name;
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

/** A handed-over chat that is still being prepared or holds its brief as a draft: it is a live, provider-locked chat even with no messages. */
export function isHandoverChat(session) {
  return Boolean(session?.handoverPending) || session?.handoverDraft !== undefined;
}

/** The chat lists show a chat once it has a message, or while a handover prepares it; a worktree's empty starter chat stays out. */
export function isListedChat(session, messageCount) {
  return messageCount > 0 || isHandoverChat(session);
}
