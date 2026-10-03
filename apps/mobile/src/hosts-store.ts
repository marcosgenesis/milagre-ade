import { localEndpoint } from './client.ts';

export type SavedHost = { id: string; name: string; address: string; token: string; lastUsed: number };
type SecureStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};
const hostsKey = 'milagre.hosts.v1';
const legacyKey = 'milagre.connection.v1';
export const MAX_HOSTS = 12;

function validate(value: unknown): SavedHost {
  const host = value as Partial<SavedHost>;
  const address = localEndpoint(String(host?.address ?? ''));
  if (!/^[a-f0-9]{64}$/i.test(String(host?.token ?? ''))) throw new Error('A saved computer has no valid token.');
  return { id: address, name: String(host.name || new URL(address).hostname).slice(0, 80), address, token: String(host.token), lastUsed: Number(host.lastUsed) || 0 };
}
const sorted = (hosts: SavedHost[]) => [...hosts].sort((a, b) => b.lastUsed - a.lastUsed);

/** Every computer the phone has paired with, newest first. One entry per address; the token lives only in secure storage. */
export function createHostsStore(storage: SecureStorage, now = () => Date.now()) {
  // A late native write must finish before a later Forget removes its token.
  let pending: Promise<unknown> = Promise.resolve();
  function ordered<T>(work: () => Promise<T>): Promise<T> {
    const next = pending.then(work);
    pending = next.catch(() => {});
    return next;
  }
  async function read(): Promise<SavedHost[]> {
    const value = await storage.getItemAsync(hostsKey);
    if (value === null) {
      // Before multiple computers, one connection was stored on its own.
      const legacy = await storage.getItemAsync(legacyKey);
      if (legacy === null) return [];
      try { return [validate({ ...JSON.parse(legacy), lastUsed: 0 })]; } catch { return []; }
    }
    let entries: unknown[];
    try { entries = JSON.parse(value); } catch { entries = []; }
    // A damaged entry is dropped instead of locking every saved computer, and pairing, behind it.
    return sorted((Array.isArray(entries) ? entries : []).flatMap(entry => { try { return [validate(entry)]; } catch { return []; } }));
  }
  async function write(hosts: SavedHost[]) {
    await storage.setItemAsync(hostsKey, JSON.stringify(sorted(hosts).slice(0, MAX_HOSTS)));
    await storage.deleteItemAsync(legacyKey);
  }
  return {
    list: () => ordered(read),
    save: (host: { name: string; address: string; token: string }) => ordered(async () => {
      const saved = validate({ ...host, lastUsed: now() });
      await write([saved, ...(await read()).filter(item => item.id !== saved.id)]);
      return saved;
    }),
    rename: (id: string, name: string) => ordered(async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Give this computer a name.');
      await write((await read()).map(item => item.id === id ? { ...item, name: trimmed.slice(0, 80) } : item));
    }),
    forget: (id: string) => ordered(async () => write((await read()).filter(item => item.id !== id))),
  };
}
export type HostsStore = ReturnType<typeof createHostsStore>;
