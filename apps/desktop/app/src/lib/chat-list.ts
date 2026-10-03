import type { ChatMessage } from "../model";
export { chatTitle } from "@milagre/shared/chats";

/** What the mark at the left of a chat row shows; the first that applies wins. */
export type ChatMark = "question" | "waiting" | "running" | "unread" | "idle";

export function chatMark({ asking = false, waiting, running, unread }: { asking?: boolean; waiting: boolean; running: boolean; unread: boolean }): ChatMark {
  if (asking) return "question";
  if (waiting) return "waiting";
  if (running) return "running";
  if (unread) return "unread";
  return "idle";
}

/** How the sidebar orders chats: by when they started, or by their latest message. Newest first either way. */
export type ChatOrder = "created" | "recent";

/** Chats newest first. Message ids only grow, so a chat's first message dates its start and its last one its latest activity. */
export function orderChats<T extends { sessionMessages: ChatMessage[] }>(chats: T[], order: ChatOrder): T[] {
  const key = (chat: T) => (order === "recent" ? chat.sessionMessages.at(-1)?.id : chat.sessionMessages[0]?.id) ?? 0;
  return [...chats].sort((a, b) => key(b) - key(a));
}

/** A line count in a few characters: 980, 2.1k, 14k, 2.1m. */
export function formatLineCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${trimDecimal(count / 1000)}k`;
  return `${trimDecimal(count / 1_000_000)}m`;
}

function trimDecimal(value: number) {
  return value < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
}

/** The folder name at the end of a path. */
export function folderName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}
