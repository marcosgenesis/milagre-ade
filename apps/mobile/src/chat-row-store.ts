import { useEffect, useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";
import { PHONE_CHAT_ROW_SHOW, parseChatRowShow, type ChatRowShow } from "@milagre/shared/chat-row";

// What the project list's Chat rows show under their titles, chosen in its Filters menu. This phone's own choice.
const KEY = "milagre.chat-row-show.v1";
let current: ChatRowShow = PHONE_CHAT_ROW_SHOW;
let loaded = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function saveChatRowShow(next: ChatRowShow) {
  current = next;
  notify();
  void SecureStore.setItemAsync(KEY, JSON.stringify(next), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }).catch(() => {});
}

export function useChatRowShow(): ChatRowShow {
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void SecureStore.getItemAsync(KEY)
      .then((saved) => {
        if (!saved) return;
        current = parseChatRowShow(JSON.parse(saved), PHONE_CHAT_ROW_SHOW);
        notify();
      })
      .catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, () => current);
}
