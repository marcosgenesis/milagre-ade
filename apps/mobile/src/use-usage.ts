import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Client } from './client';
import { createUsageState, type UsageState } from './usage-state';

const EMPTY: UsageState = { snapshot: null, loading: false, error: '' };
const idleSubscribe = () => () => {};
const empty = () => EMPTY;

export function useUsage(client: Client | null) {
  const usage = useMemo(() => client ? createUsageState(client) : null, [client]);
  const state = useSyncExternalStore(usage?.subscribe ?? idleSubscribe, usage?.get ?? empty, empty);
  useFocusEffect(useCallback(() => {
    if (!usage) return;
    void usage.loadCached();
    const refresh = () => { if (AppState.currentState === 'active') void usage.refreshIfStale(60000); };
    refresh();
    const timer = setInterval(refresh, 5 * 60000);
    const subscription = AppState.addEventListener('change', refresh);
    return () => { clearInterval(timer); subscription.remove(); };
  }, [usage]));
  return { ...state, refresh: usage?.refresh ?? (() => Promise.resolve()) };
}
