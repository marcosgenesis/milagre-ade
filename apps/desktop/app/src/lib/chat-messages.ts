import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { ChatMessage } from "../model.ts";
import type { MessageChanges } from "../electron.d.ts";
import { stateEvents } from "./state-events.ts";

// The messages of the Chats on screen, from a host that keeps them by Chat (chat-pages-v1, #300): a window of each Chat's
// latest turns, read with readChatMessages, extended back on request and kept current from each change's messages.

export type ChatWindow = {
  messages: ChatMessage[];
  /** Whether the Chat has messages before the window. */
  hasMore: boolean;
  /** All of the Chat's messages, the window or not. */
  total: number;
  loading: boolean;
  error?: string;
};

const TURNS = 20;
const KEPT = 8;
const EMPTY: ChatWindow = Object.freeze({ messages: [], hasMore: false, total: 0, loading: true }) as ChatWindow;
const NONE: ChatWindow = Object.freeze({ messages: [], hasMore: false, total: 0, loading: false }) as ChatWindow;
const windows = new Map<string, ChatWindow>();
const listeners = new Map<string, Set<() => void>>();
const keyOf = (scope: string, chatId: number) => `${scope}#${chatId}`;

function set(key: string, next: ChatWindow) {
  windows.delete(key);
  windows.set(key, next);
  // The Chats looked at last stay; others are read again when they come back.
  for (const old of windows.keys()) {
    if (windows.size <= KEPT) break;
    if (!listeners.get(old)?.size) windows.delete(old);
  }
  // A copy: a listener can resubscribe while it is told, and a live Set would then be walked forever.
  for (const listener of [...(listeners.get(key) ?? [])]) listener();
}

/** `messages` with `changes` for Chat `chatId` applied: a known message replaced, a new one placed after the one before it. */
export function applyChanges(current: ChatWindow, chatId: number, changes: MessageChanges): ChatWindow {
  const removed = new Set(changes.removed);
  let messages = removed.size ? current.messages.filter((message) => !removed.has(message.id)) : current.messages;
  let total = current.total - (current.messages.length - messages.length);
  for (const { message, after } of changes.changed) {
    if (message.session_id !== chatId) continue;
    const at = messages.findIndex((item) => item.id === message.id);
    if (at >= 0) {
      messages = messages.map((item, index) => (index === at ? message : item));
      continue;
    }
    total++;
    const before = after === null ? -1 : messages.findIndex((item) => item.id === after);
    // A message after one the window doesn't hold belongs before the window, unless the window ends there.
    if (before < 0 && after !== null && current.hasMore && messages.length) continue;
    const place = before < 0 ? (after === null ? 0 : messages.length) : before + 1;
    messages = [...messages.slice(0, place), message, ...messages.slice(place)];
  }
  return messages === current.messages && total === current.total ? current : { ...current, messages, total };
}

const loads = new Map<string, Promise<void>>();
// Reads whose page may predate a change that arrived while they were on their way: each reads again when it ends.
const stale = new Set<string>();
function load(scope: string, chatId: number) {
  const key = keyOf(scope, chatId);
  let loading = loads.get(key);
  if (!loading) {
    loading = window.milagre
      .readChatMessages(scope, chatId, { turns: TURNS })
      .then(
        (page) => set(key, { messages: page.messages, hasMore: page.hasMore, total: page.total, loading: false }),
        (error: Error) => set(key, { ...(windows.get(key) ?? EMPTY), loading: false, error: error.message }),
      )
      .finally(() => {
        loads.delete(key);
        if (stale.delete(key)) void load(scope, chatId);
      });
    loads.set(key, loading);
  }
  return loading;
}

/** Reads the turns before the window; resolves once they're in. */
export async function loadEarlier(scope: string, chatId: number, turns = TURNS) {
  const key = keyOf(scope, chatId);
  const current = windows.get(key);
  if (!current?.hasMore || !current.messages.length) return;
  const page = await window.milagre.readChatMessages(scope, chatId, { before: current.messages[0].id, turns });
  const latest = windows.get(key) ?? current;
  const known = new Set(latest.messages.map((message) => message.id));
  set(key, { ...latest, messages: [...page.messages.filter((message) => !known.has(message.id)), ...latest.messages], hasMore: page.hasMore });
}

/** Reads every message of the Chat (find in chat searches all of it). */
export async function loadAll(scope: string, chatId: number) {
  while (windows.get(keyOf(scope, chatId))?.hasMore) await loadEarlier(scope, chatId, 1_000);
}

let following = false;
function follow() {
  if (following) return;
  following = true;
  stateEvents.onMessages(({ scope, changes, reset }) => {
    // A read on its way may have been answered before a change to its Chat: it reads again (a new Chat's reply can beat
    // its first page).
    for (const key of loads.keys()) {
      if (!key.startsWith(`${scope}#`)) continue;
      const chatId = Number(key.slice(scope.length + 1));
      if (reset || changes?.removed.length || changes?.changed.some(({ message }) => message.session_id === chatId)) stale.add(key);
    }
    // A copy: set() moves a window to the end of the Map, and walking the Map itself would reach it again.
    for (const [key, current] of [...windows]) {
      if (!key.startsWith(`${scope}#`)) continue;
      const chatId = Number(key.slice(scope.length + 1));
      if (reset) void load(scope, chatId);
      else if (changes) {
        const next = applyChanges(current, chatId, changes);
        if (next !== current) set(key, next);
      }
    }
  });
}

/** The window of Chat `chatId`'s messages, read when first shown; none while `scope` or `chatId` is missing. */
export function useChatMessages(scope: string | null | undefined, chatId: number | null | undefined) {
  const key = scope && typeof chatId === "number" && chatId > 0 ? keyOf(scope, chatId) : null;
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!key) return () => {};
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(listener);
      return () => set!.delete(listener);
    },
    [key],
  );
  const chat = useSyncExternalStore(subscribe, () => (key ? (windows.get(key) ?? EMPTY) : NONE));
  useEffect(() => {
    if (!key) return;
    follow();
    if (!windows.has(key)) void load(scope!, chatId!);
  }, [key, scope, chatId]);
  return {
    ...chat,
    loadEarlier: useCallback(() => (key ? loadEarlier(scope!, chatId!) : Promise.resolve()), [key, scope, chatId]),
    loadAll: useCallback(() => (key ? loadAll(scope!, chatId!) : Promise.resolve()), [key, scope, chatId]),
  };
}
