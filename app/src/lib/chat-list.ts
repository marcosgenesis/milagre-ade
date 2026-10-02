export { chatTitle } from "../../../electron/shared/chats.mjs";

/** What the mark at the left of a chat row shows; the first that applies wins. */
export type ChatMark = "question" | "waiting" | "running" | "unread" | "idle";

export function chatMark({ asking = false, waiting, running, unread }: { asking?: boolean; waiting: boolean; running: boolean; unread: boolean }): ChatMark {
  if (asking) return "question";
  if (waiting) return "waiting";
  if (running) return "running";
  if (unread) return "unread";
  return "idle";
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
