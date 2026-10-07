import { ipcErrorMessage } from "@milagre/shared/result";
/** A rejected Chat mutation must stay visible instead of looking like it succeeded. */
export async function reportChatAction(action: Promise<unknown>, label: string, notice: (text: string) => void): Promise<void> {
  try {
    await action;
  } catch (error) {
    notice(`${label}: ${ipcErrorMessage(error)}`);
  }
}
