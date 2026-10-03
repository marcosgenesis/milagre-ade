import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { Redirect, Stack, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FilterHorizontalIcon, GitBranchIcon, PencilEdit02Icon, Search01Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons';
import type { AgentSession, Worktree } from '@milagre/shared/model';
import type { AgentRun } from '@milagre/shared/agent-runs';
import { useSession } from '../session';
import { chatMark, chatRecency, type ChatMark } from '../indicators';
import { ChatMarkIcon, PullRequestLabel, usePullRequest } from '../status-indicators';
import { Icon, ProviderLogo } from '../icons';
import { ErrorNotice, HeaderButton, PillButton, PullDown, colors, styles } from '../ui';

type Show = 'all' | 'needs' | 'running' | 'archived';
const NEEDS: ChatMark[] = ['question', 'waiting', 'interrupted', 'failed', 'unread'];

function ChatRow({ chat, worktree, run, mark, onOpen, onAction }: { chat: AgentSession; worktree?: Worktree; run?: AgentRun; mark: ChatMark; onOpen: () => void; onAction: (action: string) => void }) {
  const pr = usePullRequest(worktree);
  const title = chat.title || chat.generatedTitle || 'New Chat';
  return <PullDown label={`Actions for ${title}`} longPress sections={[{ items: [{ id: 'rename', title: 'Rename', systemImage: 'pencil' }, { id: 'archive', title: chat.archived ? 'Restore' : 'Archive', systemImage: chat.archived ? 'tray.and.arrow.up' : 'archivebox', disabled: !!run && !chat.archived }] }]} onSelect={onAction}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}${worktree ? `, ${worktree.name}` : ''}`} onPress={onOpen} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 20, backgroundColor: pressed ? colors.hover : 'transparent' })}>
      <ChatMarkIcon mark={mark} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 16, fontWeight: mark === 'unread' ? '600' : '500' }}>{title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {chat.provider && <ProviderLogo provider={chat.provider} size={12} tone="ink3" />}
          <Icon icon={GitBranchIcon} tone="ink3" size={12} />
          <Text numberOfLines={1} style={{ color: colors.ink2, fontSize: 13, flexShrink: 1 }}>{worktree?.name || 'Worktree'}</Text>
          {worktree?.diff && (worktree.diff.added > 0 || worktree.diff.removed > 0) && <Text style={{ fontSize: 13 }}><Text style={{ color: colors.green }}>+{worktree.diff.added}</Text> <Text style={{ color: colors.red }}>−{worktree.diff.removed}</Text></Text>}
          {pr && <PullRequestLabel pr={pr} />}
        </View>
      </View>
    </Pressable>
  </PullDown>;
}

export default function ChatsScreen() {
  const session = useSession();
  const insets = useSafeAreaInsets();
  const [show, setShow] = useState<Show>('all');
  const [worktreeFilter, setWorktreeFilter] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const snapshot = session.snapshot;
  const rows = useMemo(() => {
    if (!snapshot) return [];
    const { project, runs } = snapshot;
    const messages = project.state.messages;
    return Object.values(project.state.sessions).map(chat => {
      const run = runs.runs[`${project.path}#${chat.id}`];
      return { chat, run, mark: chatMark(chat, run, messages.filter(message => message.session_id === chat.id)), recency: chatRecency(chat.id, messages) };
    }).filter(row => (show === 'archived') === !!row.chat.archived)
      .filter(row => show !== 'needs' || NEEDS.includes(row.mark))
      .filter(row => show !== 'running' || row.mark === 'running')
      .filter(row => worktreeFilter === null || row.chat.worktree_id === worktreeFilter)
      .filter(row => !query.trim() || (row.chat.title || row.chat.generatedTitle || '').toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => b.recency - a.recency);
  }, [snapshot, show, worktreeFilter, query]);
  if (!session.client || !snapshot) return <Redirect href="/" />;
  const client = session.client;
  const { project } = snapshot;
  const worktrees = Object.values(project.state.worktrees);
  const newChatWorktree = worktreeFilter ?? rows[0]?.chat.worktree_id ?? worktrees[0]?.id;
  async function act(chat: AgentSession, action: string) {
    setError('');
    try {
      if (action === 'archive') await client.call('chat:patch', [project.path, chat.id, { archived: !chat.archived }]);
      if (action === 'rename') {
        const title = await new Promise<string | null>(resolve => Alert.prompt('Rename Chat', undefined, [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(null) }, { text: 'Save', onPress: (value?: string) => resolve(value ?? null) }], 'plain-text', chat.title || chat.generatedTitle || ''));
        if (!title?.trim()) return;
        await client.call('chat:patch', [project.path, chat.id, { title: title.trim() }]);
      }
      await session.refresh();
    } catch (e) { setError((e as Error).message); }
  }
  const switcher = <PullDown label="Switch Project" title={session.hostName || undefined} sections={[
    { title: 'Projects', items: [...session.recent.map(item => ({ id: `project:${item.path}`, title: item.name || item.path.split('/').at(-1) || 'Project', checked: item.path === project.path, systemImage: 'folder' })), { id: 'open', title: 'Open another folder…', systemImage: 'folder.badge.plus' }] },
    { title: 'Computer', items: [{ id: 'computers', title: session.hostName || 'Computers', subtitle: 'Switch computer', systemImage: 'laptopcomputer' }] },
  ]} onSelect={id => {
    if (id === 'open') router.navigate('/projects');
    else if (id === 'computers') router.dismissTo('/');
    else if (id.startsWith('project:')) void session.open(id.slice(8)).catch(e => setError((e as Error).message));
  }}>
    <View style={{ alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Text numberOfLines={1} style={{ color: colors.ink, fontSize: 17, fontWeight: '600', maxWidth: 220 }}>{project.name}</Text><Icon icon={UnfoldMoreIcon} tone="ink3" size={14} /></View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: session.error ? colors.red : colors.green }} /><Text numberOfLines={1} style={{ color: colors.ink2, fontSize: 12, maxWidth: 200 }}>{session.hostName}</Text></View>
    </View>
  </PullDown>;
  const filter = <PullDown label="Filter Chats" sections={[
    { items: [{ id: 'new-worktree', title: 'New Worktree', systemImage: 'arrow.triangle.branch' }] },
    { title: 'Show', items: ([['all', 'All Chats'], ['needs', 'Needs me'], ['running', 'Running'], ['archived', 'Archived']] as const).map(([id, title]) => ({ id: `show:${id}`, title, checked: show === id })) },
    { title: 'Worktree', items: [{ id: 'worktree:all', title: 'All Worktrees', checked: worktreeFilter === null }, ...worktrees.map(item => ({ id: `worktree:${item.id}`, title: item.name, checked: worktreeFilter === item.id }))] },
  ]} onSelect={id => {
    if (id === 'new-worktree') router.push('/new-worktree');
    else if (id.startsWith('show:')) setShow(id.slice(5) as Show);
    else if (id === 'worktree:all') setWorktreeFilter(null);
    else if (id.startsWith('worktree:')) setWorktreeFilter(Number(id.slice(9)));
  }}><HeaderButton label="Filter Chats" icon={FilterHorizontalIcon} /></PullDown>;
  const empty = show === 'archived' ? 'No archived Chats.' : show !== 'all' || query || worktreeFilter !== null ? 'No Chats match this filter.' : worktrees.length ? 'No Chats yet. Start one below.' : 'Open a Git repository to start a Chat.';
  return <View style={styles.screen}>
    <Stack.Screen options={{ headerTitle: () => switcher, headerRight: () => filter }} />
    <FlatList data={rows} keyExtractor={row => String(row.chat.id)} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void session.refresh().catch(e => setError(e.message)).finally(() => setRefreshing(false)); }} />}
      ItemSeparatorComponent={() => <View style={[styles.separator, { marginLeft: 52 }]} />}
      ListHeaderComponent={error || session.error ? <View style={{ padding: 16 }}><ErrorNotice message={error || session.error} retry={session.error ? () => router.dismissTo('/') : undefined} /></View> : null}
      ListEmptyComponent={<Text style={[styles.muted, { textAlign: 'center', paddingTop: 64, paddingHorizontal: 32 }]}>{empty}</Text>}
      contentContainerStyle={{ paddingBottom: 110 }}
      renderItem={({ item }) => <ChatRow chat={item.chat} run={item.run} mark={item.mark} worktree={project.state.worktrees[item.chat.worktree_id]} onOpen={() => router.push({ pathname: '/chat', params: { id: String(item.chat.id) } })} onAction={action => void act(item.chat, action)} />} />
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 16) }}>
      <View style={{ flex: 1, height: 48, borderRadius: 24, borderCurve: 'continuous', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, boxShadow: '0 4px 16px #0000000f' }}>
        <Icon icon={Search01Icon} tone="ink3" size={18} />
        <TextInput accessibilityLabel="Search Chats" placeholder="Search Chats" placeholderTextColor={colors.ink3} value={query} onChangeText={setQuery} returnKeyType="search" style={{ flex: 1, color: colors.ink, fontSize: 16 }} />
      </View>
      {newChatWorktree !== undefined && show !== 'archived' && <PullDown label="New Chat in another Worktree" longPress sections={[{ title: 'New Chat in', items: worktrees.map(item => ({ id: String(item.id), title: item.name, checked: item.id === newChatWorktree, systemImage: 'arrow.triangle.branch' })) }]} onSelect={id => router.push({ pathname: '/chat', params: { worktreeId: id } })}>
        <PillButton title="Chat" icon={PencilEdit02Icon} onPress={() => router.push({ pathname: '/chat', params: { worktreeId: String(newChatWorktree) } })} style={{ height: 48, borderRadius: 24, boxShadow: '0 4px 16px #00000026' }} />
      </PullDown>}
    </View>
  </View>;
}
