import * as SecureStore from "expo-secure-store";
import { createHostsStore } from "./hosts-store";
import { createNavigationStore } from "./navigation-store";

export const savedNavigation = createNavigationStore({
  getItemAsync: SecureStore.getItemAsync,
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
});

export const savedHosts = createHostsStore({
  getItemAsync: SecureStore.getItemAsync,
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  deleteItemAsync: SecureStore.deleteItemAsync,
});

const permissionKey = "milagre.permission.v1";
const MODES = ["ask", "auto", "full"];
/** The default permission mode for new Chats on this phone. */
export async function readPermission(): Promise<"ask" | "auto" | "full" | null> {
  try {
    const value = await SecureStore.getItemAsync(permissionKey);
    return value && MODES.includes(value) ? (value as "ask" | "auto" | "full") : null;
  } catch {
    return null;
  }
}
const attentionButtonKey = "milagre.attention-button.v1";
/** Whether the Chat shows the button to another Project's waiting Chat; on unless turned off. */
export async function readAttentionButton(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(attentionButtonKey)) !== "off";
  } catch {
    return true;
  }
}
export async function saveAttentionButton(on: boolean) {
  try {
    await SecureStore.setItemAsync(attentionButtonKey, on ? "on" : "off");
  } catch {
    /* best effort */
  }
}
export async function savePermission(mode: string) {
  try {
    await SecureStore.setItemAsync(permissionKey, mode);
  } catch {
    /* best effort */
  }
}
