import { Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSession } from '../session';
import { Button, ErrorNotice, PageScroll, colors, styles } from '../ui';

export default function ProjectScreen() {
  const session = useSession();
  if (!session.client || !session.snapshot) return <Redirect href="/" />;
  const { project, runs } = session.snapshot;
  const chats = Object.values(project.state.sessions).filter(chat => !chat.archived);
  return <PageScroll><Text style={styles.label}>PROJECT</Text><Text style={styles.title}>{project.name}</Text><Text style={styles.muted}>{chats.length} {chats.length === 1 ? 'Chat' : 'Chats'} on your computer</Text>
    {session.error ? <ErrorNotice message={session.error} retry={() => router.push('/')} /> : null}
    {chats.map(chat => <View style={styles.card} key={chat.id}><View style={styles.row}><Text style={[styles.label, { color: runs.runs[`${project.path}#${chat.id}`] ? colors.green : colors.muted }]}>{runs.runs[`${project.path}#${chat.id}`] ? 'WORKING' : chat.provider?.toUpperCase() || 'NEW CHAT'}</Text></View><Text style={styles.subtitle}>{chat.title || chat.generatedTitle || chat.agent_name || 'Untitled Chat'}</Text><Text style={styles.muted}>{project.state.worktrees[chat.worktree_id]?.name}</Text><Button title={`Open ${chat.title || chat.generatedTitle || 'Chat'}`} secondary onPress={() => router.push({ pathname: '/chat', params: { id: String(chat.id) } })} /></View>)}
    {Object.values(project.state.worktrees).map(worktree => <Button key={worktree.id} title={`New Chat in ${worktree.name}`} onPress={() => router.push({ pathname: '/chat', params: { worktreeId: String(worktree.id) } })} />)}
    {!Object.keys(project.state.worktrees).length && <Text style={styles.muted}>Open a Git repository to start a Chat.</Text>}
  </PageScroll>;
}
