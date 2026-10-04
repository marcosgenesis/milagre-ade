import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import { useAppUpdates } from '../update-banner';
import { PageScroll, PillButton, colors, styles } from '../ui';

export default function UpdatesScreen() {
  const { state, check, install } = useAppUpdates();
  const busy = ['checking', 'downloading', 'restarting'].includes(state.status);
  const messages = {
    idle: 'Check for the latest version of Milagre.', disabled: 'Updates are unavailable in this app.',
    checking: 'Checking for updates…', 'up-to-date': 'Milagre is up to date.', 'check-error': state.error,
    downloading: 'Downloading the update in the background…', ready: state.error || 'The update is ready to apply.',
    restarting: 'Applying the update…', error: state.error,
  };
  return <>
    <Stack.Screen options={{ title: 'App updates' }} />
    <PageScroll>
      <View style={styles.card}>
        <Text style={styles.subtitle}>Milagre</Text>
        {Constants.nativeAppVersion && <Text style={styles.muted}>Version {Constants.nativeAppVersion}</Text>}
        <Text selectable accessibilityLiveRegion="polite" style={[styles.text, state.error ? { color: colors.red } : null]}>{messages[state.status]}</Text>
        <PillButton title={state.status === 'ready' ? 'Update now' : busy ? state.status === 'checking' ? 'Checking' : state.status === 'downloading' ? 'Downloading' : 'Applying' : 'Check for updates'}
          disabled={busy || state.status === 'disabled'} loading={busy}
          onPress={() => { void (state.status === 'ready' ? install() : check(true)); }} />
      </View>
    </PageScroll>
  </>;
}
