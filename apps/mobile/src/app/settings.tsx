import { Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { ChartBarLineIcon, Download04Icon, Notification01Icon, UserMultipleIcon } from '@hugeicons/core-free-icons';
import { usePush } from '../push';
import { useAppUpdates } from '../update-sheet';
import { Icon } from '../icons';
import { useSession } from '../session';
import { ProjectIcon } from '../project-icon';
import { ListRow, PageScroll, styles } from '../ui';

type SettingsPage = 'notifications' | 'usage' | 'accounts';

export default function SettingsScreen() {
  return <>
    <Stack.Screen options={{ title: 'Settings' }} />
    <PageScroll><SettingsView onOpen={page => router.push(`/${page}`)} /></PageScroll>
  </>;
}

/** Settings pages stay on the native stack for the header and interactive back gesture. */
export function SettingsView({ onOpen }: { onOpen: (page: SettingsPage) => void }) {
  const push = usePush();
  const updates = useAppUpdates();
  const session = useSession();
  const projects = session.recent.filter(project => !project.link);
  const status = updates.state.status;
  const update = status === 'disabled' ? 'Not available in this build' : status === 'checking' ? 'Checking…' : status === 'downloading' ? 'Downloading…' : status === 'ready' ? 'Ready to install' : status === 'up-to-date' ? 'Up to date' : status === 'restarting' ? 'Restarting…' : status === 'error' || status === 'check-error' ? 'Could not check' : 'Check for updates';
  return <View style={{ gap: 8 }}><View style={[styles.card, { paddingVertical: 4, gap: 0 }]}>
    <ListRow compact title="Accounts" leading={<Icon icon={UserMultipleIcon} tone="ink" size={20} />} onPress={() => onOpen('accounts')} />
    <View style={styles.separator} />
    <ListRow compact title="Notifications" subtitle={push.state ? push.state.enabled ? 'On' : 'Off' : undefined}
      leading={<Icon icon={Notification01Icon} tone="ink" size={20} />} onPress={() => onOpen('notifications')} />
    <View style={styles.separator} />
    <ListRow compact title="Plan usage" leading={<Icon icon={ChartBarLineIcon} tone="ink" size={20} />} onPress={() => onOpen('usage')} />
    <View style={styles.separator} />
    {/* Checks now and shows the update sheet, which follows the check to Up to date or Update now. */}
    <ListRow compact title="App update" subtitle={update} disabled={status === 'disabled'} leading={<Icon icon={Download04Icon} tone="ink" size={20} />} onPress={() => { void updates.check(true); router.push('/update-sheet'); }} />
  </View>
  {/* The connected computer's Projects; each opens its own settings. */}
  {session.client && projects.length > 0 && <>
    <Text style={[styles.label, { marginTop: 16 }]}>Projects</Text>
    <View style={[styles.card, { paddingVertical: 4, gap: 0 }]}>
      {projects.map((project, index) => <View key={project.path}>
        {index > 0 && <View style={styles.separator} />}
        <ListRow compact title={project.name || project.path.split('/').filter(Boolean).at(-1) || project.path} leading={<ProjectIcon client={session.client} path={project.path} size={24} />}
          onPress={() => router.push({ pathname: '/project-settings', params: { path: project.path, name: project.name ?? '' } })} />
      </View>)}
    </View>
  </>}
  </View>;
}
