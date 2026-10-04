import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { createClient } from './client';
import { savedHosts } from './hosts-native';
import { useSession } from './session';
import { createPushController, notificationTarget, type PushView } from './push-controller';
import { pushNative, pushStore } from './push-native';
import type { PushPreferences, PushState } from './push-store';
import type { SavedHost } from './hosts-store';

function usePushState() {
  const session = useSession();
  const sessionRef = useRef(session);
  useLayoutEffect(() => { sessionRef.current = session; });
  const path = usePathname();
  const params = useGlobalSearchParams<{ id?: string }>();
  const [state, setState] = useState<PushState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ data: unknown; ticket: number; navigationVersion: number } | null>(null);
  const ticket = useRef(0);
  const handled = useRef(new Set<string>());
  const [controller] = useState(() => createPushController({ store: pushStore, hosts: savedHosts.list,
    native: pushNative, call: (host, method, args) => createClient(host.address, host.token, fetch, 5000, host.access).call(method, args), onError: setError }));
  const view: PushView = path === '/chat' && session.client && session.snapshot && params.id && /^\d+$/.test(String(params.id))
    ? { hostId: session.client.url, chatId: `${session.snapshot.project.path}#${params.id}` } : null;
  const viewRef = useRef(view);
  useLayoutEffect(() => { viewRef.current = view; });
  const publish = useCallback(async () => setState(await pushStore.read()), []);
  const refreshing = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (refreshing.current) return refreshing.current;
    const next = controller.refresh().catch(e => setError(e.message)).then(publish).catch(e => setError(e.message)).finally(() => { refreshing.current = null; });
    refreshing.current = next;
    return next;
  }, [controller, publish]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); await publish(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const hostKeys = session.hosts.map(host => `${host.id}:${host.lastUsed}`).join('|');
  useEffect(() => { void refresh(); }, [refresh, hostKeys]);
  const previousPath = useRef(path);
  useEffect(() => {
    if (previousPath.current !== path) { sessionRef.current.cancelNavigation(); previousPath.current = path; }
  }, [path]);
  const invalidatePending = useCallback(() => { ticket.current++; }, []);
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    void pushNative.listen(() => AppState.currentState === 'active' ? viewRef.current : null, data => {
      sessionRef.current.claimAutoOpen();
      sessionRef.current.cancelNavigation();
      setPending({ data, ticket: ++ticket.current, navigationVersion: sessionRef.current.navigationVersion() });
    }, () => void refresh()).then(cleanup => { if (cancelled) cleanup(); else stop = cleanup; }).catch(e => setError(e.message));
    return () => { cancelled = true; invalidatePending(); stop?.(); };
  }, [refresh, invalidatePending]);
  useEffect(() => {
    const update = () => void controller.focus(AppState.currentState === 'active' ? viewRef.current : null).catch(() => {});
    update();
    const timer = setInterval(update, 10000);
    const subscription = AppState.addEventListener('change', next => { update(); if (next === 'active') void refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [controller, refresh, view?.hostId, view?.chatId, state?.enabled]);
  useEffect(() => {
    if (!pending || !session.booted) return;
    void (async () => {
      const hosts = await savedHosts.list();
      if (pending.ticket !== ticket.current || pending.navigationVersion !== sessionRef.current.navigationVersion()) return;
      const target = notificationTarget(pending.data, hosts);
      if (!target) throw new Error('This notification belongs to a computer that is no longer paired. Pair it again to open its Chat.');
      if (handled.current.has(target.eventId)) return;
      handled.current.add(target.eventId);
      if (handled.current.size > 100) handled.current.delete(handled.current.values().next().value!);
      try {
        const opened = await sessionRef.current.openNotificationTarget(target.host, target.projectPath, target.sessionId);
        if (opened && pending.ticket === ticket.current) router.replace({ pathname: '/chat', params: { id: String(target.sessionId) } });
      } catch (e) { handled.current.delete(target.eventId); throw e; }
    })().catch(e => { if (pending.ticket === ticket.current) Alert.alert('Could not open Chat', e.message); });
  }, [pending, session.booted]);
  return { state, error, busy, unavailable: pushNative.available(), refresh,
    enable: () => run(() => controller.enable()), disable: () => run(() => controller.disable()),
    preferences: (value: Partial<PushPreferences>) => run(() => controller.preferences(value)),
    forget: async (host: SavedHost) => { await controller.forget(host); await publish(); },
  };
}
const PushContext = createContext<ReturnType<typeof usePushState> | null>(null);
export function PushProvider({ children }: { children: React.ReactNode }) {
  const value = usePushState();
  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}
export function usePush() {
  const push = useContext(PushContext);
  if (!push) throw new Error('PushProvider is required');
  return push;
}
