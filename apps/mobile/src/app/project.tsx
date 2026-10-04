import { useMemo, useState } from 'react';
import { Alert, FlatList, RefreshControl, Text, View } from 'react-native';
import { Redirect, Stack, router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { GitBranchIcon, MoreHorizontalIcon, UnfoldMoreIcon } from '@hugeicons/core-free-icons';
import type { AgentSession, ChatMessage, Worktree } from '@milagre/shared/model';
import type { AgentRun } from '@milagre/shared/agent-runs';
import { useSession } from '../session';
import { chatMark, type ChatMark } from '../indicators';
import { isListedChat } from '@milagre/shared/chats';
import { ChatMarkIcon, PullRequestLabel, usePullRequest } from '../status-indicators';
import { Icon, ProviderLogo } from '../icons';
import { LoadingLogo } from '../loading-logo';
import { ErrorNotice, PullDown, colors, styles, type MenuSection } from '../ui';
import { archiveFromPhone } from '../archive';

type Show = 'all' | 'needs' | 'running' | 'archived';
const NEEDS: ChatMark[] = ['question', 'waiting', 'interrupted', 'failed', 'unread'];

function ChatRow({ chat, worktree, run, mark, onOpen, onAction }: { chat: AgentSession; worktree?: Worktree; run?: AgentRun; mark: ChatMark; onOpen: () => void; onAction: (action: string) => void }) {
  const pr = usePullRequest(worktree);
  const title = chat.title || chat.generatedTitle || 'New Chat';
  // Desktop's ⋯ menu, less what only makes sense at the Mac (Finder, editor, commit). A long press on the row opens it too.
  const sections: MenuSection[] = [
    { items: [{ id: 'copy-path', title: 'Copy path', systemImage: 'doc.on.doc', disabled: !worktree?.path }, { id: 'copy-branch', title: 'Copy branch name', systemImage: 'arrow.triangle.branch', disabled: !worktree?.name }] },
    { items: [{ id: 'rename', title: 'Rename chat', systemImage: 'pencil' }, chat.unread ? { id: 'read', title: 'Mark as read', systemImage: 'checkmark' } : { id: 'unread', title: 'Mark as unread', systemImage: 'circle' }] },
    { items: [chat.archived ? { id: 'archive', title: 'Restore', systemImage: 'tray.and.arrow.up' } : { id: 'archive', title: 'Archive', systemImage: 'archivebox', destructive: true }] },
  ];
  return <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 8 }}>
    <PullDown label={`${title}${worktree ? `, ${worktree.name}` : ''}`} title={title} sections={sections} onSelect={onAction} onPress={onOpen} style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 20 }}>
        <ChatMarkIcon mark={mark} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 16, fontWeight: mark === 'unread' ? '600' : '500' }}>{title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {chat.provider && <ProviderLogo provider={chat.provider} size={12} tone="ink3" />}
            <Icon icon={GitBranchIcon} tone="ink3" size={12} />
            <Text numberOfLines={1} style={{ color: colors.ink2, fontSize: 13, flexShrink: 1 }}>{worktree?.name || 'Worktree'}</Text>
            {pr && <PullRequestLabel pr={pr} />}
          </View>
        </View>
      </View>
    </PullDown>
    <PullDown label={`Actions for ${title}`} title={title} sections={sections} onSelect={onAction}>
      <View style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon icon={MoreHorizontalIcon} tone="ink3" size={18} /></View>
    </PullDown>
  </View>;
}

