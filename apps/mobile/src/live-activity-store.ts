import * as SecureStore from "expo-secure-store";
import type { ActivityMode } from "@milagre/shared/live-activity";

const KEY = "milagre.live-activities.v1";
const MODE_KEY = "milagre.live-activities.mode.v1";
export async function activityMode(): Promise<ActivityMode> {
  return (await SecureStore.getItemAsync(MODE_KEY)) === "questions" ? "questions" : "all";
}
export async function saveActivityMode(mode: ActivityMode): Promise<void> {
  await SecureStore.setItemAsync(MODE_KEY, mode, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
export async function activityEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEY)) === "on";
}
export async function saveActivityEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY, enabled ? "on" : "off", { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
