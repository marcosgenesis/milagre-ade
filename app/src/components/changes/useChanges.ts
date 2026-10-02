import { useCallback, useEffect, useState } from "react";
import type { DiffMode } from "../../electron";
import { useDiffFiles } from "./useDiffFiles";

export type ChangesTab = "chat" | "diff";
export type Changes = ReturnType<typeof useChanges>;

/**
 * Everything the Changes panel and the Diff tab share: whether the panel is open, which tab shows,
 * the mode, and the file list. `chatId` is the selected chat's key; its turn ending re-reads the list,
 * the same moment the sidebar's diff stats refresh.
 */
export function useChanges({ cwd, base, chatId, available }: { cwd: string | undefined; base: string | undefined; chatId: string | null; available: boolean }) {
  const [open, setOpen] = useState(false);
  const [tabChoice, setTab] = useState<ChangesTab>("chat");
  const [mode, setMode] = useState<DiffMode>("uncommitted");
  const [scrollTarget, setScrollTarget] = useState<{ path: string; nonce: number } | null>(null);
  const shown = open && available;
  const files = useDiffFiles({ cwd: cwd ?? "", base, mode, active: shown });
  const { refresh } = files;

  // The Diff tab belongs to one chat; coming back to a chat starts on Chat.
  useEffect(() => setTab("chat"), [chatId, shown]);

  useEffect(() => {
    if (!shown || !chatId) return;
    return window.milagre.onAgentEvent((message) => {
      if (message.chatId !== chatId) return;
      const type = message.event.type;
      if (type === "turn-completed" || type === "turn-cancelled" || type === "turn-failed") void refresh();
    });
  }, [shown, chatId, refresh]);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  const selectFile = useCallback((path: string) => {
    setTab("diff");
    setScrollTarget((previous) => ({ path, nonce: (previous?.nonce ?? 0) + 1 }));
  }, []);

  return { open: shown, toggle, tab: shown ? tabChoice : ("chat" as ChangesTab), setTab, mode, setMode, scrollTarget, selectFile, ...files };
}
