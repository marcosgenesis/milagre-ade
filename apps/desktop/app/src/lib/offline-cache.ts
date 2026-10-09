import { computerOfKey } from "@milagre/shared/chat-scopes";
import { isRemoteKey } from "./computer-bridge.ts";
import { stateEvents } from "./state-events.ts";

// A paired computer's states and chat windows, forwarded to main as they change so its last copy can be read while it
// is away (spec "Offline cache"). Held back per key: a streaming turn changes a state many times a second.
const DELAY_MS = 3000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
function later(key: string, write: () => void) {
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      write();
    }, DELAY_MS),
  );
}
const remember = (scope: string, entry: Parameters<typeof window.milagre.computers.remember>[1]) =>
  void Promise.resolve(window.milagre.computers?.remember?.(computerOfKey(scope), entry)).catch(() => {});

function rememberState(scope: string, state: unknown) {
  if (!isRemoteKey(scope) || !state) return;
  later(`state\n${scope}`, () => remember(scope, { kind: "state", scope, state }));
}
export function rememberChat(scope: string, chatId: number, chat: { messages: unknown[]; hasMore: boolean; total: number }) {
  if (!isRemoteKey(scope)) return;
  later(`chat\n${scope}#${chatId}`, () =>
    remember(scope, { kind: "chat", scope, chatId, window: { messages: chat.messages, hasMore: chat.hasMore, total: chat.total } }),
  );
}
let started = false;
/** Follows every remote scope's state; App starts it once. */
export function startOfflineCache() {
  if (started) return;
  started = true;
  stateEvents.onProjectState(({ path, state }) => rememberState(path, state));
  stateEvents.onLinkState(({ linkId, state }) => rememberState(`milagre-link:${linkId}`, state));
}
