import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, Text, View, useColorScheme } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DomWebView, type DomWebViewRef } from '@expo/dom-webview';
import { File, Paths } from 'expo-file-system';
import { ArrowLeft01Icon, Cancel01Icon, SmartphoneIcon } from '@hugeicons/core-free-icons';
import type { SimulatorDevice, SimulatorList } from '@milagre/shared/simulator';
import { createSimulatorBridge, createSimulatorReceiverHtml } from '@milagre/shared/simulator-receiver';
import type { Client } from './client';
import { useSession } from './session';
import { Icon } from './icons';
import { hex } from './theme';
import { CircleButton, PageScroll, PillButton, colors, styles } from './ui';

/** Poll discovery only while this screen is visible. Discovery never starts a video session. */
function useSimulators(client: Client | null) {
  const [list, setList] = useState<SimulatorList | null>(null);
  useFocusEffect(useCallback(() => {
    if (!client) return;
    let disposed = false, busy = false;
    setList(null);
    const refresh = async () => {
      if (AppState.currentState !== 'active' || disposed || busy) return;
      busy = true;
      try { const value = await client.call<SimulatorList>('simulator:list', []); if (!disposed) setList(value); }
      catch (error) { if (!disposed) setList({ devices: [], supported: true, error: error instanceof Error ? error.message : 'Could not list simulators.' }); }
      finally { busy = false; }
    };
    void refresh(); const timer = setInterval(refresh, 15000);
    const subscription = AppState.addEventListener('change', () => { void refresh(); });
    return () => { disposed = true; clearInterval(timer); subscription.remove(); };
  }, [client]));
  return list;
}

