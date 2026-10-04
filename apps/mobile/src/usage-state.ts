import type { UsageSnapshot } from '@milagre/shared/model';
import { mergeSnapshot, seedSnapshot } from '@milagre/shared/usage';

type UsageClient = { call: <T>(method: string) => Promise<T> };
export type UsageState = { snapshot: UsageSnapshot | null; loading: boolean; error: string };

/** One computer's usage. Reads share a request, and a failed refresh keeps unexpired last-known limits. */
export function createUsageState(client: UsageClient, now = Date.now) {
  let state: UsageState = { snapshot: null, loading: true, error: '' };
  let inFlight: Promise<void> | null = null;
  let cached: Promise<void> | null = null;
  let lastAttempt = -Infinity;
  const listeners = new Set<() => void>();
  const publish = (next: UsageState) => { state = next; for (const listener of listeners) listener(); };
  const loadCached = () => cached ??= client.call<UsageSnapshot>('usage:cached').then(value => {
    const snapshot = state.snapshot?.providers.every(provider => provider.status === 'error')
      ? mergeSnapshot(value, state.snapshot, now()) : seedSnapshot(state.snapshot, value);
    publish({ ...state, snapshot });
  }).catch(() => {});
  const refresh = (): Promise<void> => {
    if (inFlight) return inFlight;
    lastAttempt = now();
    publish({ ...state, loading: true });
    inFlight = client.call<UsageSnapshot>('usage:read').then(next => {
      publish({ snapshot: mergeSnapshot(state.snapshot, next, now()), loading: false, error: '' });
    }).catch(error => {
      const next: UsageSnapshot | null = state.snapshot && { providers: state.snapshot.providers.map(provider => ({ ...provider, status: provider.status === 'unavailable' ? 'unavailable' : 'error', windows: [] })) };
      publish({ snapshot: next ? mergeSnapshot(state.snapshot, next, now()) : null, loading: false, error: error instanceof Error ? error.message : 'Could not read usage. Try refreshing.' });
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
  return {
    get: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    loadCached, refresh,
    refreshIfStale: (maxAge: number) => now() - lastAttempt >= maxAge ? refresh() : Promise.resolve(),
  };
}
