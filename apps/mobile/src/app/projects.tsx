import { useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSession } from '../session';
import { Button, ErrorNotice, Field, ListRow, PageScroll, colors, styles } from '../ui';

export default function ProjectsScreen() {
  const session = useSession();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!session.client) return <Redirect href="/" />;
  async function open(projectPath: string) {
    setBusy(true); setError('');
    try { await session.open(projectPath); router.push('/project'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <PageScroll><View style={styles.row}><Text style={[styles.label, { color: colors.green }]}>CONNECTED</Text><Text style={styles.muted}>{session.client.url}</Text></View><Text style={styles.muted}>Pick a Project to see its Chats.</Text>
    {session.recent.length > 0 && <View style={styles.card}>{session.recent.map(project => <ListRow key={project.path} title={project.name || project.path.split('/').at(-1) || 'Project'} subtitle={project.path} onPress={() => void open(project.path)} disabled={busy} />)}</View>}
    <View style={styles.card}><Field label="Project folder on your Mac" value={path} onChangeText={setPath} placeholder="/Users/you/Code/project" /><Button title={busy ? 'Opening...' : 'Open folder'} onPress={() => void open(path)} disabled={busy || !path.startsWith('/')} secondary /></View>
    {error ? <ErrorNotice message={error} /> : null}
    <Button title="Disconnect" secondary onPress={() => { session.disconnect(); router.replace('/'); }} disabled={busy} />
  </PageScroll>;
}
