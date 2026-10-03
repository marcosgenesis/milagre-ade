import { useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSession } from '../session';
import { Button, Choice, ErrorNotice, PageScroll, colors, styles } from '../ui';

export default function ProjectScreen() {
  const session = useSession();
  const [archived, setArchived] = useState(false);
  if (!session.client || !session.snapshot) return <Redirect href="/" />;
  const { project, runs } = session.snapshot;
  const chats = Object.values(project.state.sessions).filter(chat => !!chat.archived === archived);
  const worktrees = Object.values(project.state.worktrees);
  return <PageScroll><Text style={styles.label}>PROJECT</Text><Text style={styles.title}>{project.name}</Text><Text style={styles.muted}>{worktrees.length} Worktrees / {chats.length} {archived ? 'archived ' : ''}Chats</Text>
    <Choice title="Show archived Chats" selected={archived} onPress={() => setArchived(!archived)} />
    {session.error ? <ErrorNotice message={session.error} retry={() => router.push('/')} /> : null}
    {worktrees.map(worktree => <View style={styles.card} key={worktree.id}><Text style={styles.label}>WORKTREE</Text><Text style={styles.subtitle}>{worktree.name}</Text>
      {chats.filter(chat => chat.worktree_id === worktree.id).map(chat => <View style={{ paddingVertical: 12, gap: 8, borderTopWidth: 1, borderColor: colors.line }} key={chat.id}><Text style={[styles.label, { color: runs.runs[`${project.path}#${chat.id}`] ? colors.green : colors.muted }]}>{runs.runs[`${project.path}#${chat.id}`] ? 'WORKING' : chat.provider?.toUpperCase() || 'NEW CHAT'}</Text><Button title={`Open ${chat.title || chat.generatedTitle || chat.agent_name || 'Chat'}`} secondary onPress={() => router.push({ pathname: '/chat', params: { id: String(chat.id) } })} /></View>)}
      {!archived && <Button title={`New Chat in ${worktree.name}`} onPress={() => router.push({ pathname: '/chat', params: { worktreeId: String(worktree.id) } })} />}
      <Button title={`Changes in ${worktree.name}`} secondary onPress={() => router.push({ pathname: '/changes', params: { worktreeId: String(worktree.id) } })} />
    </View>)}
    {worktrees.length ? <Button title="New Worktree" secondary onPress={() => router.push('/new-worktree')} /> : <Text style={styles.muted}>Open a Git repository to start a Chat.</Text>}
  </PageScroll>;
}
