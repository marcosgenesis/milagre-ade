import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import { Notification01Icon } from '@hugeicons/core-free-icons';
import { usePush } from '../push';
import { Icon } from '../icons';
import { ListRow, PageScroll, styles } from '../ui';
import { UsageSection } from '../usage-section';

export default function SettingsScreen() {
  const push = usePush();
  return <>
    <Stack.Screen options={{ title: 'Settings' }} />
    <PageScroll>
      <View style={styles.card}>
        <ListRow title="Notifications" subtitle={push.state ? push.state.enabled ? 'On' : 'Off' : undefined}
          leading={<Icon icon={Notification01Icon} tone="ink" size={22} />} onPress={() => router.push('/notifications')} />
      </View>
      <UsageSection />
    </PageScroll>
  </>;
}
