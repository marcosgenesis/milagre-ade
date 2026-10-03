import { providerName } from "@milagre/shared/providers";
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect, Stack, router } from 'expo-router';
import { ChatStatus, AgentStatus, WorktreeStatus } from '../status-indicators';
import { useSession } from '../session';
import { Button, Toggle, ErrorNotice, ListRow, PageScroll, styles } from '../ui';

export default function ProjectScreen() {
  const session = useSession();
  const [archived, setArchived] = useState(false);
  if (!session.client || !session.snapshot) return <Redirect href="/" />;
  const { project, runs } = session.snapshot;
  const chats = Object.values(project.state.sessions).filter(chat => !!chat.archived === archived);
  const worktrees = Object.values(project.state.worktrees);
  return <PageScroll><Stack.Screen options={{ title: project.name }} /><Text style={styles.muted}>{worktrees.length} Worktrees / {chats.length} {archived ? 'archived ' : ''}Chats</Text>
    <Toggle title="Show archived Chats" selected={archived} onPress={() => setArchived(!archived)} />
    {session.error ? <ErrorNotice message={session.error} retry={() => router.push('/')} /> : null}
    {worktrees.map(worktree => <View style={styles.card} key={worktree.id}><Text style={styles.label}>Worktree</Text><Text style={styles.subtitle}>{worktree.name}</Text><WorktreeStatus worktree={worktree} />
      {chats.filter(chat => chat.worktree_id === worktree.id).map(chat => { const run = runs.runs[`${project.path}#${chat.id}`]; return <View key={chat.id}><ListRow title={chat.title || chat.generatedTitle || chat.agent_name || 'Chat'} subtitle={chat.provider ? providerName(chat.provider) : 'New Chat'} onPress={() => router.push({ pathname: '/chat', params: { id: String(chat.id) } })} /><ChatStatus chat={chat} run={run} messages={project.state.messages.filter(message => message.session_id === chat.id)} /><AgentStatus agents={chat.subagents || []} /></View>; })}
      {!archived && <Button title="New Chat" onPress={() => router.push({ pathname: '/chat', params: { worktreeId: String(worktree.id) } })} />}
      <Button title="View changes" secondary onPress={() => router.push({ pathname: '/changes', params: { worktreeId: String(worktree.id) } })} />
    </View>)}
    {worktrees.length ? <Button title="New Worktree" secondary onPress={() => router.push('/new-worktree')} /> : <Text style={styles.muted}>Open a Git repository to start a Chat.</Text>}
  </PageScroll>;
}
