import { localEndpoint } from './client.ts';

export type SavedConnection = { address: string; token: string };
type SecureStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};
const storageKey = 'milagre.connection.v1';

function validate(value: SavedConnection): SavedConnection {
  const address = localEndpoint(value.address);
  if (!/^[a-f0-9]{64}$/i.test(value.token)) throw new Error('Enter the connection token from your computer.');
  return { address, token: value.token };
}

export function createConnectionStore(storage: SecureStorage) {
  // A late native write must finish before a later Forget removes its token.
  let pending: Promise<unknown> = Promise.resolve();
  function ordered<T>(work: () => Promise<T>): Promise<T> {
    const next = pending.then(work);
    pending = next.catch(() => {});
    return next;
  }
  return {
    load: () => ordered(async (): Promise<SavedConnection | null> => {
      const value = await storage.getItemAsync(storageKey);
      if (value === null) return null;
      try { return validate(JSON.parse(value)); }
      catch { throw new Error('The saved connection could not be read. Forget it and connect again.'); }
    }),
    save: (connection: SavedConnection) => ordered(async () => { await storage.setItemAsync(storageKey, JSON.stringify(validate(connection))); }),
    forget: () => ordered(() => storage.deleteItemAsync(storageKey)),
  };
}
