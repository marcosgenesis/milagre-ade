import { useCallback, useEffect, useState } from "react";
import type { DiffMode } from "../../electron";
import { useDiffFiles } from "./useDiffFiles";

export type Changes = ReturnType<typeof useChanges>;

/**
 * Everything the Changes panel and the diff view share: whether the panel is open, whether the diff
 * replaces the chat, the mode, and the file list. `chatId` is the selected chat's key; its turn ending re-reads the list,
 * the same moment the sidebar's diff stats refresh.
 */
export function useChanges({ cwd, base, chatId, available }: { cwd: string | undefined; base: string | undefined; chatId: string | null; available: boolean }) {
  const [open, setOpen] = useState(false);
  // The chat the diff was opened for; it only shows while that chat is the selected one.
  const [diffChatId, setDiffChatId] = useState<string | null>(null);
  const [mode, setMode] = useState<DiffMode>("uncommitted");
  const [scrollTarget, setScrollTarget] = useState<{ path: string; nonce: number } | null>(null);
  const shown = open && available;
  const files = useDiffFiles({ cwd: cwd ?? "", base, mode, active: shown });
  const { refresh } = files;

  const diffOpen = shown && chatId !== null && diffChatId === chatId;

  // Hiding the panel closes the diff; reopening it starts on the chat.
  useEffect(() => { if (!shown) setDiffChatId(null); }, [shown]);

  useEffect(() => {
    if (!shown || !chatId) return;
    return window.milagre.onAgentEvent((message) => {
      if (message.chatId !== chatId) return;
      const type = message.event.type;
      if (type === "turn-completed" || type === "turn-cancelled" || type === "turn-failed") void refresh();
    });
  }, [shown, chatId, refresh]);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  const closeDiff = useCallback(() => setDiffChatId(null), []);
  const selectFile = useCallback((path: string) => {
    setDiffChatId(chatId);
    setScrollTarget((previous) => ({ path, nonce: (previous?.nonce ?? 0) + 1 }));
  }, [chatId]);

  return { open: shown, toggle, diffOpen, closeDiff, mode, setMode, scrollTarget, activePath: diffOpen ? scrollTarget?.path : undefined, selectFile, ...files };
}
