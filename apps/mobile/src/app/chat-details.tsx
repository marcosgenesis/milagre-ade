import { useState } from 'react';
import { Text } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useSession } from '../session';
import { Button, ErrorNotice, Field, PageScroll, styles } from '../ui';

export default function ChatDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const chat = session.snapshot?.project.state.sessions[Number(id)];
  const [title, setTitle] = useState(chat?.title || chat?.generatedTitle || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!session.client || !session.snapshot || !chat) return <Redirect href="/" />;
  const { project, runs } = session.snapshot;
  const running = !!runs.runs[`${project.path}#${id}`];
  async function save(patch: { title?: string; archived?: boolean }) {
    setBusy(true); setError('');
    try { await session.client!.call('chat:patch', [project.path, Number(id), patch]); await session.refresh(); router.back(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <PageScroll><Text style={styles.title}>Manage Chat</Text><Field label="Chat name" value={title} onChangeText={setTitle} placeholder="Give this Chat a name" /><Button title="Save name" disabled={busy || !title.trim()} onPress={() => void save({ title: title.trim() })} />
    <Text style={styles.muted}>{chat.archived ? 'Restoring brings this Chat back to its Worktree list.' : 'Archiving hides this Chat from the active list. Its messages stay saved.'}</Text>
    {running && <Text style={styles.muted}>Stop the running turn before archiving this Chat.</Text>}
    <Button title={chat.archived ? 'Restore Chat' : 'Archive Chat'} secondary disabled={busy || running} onPress={() => void save({ archived: !chat.archived })} />
    {error ? <ErrorNotice message={error} /> : null}
  </PageScroll>;
}