/** Same border, height, spacing and icon size as the desktop Ports pill. */
export function SimulatorChip() {
  const { client } = useSession();
  const list = useSimulators(client);
  if (!client || list?.supported === false) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Simulators, ${list?.devices.length ?? 0} running on this Mac`} onPress={() => router.push({ pathname: '/simulator-sheet', params: { hostId: client.url } })} hitSlop={8} style={({ pressed }) => ({ height: 24, paddingHorizontal: 8, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 })}>
    <Icon icon={SmartphoneIcon} tone="ink2" size={12} /><Text style={{ color: colors.ink2, fontSize: 11 }}>Simulators {list?.devices.length ?? 0}</Text>
  </Pressable>;
}

export function SimulatorSheet({ hostId }: { hostId?: string }) {
  const { client } = useSession();
  const insets = useSafeAreaInsets();
  const source = client && (!hostId || hostId === client.url) ? client : null;
  const list = useSimulators(source);
  const [chosen, setSelected] = useState<SimulatorDevice | null>(null);
  const [choosing, setChoosing] = useState(false);
  const selected = chosen ?? (!choosing && list?.devices.length === 1 ? list.devices[0] : null);
  const [paused, setPaused] = useState(AppState.currentState !== 'active');
  const [revision, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') setPaused(true); });
    return () => { subscription.remove(); setPaused(true); };
  }, []));
  return <View style={{ flex: 1, backgroundColor: colors.page, paddingBottom: insets.bottom }}>
    {/* Keep the header as one native view: form-sheet scroll sizing cannot account for a flattened header. */}
    <View collapsable={false} style={{ flexShrink: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 8 }}>
      {selected && (list?.devices.length ?? 0) > 1 ? <CircleButton label="Back to devices" icon={ArrowLeft01Icon} onPress={() => { setChoosing(true); setSelected(null); }} /> : <View style={{ width: 40 }} />}
      <View style={{ flex: 1, alignItems: 'center' }}><Text accessibilityRole="header" numberOfLines={1} style={{ color: colors.ink, fontSize: 17, fontWeight: '600' }}>{selected?.name ?? 'Simulator'}</Text><Text style={{ color: colors.ink3, fontSize: 11 }}>On this Mac</Text></View>
      <CircleButton label="Close simulator" icon={Cancel01Icon} onPress={() => router.back()} />
    </View>
    <View collapsable={false} style={{ flex: 1, minHeight: 0 }}>
    {!source ? <Text style={[styles.muted, { padding: 20 }]}>Reconnect to this Mac to open its simulators.</Text>
      : paused ? <View style={{ padding: 20, gap: 16 }}><Text style={styles.muted}>Viewer paused while the app was hidden.</Text><PillButton title="Retry" onPress={() => { setRevision(value => value + 1); setPaused(false); }} /></View>
      : selected ? <SimulatorWebView key={`${selected.id}:${revision}`} client={source} deviceId={selected.id} />
      : <PageScroll style={{ flex: 1 }} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={{ padding: 20, gap: 12 }}>
        {!list && <Text style={styles.muted}>Finding running simulators...</Text>}
        {!!list?.error && <Text accessibilityRole="alert" style={{ color: colors.red }}>{list.error}</Text>}
        {list?.supported === false && <Text style={styles.muted}>Simulators are unavailable on this computer.</Text>}
        {list?.supported && !list.error && !list.devices.length && <Text style={styles.muted}>No devices are running. Start an iOS simulator or Android emulator on this Mac.</Text>}
        {list?.devices.map(device => <Pressable key={device.id} accessibilityRole="button" onPress={() => setSelected(device)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10, borderRadius: 12, backgroundColor: pressed ? colors.hover : colors.surface })}><Icon icon={SmartphoneIcon} size={18} tone="ink2" /><Text style={{ flex: 1, color: colors.ink, fontSize: 15 }}>{device.name}</Text><Text style={styles.muted}>{device.platform === 'android' ? 'Android' : 'iOS'} {device.version}</Text></Pressable>)}
      </PageScroll>}
    </View>
  </View>;
}

function SimulatorWebView({ client, deviceId }: { client: Client; deviceId: string }) {
  const scheme = useColorScheme();
  const theme = useMemo(() => {
    const palette = hex(scheme);
    // The sheet and its bottom safe area use page, not the raised surface color.
    return { ...palette, surface: palette.page, scheme: scheme === 'dark' ? 'dark' as const : 'light' as const };
  }, [scheme]);
  const latestTheme = useRef(theme);
  const view = useRef<DomWebViewRef>(null);
  const syncTheme = useCallback(() => view.current?.injectJavaScript(`window.simulatorTheme?.(${JSON.stringify(latestTheme.current).replace(/</g, '\\u003c')});true;`), []);
  useEffect(() => { latestTheme.current = theme; syncTheme(); }, [theme, syncTheme]);
  const [uri, setUri] = useState<string | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const bridge = useRef<ReturnType<typeof createSimulatorBridge> | null>(null);
  useEffect(() => {
    const currentBridge = createSimulatorBridge((method, args) => client.call(`simulator:${method}`, [args]), reply => {
      // Data stays JSON, never an executable string supplied by the remote peer.
      view.current?.injectJavaScript(`window.simulatorReply?.(${JSON.stringify(reply).replace(/</g, '\\u003c')});true;`);
    });
    bridge.current = currentBridge;
    let cancelled = false;
    const file = new File(Paths.cache, `simulator-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    void Promise.resolve().then(() => {
      if (cancelled) return;
      file.write(createSimulatorReceiverHtml({ deviceId, theme: latestTheme.current })); setUri(file.uri);
    }).catch(failure => { if (!cancelled) setError(failure instanceof Error ? failure.message : 'Could not prepare the simulator viewer.'); });
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') { view.current?.injectJavaScript('window.simulatorDispose?.();true;'); currentBridge.dispose(); } });
    return () => { cancelled = true; currentBridge.dispose(); subscription.remove(); try { if (file.exists) file.delete(); } catch { /* The OS may purge cache files while backgrounding. */ } };
  }, [client, deviceId, revision]);
  const failed = () => { bridge.current?.dispose(); setError('The simulator viewer stopped. Retry to reconnect.'); };
  if (error) return <View style={{ padding: 20, gap: 16 }}><Text accessibilityRole="alert" style={{ color: colors.red }}>{error}</Text><PillButton title="Retry" onPress={() => { setError(''); setUri(null); setRevision(value => value + 1); }} /></View>;
  if (!uri) return <Text style={[styles.muted, { padding: 20 }]}>Preparing viewer...</Text>;
  return <DomWebView key={uri} ref={view} source={{ uri }} style={{ flex: 1 }} containerStyle={{ flex: 1 }} useExpoModulesBridge={false} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} allowsPictureInPictureMediaPlayback={false} allowsAirPlayForMediaPlayback={false} scrollEnabled={false} bounces={false} automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" onMessage={event => {
    try { const message = JSON.parse(event.nativeEvent.data); if (message.channel === 'milagre-simulator' && message.method === 'open') syncTheme(); void bridge.current?.receive(message); } catch { /* Only typed simulator RPC messages enter the host. */ }
  }} onContentProcessDidTerminate={failed} onRenderProcessGone={failed} />;
}
