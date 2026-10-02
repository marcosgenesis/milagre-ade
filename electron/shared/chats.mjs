// How a chat is named, shared by the sidebar and the main process's notifications. Types: chats.d.mts.

/** The chat's name: the one the user gave it, else the first line of its first message. */
export function chatTitle(session, messages) {
  if (session.title?.trim()) return session.title.trim();
  if (session.generatedTitle?.trim()) return session.generatedTitle.trim();
  const line = messages.find((message) => message.role !== "assistant" && message.body.trim())?.body.trim().split("\n")[0] ?? "";
  if (!line) return session.agent_name;
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}
