import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import { ChartBarLineIcon, Download04Icon, Notification01Icon, UserMultipleIcon } from '@hugeicons/core-free-icons';
import { usePush } from '../push';
import { useAppUpdates } from '../update-sheet';
import { Icon } from '../icons';
import { ListRow, PageScroll, styles } from '../ui';

export type SettingsPage = 'notifications' | 'usage' | 'accounts';

export default function SettingsScreen() {
  return <>
    <Stack.Screen options={{ title: 'Settings' }} />
    <PageScroll><SettingsView onOpen={page => router.push(`/${page}`)} /></PageScroll>
  </>;
}

/** Settings' rows; the navigation panel shows them too, opening each page inside the panel. */
export function SettingsView({ onOpen }: { onOpen: (page: SettingsPage) => void }) {
  const push = usePush();
  const updates = useAppUpdates();
  const status = updates.state.status;
  const update = status === 'disabled' ? 'Not available in this build' : status === 'checking' ? 'Checking…' : status === 'downloading' ? 'Downloading…' : status === 'ready' ? 'Ready to install' : status === 'up-to-date' ? 'Up to date' : status === 'restarting' ? 'Restarting…' : status === 'error' || status === 'check-error' ? 'Could not check' : 'Check for updates';
  return <View style={styles.card}>
    <ListRow title="Accounts" leading={<Icon icon={UserMultipleIcon} tone="ink" size={22} />} onPress={() => onOpen('accounts')} />
    <View style={styles.separator} />
    <ListRow title="Notifications" subtitle={push.state ? push.state.enabled ? 'On' : 'Off' : undefined}
      leading={<Icon icon={Notification01Icon} tone="ink" size={22} />} onPress={() => onOpen('notifications')} />
    <View style={styles.separator} />
    <ListRow title="Plan usage" leading={<Icon icon={ChartBarLineIcon} tone="ink" size={22} />} onPress={() => onOpen('usage')} />
    <View style={styles.separator} />
    {/* Checks now and shows the update sheet, which follows the check to Up to date or Update now. */}
    <ListRow title="App update" subtitle={update} disabled={status === 'disabled'} leading={<Icon icon={Download04Icon} tone="ink" size={22} />} onPress={() => { void updates.check(true); router.push('/update-sheet'); }} />
  </View>;
}
