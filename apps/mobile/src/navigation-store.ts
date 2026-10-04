export type ChatLocation = { hostId: string; projectPath: string; chatId: number };
type Storage = { getItemAsync: (key: string) => Promise<string | null>; setItemAsync: (key: string, value: string) => Promise<void> };
const key = 'milagre.last-chat.v1';

export function parseLocation(raw: string | null): ChatLocation | null {
  try {
    const value = JSON.parse(raw || 'null');
    return value && typeof value.hostId === 'string' && value.hostId && typeof value.projectPath === 'string' && value.projectPath.startsWith('/') && Number.isSafeInteger(value.chatId) && value.chatId > 0
      ? { hostId: value.hostId, projectPath: value.projectPath, chatId: value.chatId } : null;
  } catch { return null; }
}

/** Serialize writes so a slow save cannot put an older Chat back on the next launch. */
export function createNavigationStore(storage: Storage) {
  let pending = Promise.resolve();
  return {
    async read() { try { await pending; return parseLocation(await storage.getItemAsync(key)); } catch { return null; } },
    save(location: ChatLocation) {
      pending = pending.then(() => storage.setItemAsync(key, JSON.stringify(location))).catch(() => {});
      return pending;
    },
  };
}
