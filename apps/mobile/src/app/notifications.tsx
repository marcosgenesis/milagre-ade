import { Linking, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { Notification01Icon } from '@hugeicons/core-free-icons';
import { usePush } from '../push';
import { useSession } from '../session';
import { Icon } from '../icons';
import { ErrorNotice, PageScroll, PillButton, Toggle, colors, styles } from '../ui';

export default function NotificationsScreen() {
  const push = usePush();
  const session = useSession();
  const state = push.state;
  return <>
    <Stack.Screen options={{ title: 'Notifications' }} />
    <PageScroll>
      <View style={[styles.card, { gap: 16 }]}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.field, alignItems: 'center', justifyContent: 'center' }}><Icon icon={Notification01Icon} size={24} tone="ink" /></View>
          <View style={{ flex: 1, gap: 3 }}><Text style={styles.subtitle}>Chat notifications</Text><Text style={styles.muted}>{state?.enabled ? 'On' : 'Off'}</Text></View>
        </View>
        <Text style={styles.text}>Know when an agent needs you or finishes a turn, even when Milagre is closed.</Text>
        <PillButton title={state?.enabled ? 'Turn off notifications' : 'Enable notifications'} secondary={state?.enabled} loading={push.busy}
          disabled={!state || push.busy || (!state.enabled && (!!push.unavailable || !session.hosts.length))} onPress={() => void (state?.enabled ? push.disable() : push.enable())} />
        {push.unavailable ? <Text style={styles.muted}>{push.unavailable}</Text> : !session.hosts.length ? <Text style={styles.muted}>Pair a computer to receive its Chat notifications.</Text> : null}
      </View>
      <View style={styles.card}>
        <Toggle title="Notify when waiting" selected={state?.notifyWhenWaiting ?? true} disabled={!state || push.busy} onPress={() => void push.preferences({ notifyWhenWaiting: !state?.notifyWhenWaiting })} />
        <Text style={styles.muted}>Approvals and questions that need your input.</Text>
        <View style={styles.separator} />
        <Toggle title="Notify when finished" selected={state?.notifyOnCompletion ?? true} disabled={!state || push.busy} onPress={() => void push.preferences({ notifyOnCompletion: !state?.notifyOnCompletion })} />
        <Text style={styles.muted}>Completed turns and turns that fail.</Text>
      </View>
      {push.error ? <ErrorNotice message={push.error} /> : null}
      {state?.pending.length ? <Text style={styles.muted}>Removal is pending for {state.pending.map(host => host.name).join(', ')}. Milagre will retry when you open the app and the computer is online.</Text> : null}
      <Text style={styles.muted}>Alerts include Chat previews. Expo, Apple and Google process notification content. Your computer must stay online to send alerts.</Text>
      <PillButton title="Open system settings" secondary onPress={() => void Linking.openSettings()} />
    </PageScroll>
  </>;
}
