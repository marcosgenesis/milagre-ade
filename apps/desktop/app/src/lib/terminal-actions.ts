import { useEffect } from "react";
import type { TerminalInfo } from "@milagre/shared/terminal";
import { ipcErrorMessage } from "@milagre/shared/result";
import { dispose, pruneTerminals } from "./terminal-sessions";
import { addTerminal, applyTerminalList, chatTerminals, setTerminalPanelOpen, setTerminalPicking } from "./terminal-store";
import { bridgeForKey } from "./computer-bridge";

/** A Worktree a new Terminal can start in; a shared Chat offers one per member Project. */
export type TerminalPlace = { path: string; label: string };

// The Terminal a new open should focus once its panel has shown it.
let focusNext: string | null = null;
export function takeFocusRequest(id: string) {
  if (focusNext !== id) return false;
  focusNext = null;
  return true;
}

async function refreshTerminals(chatId: string) {
  const { terminals } = await bridgeForKey(chatId).terminals.list({ chatId });
  pruneTerminals(chatId, new Set(terminals.map((terminal) => terminal.id)));
  applyTerminalList(chatId, terminals);
}

export async function openTerminal(chatId: string, cwd?: string): Promise<TerminalInfo> {
  const terminal = await bridgeForKey(chatId).terminals.open({ chatId, ...(cwd ? { cwd } : {}) });
  focusNext = terminal.id;
  addTerminal(terminal);
  return terminal;
}

/** ⌘T: a new Terminal in the Chat's Worktree, or the choice of Worktree when the Chat has several. */
export function newTerminal(chatId: string, places: TerminalPlace[] | undefined, notify: (message: string) => void) {
  if (places && places.length > 1) {
    setTerminalPicking(chatId, true);
    return;
  }
  void openTerminal(chatId, places?.[0]?.path).catch((error) => notify(`Couldn't open a Terminal: ${ipcErrorMessage(error)}`));
}

/** ⌘J: hides the panel, shows it again, or opens the first Terminal when the Chat has none. */
export function toggleTerminalPanel(chatId: string, places: TerminalPlace[] | undefined, notify: (message: string) => void) {
  const current = chatTerminals(chatId);
  if (current.open) setTerminalPanelOpen(chatId, false);
  else if (current.terminals.length) {
    if (current.active) focusNext = current.active;
    setTerminalPanelOpen(chatId, true);
  } else newTerminal(chatId, places, notify);
}

/** What the Chat's Terminals run that archiving would end; none when the host can't say. */
export async function busyTerminals(chatId: string): Promise<string[]> {
  try {
    const { terminals } = await bridgeForKey(chatId).terminals.list({ chatId });
    return terminals.filter((terminal) => terminal.busy).map((terminal) => terminal.title);
  } catch {
    return [];
  }
}

export async function closeTerminal(terminal: TerminalInfo) {
  dispose(terminal.id);
  await bridgeForKey(terminal.chatId)
    .terminals.close({ terminalId: terminal.id })
    .catch(() => {});
  await refreshTerminals(terminal.chatId).catch(() => {});
}

/** Keeps the shown Chat's Terminals in step with the host: on opening it, and whenever the host says they changed. */
export function useTerminalSync(chatId: string | null) {
  useEffect(() => {
    if (!chatId) return;
    void refreshTerminals(chatId).catch(() => {});
    const changed = (payload: { chatId: string }) => {
      if (payload?.chatId === chatId) void refreshTerminals(chatId).catch(() => {});
    };
    const offLocal = window.milagre.onTerminalsChanged(changed);
    const offRemote = window.milagre.onComputerEvent?.((event) => {
      if (event.channel === "terminal:changed") changed(event.payload);
    });
    return () => {
      offLocal();
      offRemote?.();
    };
  }, [chatId]);
}
