import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import { ChartBarLineIcon, Notification01Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import { usePush } from '../push';
import { Icon } from '../icons';
import { ListRow, PageScroll, styles } from '../ui';

export default function SettingsScreen() {
  const push = usePush();
  return <>
    <Stack.Screen options={{ title: 'Settings' }} />
    <PageScroll>
      <View style={styles.card}>
        <ListRow title="Notifications" subtitle={push.state ? push.state.enabled ? 'On' : 'Off' : undefined}
          leading={<Icon icon={Notification01Icon} tone="ink" size={22} />} onPress={() => router.push('/notifications')} />
        <View style={styles.separator} />
        <ListRow title="Plan usage" leading={<Icon icon={ChartBarLineIcon} tone="ink" size={22} />} onPress={() => router.push('/usage')} />
        <View style={styles.separator} />
        <ListRow title="App updates" leading={<Icon icon={RefreshIcon} tone="ink" size={22} />} onPress={() => router.push('/updates')} />
      </View>
    </PageScroll>
  </>;
}
