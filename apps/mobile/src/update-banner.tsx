import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, AppState, View, Text } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import { createUpdateController, watchUpdates, type UpdateState } from './update-controller';
import { colors } from './theme';
import { PillButton } from './ui';

const AppUpdates = createContext<{ state: UpdateState; check: (force?: boolean) => Promise<void>; install: () => Promise<void> } | null>(null);
export function useAppUpdates() {
  const updates = useContext(AppUpdates);
  if (!updates) throw new Error('App updates need UpdateShell.');
  return updates;
}

export function UpdateShell({ children }: { children: ReactNode }) {
  const { isStartupProcedureRunning, isChecking, isDownloading, isUpdatePending, checkError, downloadError } = Updates.useUpdates();
  const controller = useMemo(() => createUpdateController({
    enabled: !__DEV__ && Updates.isEnabled,
    check: Updates.checkForUpdateAsync, fetch: Updates.fetchUpdateAsync, reload: Updates.reloadAsync,
  }), []);
  const state = useSyncExternalStore(controller.subscribe, controller.get, controller.get);
  useEffect(() => {
    controller.syncNative({ isStartupProcedureRunning, isChecking, isDownloading, isUpdatePending, checkError, downloadError });
    if (AppState.currentState === 'active') void controller.check();
  }, [controller, isStartupProcedureRunning, isChecking, isDownloading, isUpdatePending, checkError, downloadError]);
  useEffect(() => watchUpdates(controller, {
    active: () => AppState.currentState === 'active',
    watchActive: listener => { const subscription = AppState.addEventListener('change', listener); return () => subscription.remove(); },
    schedule: (refresh, ms) => { const timer = setInterval(refresh, ms); return () => clearInterval(timer); },
  }), [controller]);
  const insets = useSafeAreaInsets();
  const visible = ['downloading', 'ready', 'restarting', 'error'].includes(state.status);
  return <AppUpdates.Provider value={{ state, check: controller.check, install: controller.install }}><View style={{ flex: 1, backgroundColor: colors.page }}>
    {visible && <View style={{ paddingTop: insets.top + 8, paddingHorizontal: Math.max(16, insets.left, insets.right), paddingBottom: 8 }}>
      <UpdateBanner state={state} onUpdate={() => void controller.install()} onRetry={() => void controller.check(true)} />
    </View>}
    {/* The navigator measures its remaining safe area below the notice, keeping headers and Chat controls visible. */}
    <SafeAreaProvider style={{ flex: 1 }}>{children}</SafeAreaProvider>
  </View></AppUpdates.Provider>;
}

export function UpdateBanner({ state, onUpdate, onRetry }: { state: UpdateState; onUpdate: () => void; onRetry: () => void }) {
  if (!['downloading', 'ready', 'restarting', 'error'].includes(state.status)) return null;
  const busy = state.status === 'downloading' || state.status === 'restarting';
  const title = state.status === 'downloading' ? 'Downloading update' : state.status === 'restarting' ? 'Applying update' : 'Update available';
  return <View accessibilityLiveRegion="polite" style={{ width: '100%', maxWidth: 600, alignSelf: 'center', padding: 14, gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 20, borderCurve: 'continuous' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
      {busy && <ActivityIndicator accessibilityLabel={title} color={colors.ink2} />}
      <Text style={{ flex: 1, minWidth: 120, color: colors.ink, fontSize: 15, fontWeight: '600' }}>{title}</Text>
      {!busy && <PillButton title={state.error ? 'Try again' : 'Update now'} onPress={state.status === 'ready' ? onUpdate : onRetry} style={{ height: 44 }} />}
    </View>
    {state.error ? <Text selectable accessibilityRole="alert" style={{ color: colors.red, fontSize: 14, lineHeight: 20 }}>{state.error}</Text> : null}
  </View>;
}
