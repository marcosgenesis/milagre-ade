import { useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect, Stack, router } from 'expo-router';
import { Folder01Icon, FolderAddIcon } from '@hugeicons/core-free-icons';
import { useSession } from '../session';
import { Icon } from '../icons';
import { ErrorNotice, Field, ListRow, PageScroll, PillButton, colors, styles } from '../ui';

export default function ProjectsScreen() {
  const session = useSession();
  const [path, setPath] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!session.client) return <Redirect href="/" />;
  // Like Paseo: go to the Chats right away (they show the last copy, or a loading state) while the Project opens.
  async function open(projectPath: string) {
    setBusy(true); setError('');
    router.push('/project');
    try { await session.open(projectPath); }
    catch (e) { setError((e as Error).message); router.back(); }
    finally { setBusy(false); }
  }
  const folder = (icon: typeof Folder01Icon) => <View style={{ width: 36, height: 36, borderRadius: 9, borderCurve: 'continuous', backgroundColor: colors.field, alignItems: 'center', justifyContent: 'center' }}><Icon icon={icon} tone="ink" size={18} /></View>;
  return <PageScroll>
    <Stack.Screen options={{ title: session.hostName || 'Projects' }} />
    <Stack.Toolbar placement="right"><Stack.Toolbar.Button icon="rectangle.portrait.and.arrow.right" accessibilityLabel="Disconnect" onPress={() => { session.disconnect(); router.replace('/'); }} /></Stack.Toolbar>
    <Text style={styles.section}>Projects</Text>
    <View style={[styles.card, { paddingVertical: 0, gap: 0, marginTop: -12 }]}>
      {session.recent.map((project, index) => <View key={project.path}>{index > 0 && <View style={styles.separator} />}<ListRow title={project.name || project.path.split('/').at(-1) || 'Project'} subtitle={project.path.replace(/^\/Users\/[^/]+/, '~')} onPress={() => void open(project.path)} disabled={busy} leading={folder(Folder01Icon)} /></View>)}
      {session.recent.length > 0 && <View style={styles.separator} />}
      <ListRow title="Open another folder…" onPress={() => setAdding(!adding)} leading={folder(FolderAddIcon)} trailing={<View />} />
      {adding && <View style={{ paddingBottom: 14, gap: 10 }}><Field label="Project folder on your Mac" hideLabel value={path} onChangeText={setPath} placeholder="/Users/you/Code/project" autoFocus onSubmitEditing={() => void open(path)} /><PillButton title={busy ? 'Opening…' : 'Open folder'} onPress={() => void open(path)} disabled={busy || !path.startsWith('/')} /></View>}
    </View>
    {error ? <ErrorNotice message={error} /> : null}
  </PageScroll>;
}