export default function ChatsScreen() {
  const session = useSession();
  const [show, setShow] = useState<Show>('all');
  const [worktreeFilter, setWorktreeFilter] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const snapshot = session.snapshot;
  const rows = useMemo(() => {
    if (!snapshot) return [];
    const { project, runs } = snapshot;
    // One pass over the messages instead of one per Chat.
    const byChat = new Map<number, ChatMessage[]>();
    for (const message of project.state.messages) {
      const list = byChat.get(message.session_id);
      if (list) list.push(message); else byChat.set(message.session_id, [message]);
    }
    return Object.values(project.state.sessions).map(chat => {
      const run = runs.runs[`${project.path}#${chat.id}`];
      const messages = byChat.get(chat.id) ?? [];
      return { chat, run, messages, mark: chatMark(chat, run, messages) };
    // Like desktop's sidebar: a worktree's empty starter chat stays out until it has a message (or a turn is starting).
    }).filter(row => row.run || isListedChat(row.chat, row.messages.length))
      .filter(row => (show === 'archived') === !!row.chat.archived)
      .filter(row => show !== 'needs' || NEEDS.includes(row.mark))
      .filter(row => show !== 'running' || row.mark === 'running')
      .filter(row => worktreeFilter === null || row.chat.worktree_id === worktreeFilter)
      .filter(row => !query.trim() || (row.chat.title || row.chat.generatedTitle || '').toLowerCase().includes(query.trim().toLowerCase()))
      // Newest Chat first, by when it was created (ids only grow), so rows don't jump around as agents reply.
      .sort((a, b) => b.chat.id - a.chat.id);
  }, [snapshot, show, worktreeFilter, query]);
  // Opened from Projects before it loaded: a loading state, unless its last copy is already showing.
  if (session.client && session.opening && !session.opening.cached) return <View accessible accessibilityRole="progressbar" accessibilityLabel={`Opening ${session.opening.path.split('/').at(-1)}…`} style={[styles.screen, { alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
    <Stack.Screen options={{ title: session.opening.path.split('/').at(-1) || 'Project' }} />
    <LoadingLogo />
    <Text style={styles.muted}>Opening {session.opening.path.split('/').at(-1)}…</Text>
  </View>;
  if (!session.client || !snapshot) return <Redirect href="/" />;
  const client = session.client;
  const { project } = snapshot;
  const worktrees = Object.values(project.state.worktrees);
  const newChatWorktree = worktreeFilter ?? rows[0]?.chat.worktree_id ?? worktrees[0]?.id;
  async function act(chat: AgentSession, action: string, run?: AgentRun) {
    setError('');
    try {
      // Archive asks first, as desktop does, with what removing the Chat's worktree would lose; a running Chat is stopped.
      if (action === 'archive' && !chat.archived) {
        await archiveFromPhone({ client, alert: (...args) => Alert.alert(...args), projectPath: project.path, state: project.state, chat, running: !!run, onConfirm: session.expectActivity, notify: setError, refresh: session.refresh });
        return;
      }
      if (action === 'archive') await client.call('chat:patch', [project.path, chat.id, { archived: false }]);
      if (action === 'read' || action === 'unread') await client.call('chat:patch', [project.path, chat.id, { unread: action === 'unread' }]);
      const worktree = project.state.worktrees[chat.worktree_id];
      if (action === 'copy-path' && worktree) await Clipboard.setStringAsync(worktree.path);
      if (action === 'copy-branch' && worktree) await Clipboard.setStringAsync(worktree.name);
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
    { title: 'Computer', items: [{ id: 'computers', title: 'Switch Computer', subtitle: session.hostName || undefined, systemImage: 'laptopcomputer' }] },
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
  const startChat = (id: number) => router.push({ pathname: '/chat', params: { worktreeId: String(id) } });
  // Native bar items: iOS draws the glass toolbar, the bottom search field and their menus.
  const toolbars = <>
    <Stack.SearchBar placeholder="Search Chats" onChangeText={event => setQuery(event.nativeEvent.text)} onCancelButtonPress={() => setQuery('')} hideWhenScrolling={false} />
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon="line.3.horizontal.decrease" accessibilityLabel="Filter Chats">
        <Stack.Toolbar.MenuAction icon="arrow.triangle.branch" onPress={() => router.push('/new-worktree')}>New Worktree</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.Menu inline title="Show">
          {([['all', 'All Chats'], ['needs', 'Needs me'], ['running', 'Running'], ['archived', 'Archived']] as const).map(([id, title]) => <Stack.Toolbar.MenuAction key={id} isOn={show === id} onPress={() => setShow(id)}>{title}</Stack.Toolbar.MenuAction>)}
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Menu inline title="Worktree">
          <Stack.Toolbar.MenuAction isOn={worktreeFilter === null} onPress={() => setWorktreeFilter(null)}>All Worktrees</Stack.Toolbar.MenuAction>
          {worktrees.map(item => <Stack.Toolbar.MenuAction key={item.id} isOn={worktreeFilter === item.id} onPress={() => setWorktreeFilter(item.id)}>{item.name}</Stack.Toolbar.MenuAction>)}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
    <Stack.Toolbar placement="bottom">
      <Stack.Toolbar.SearchBarSlot />
      <Stack.Toolbar.Spacer />
      {show !== 'archived' && newChatWorktree !== undefined && <Stack.Toolbar.Button icon="square.and.pencil" accessibilityLabel="New Chat" onPress={() => startChat(newChatWorktree)} />}
    </Stack.Toolbar>
  </>;
  const empty = show === 'archived' ? 'No archived Chats.' : show !== 'all' || query || worktreeFilter !== null ? 'No Chats match this filter.' : worktrees.length ? 'No Chats yet. Start one below.' : 'Open a Git repository to start a Chat.';
  return <View style={styles.screen}>
    <Stack.Screen options={{ headerTitle: () => switcher }} />
    {toolbars}
    <FlatList data={rows} keyExtractor={row => String(row.chat.id)} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void session.refresh().catch(e => setError(e.message)).finally(() => setRefreshing(false)); }} />}
      ItemSeparatorComponent={() => <View style={[styles.separator, { marginLeft: 52 }]} />}
      ListHeaderComponent={error || session.error ? <View style={{ padding: 16 }}><ErrorNotice message={error || session.error} retry={session.error ? () => router.dismissTo('/') : undefined} /></View> : null}
      ListEmptyComponent={<Text style={[styles.muted, { textAlign: 'center', paddingTop: 64, paddingHorizontal: 32 }]}>{empty}</Text>}
      contentContainerStyle={{ paddingBottom: 24 }}
      renderItem={({ item }) => <ChatRow chat={item.chat} run={item.run} mark={item.mark} worktree={project.state.worktrees[item.chat.worktree_id]} onOpen={() => router.push({ pathname: '/chat', params: { id: String(item.chat.id) } })} onAction={action => void act(item.chat, action, item.run)} />} />
  </View>;
}
