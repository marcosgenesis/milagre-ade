import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Href } from 'expo-router';
import { Add01Icon, ArrowDown01Icon, ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, FilterHorizontalIcon, FolderAddIcon, GitBranchIcon, LaptopIcon, MoreHorizontalIcon, Search01Icon, Settings01Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isListedChat, pendingChatSessionId, withPendingChat } from '@milagre/shared/chats';
import type { AgentSession } from '@milagre/shared/model';
import type { Snapshot } from './client';
import { usePendingChats, useSession, type MobilePendingChat } from './session';
import { chatMark, type ChatMark } from './indicators';
import { ChatMarkIcon } from './status-indicators';
import { Icon } from './icons';
import { LoadingLogo } from './loading-logo';
import { ErrorNotice, Field, IconButton, PageScroll, PullDown, colors, styles } from './ui';
import { SettingsView, type SettingsPage } from './app/settings';
import { NotificationsView } from './app/notifications';
import { UsageSection } from './usage-section';
import { ProjectIcon } from './project-icon';
import { ProjectSearch } from './project-search';
import { chatMenu, runChatAction } from './chat-actions';
import { confirm } from './confirm-store';

type Destination = (href: Href, secondary?: boolean) => void;
type Row = { key: string; path: string } & (
  | { kind: 'project'; name: string; expanded: boolean }
  | { kind: 'chat'; chat: AgentSession; worktree: string; mark: ChatMark; pending?: MobilePendingChat }
  | { kind: 'notice'; message: string; failed?: boolean }
);
type Show = 'all' | 'needs' | 'running' | 'archived';
const SHOW: [Show, string, string][] = [['all', 'All Chats', 'bubble.left.and.bubble.right'], ['needs', 'Needs me', 'exclamationmark.bubble'], ['running', 'Running', 'play.circle'], ['archived', 'Archived', 'archivebox']];
const NEEDS: ChatMark[] = ['question', 'waiting', 'interrupted', 'failed', 'unread'];
const labels: Record<ChatMark, string> = { idle: '', running: 'Running', question: 'Needs reply', waiting: 'Needs approval', interrupted: 'Interrupted', failed: 'Failed', unread: 'Unread' };

/** The same project tree is the first-run destination and the drawer over a Chat: every Project's Chats, their ⋯ actions and filters. */
export function ProjectNavigation({ onNavigate, onClose, activeChatId }: { onNavigate: Destination; onClose?: () => void; activeChatId?: number }) {
  const session = useSession();
  const { pendingChats } = usePendingChats();
  const insets = useSafeAreaInsets();
  const { reloadProjects, previewProject } = session;
  const currentPath = session.snapshot?.project.path;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([currentPath || session.recent[0]?.path].filter(Boolean) as string[]));
  const [copies, setCopies] = useState<Record<string, Snapshot>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('all');
  // Settings open inside the navigation, so reaching them never passes through the screen behind it.
  const [page, setPage] = useState<'settings' | SettingsPage | 'add' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  const pending = useRef(new Map<string, Promise<void>>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { void reloadProjects().catch(e => setError(e.message)); }, [reloadProjects]);
  const load = useCallback((projectPath: string) => {
    const existing = pending.current.get(projectPath);
    if (existing) return existing;
    const work = previewProject(projectPath).then(copy => {
      if (!alive.current) return;
      setCopies(previous => ({ ...previous, [projectPath]: copy }));
      setFailures(previous => { const next = { ...previous }; delete next[projectPath]; return next; });
    }).catch(e => { if (alive.current) setFailures(previous => ({ ...previous, [projectPath]: e.message })); })
      .finally(() => { pending.current.delete(projectPath); });
    pending.current.set(projectPath, work);
    return work;
  }, [previewProject]);
  // Searching or filtering reads every Project; ordinary browsing only reads expanded groups.
  const searching = !!query.trim() || show !== 'all';
  useEffect(() => {
    let cancelled = false;
    // Search reads every Project; ordinary browsing only reads expanded groups.
    const paths = session.recent.filter(item => searching || expanded.has(item.path)).map(item => item.path);
    void (async () => { for (const projectPath of paths) { if (cancelled) break; await load(projectPath); } })();
    return () => { cancelled = true; };
  }, [expanded, searching, session.recent, load]);
  const rows = useMemo(() => {
    const result: Row[] = [];
    const needle = query.trim().toLowerCase();
    for (const project of session.recent) {
      const saved = project.path === currentPath && session.snapshot ? session.snapshot : copies[project.path];
      const previews = Object.values(pendingChats).filter(item => item.hostId === session.client?.url && item.projectPath === project.path);
      const projected = saved && previews.reduce((state, item) => withPendingChat(state, item.preview), saved.project.state);
      const copy = saved && projected ? { ...saved, project: { ...saved.project, state: projected } } : saved;
      const pendingById = new Map(previews.map(item => [saved ? pendingChatSessionId(saved.project.state, item.preview) ?? item.preview.session.id : item.preview.session.id, item]));
      const name = project.name || project.path.split('/').at(-1) || 'Project';
      const open = searching || expanded.has(project.path);
      // Keep message lookup linear even in large Projects.
      const byChat = new Map<number, NonNullable<typeof copy>['project']['state']['messages']>();
      for (const message of copy?.project.state.messages || []) {
        const list = byChat.get(message.session_id) || [];
        list.push(message); byChat.set(message.session_id, list);
      }
      const marked = Object.values(copy?.project.state.sessions || {}).map(chat => {
        const run = copy?.runs.runs[`${copy.project.path}#${chat.id}`];
        const pending = pendingById.get(chat.id);
        return { chat, run, pending, mark: pending && !pending.accepted ? 'running' as const : chatMark(chat, run, byChat.get(chat.id) || []) };
      });
      // Like desktop's sidebar, a worktree's empty starter Chat stays out until it has a message or a turn is starting.
      const chats = marked.filter(({ chat, run }) => (show === 'archived') === !!chat.archived && (run || isListedChat(chat, byChat.get(chat.id)?.length || 0)))
        .filter(({ mark }) => show !== 'needs' || NEEDS.includes(mark))
        .filter(({ mark }) => show !== 'running' || mark === 'running')
        .filter(({ chat }) => !needle || [name, chat.title, chat.generatedTitle, copy?.project.state.worktrees[chat.worktree_id]?.name].some(text => text?.toLowerCase().includes(needle)))
        // Newest Chat first, by when it was created, so rows don't jump around as agents reply.
        .sort((a, b) => (b.pending?.preview.sortId ?? b.chat.id) - (a.pending?.preview.sortId ?? a.chat.id));
      if (searching && copy && !chats.length && !(needle && name.toLowerCase().includes(needle)) && !failures[project.path]) continue;
      result.push({ key: project.path, path: project.path, kind: 'project', name, expanded: open });
      if (!open) continue;
      for (const { chat, mark, pending } of chats) result.push({ key: `${project.path}#${chat.id}`, path: project.path, kind: 'chat', chat, pending, worktree: pending?.newWorktree ? 'New worktree' : copy?.project.state.worktrees[chat.worktree_id]?.name || 'Worktree', mark });
      if (failures[project.path]) result.push({ key: `${project.path}:error`, path: project.path, kind: 'notice', message: 'Could not load chats. Tap to retry.', failed: true });
      else if (!copy || !chats.length) result.push({ key: `${project.path}:notice`, path: project.path, kind: 'notice', message: !copy ? 'Loading chats...' : searching ? 'No matching chats' : 'No chats yet. Start one with +.' });
    }
    return result;
  }, [copies, currentPath, expanded, failures, query, searching, show, session.recent, session.snapshot, session.client?.url, pendingChats]);

  // Choosing a Chat or a new Chat goes there at once; the Chat loads the Project behind the splash mark, so nothing
  // waits here.
  function select(projectPath: string, chatId?: number, pending?: MobilePendingChat) {
    if (busy || !session.client) return;
    const params = { projectPath, hostId: session.client.url };
    if (chatId === undefined) onNavigate({ pathname: '/chat', params });
    else if (projectPath === currentPath && chatId === activeChatId && onClose) onClose();
    else if (pending?.accepted && pending.preview.targetSessionId !== null) onNavigate({ pathname: '/chat', params: { ...params, id: String(pending.preview.targetSessionId) } });
    else if (pending) onNavigate({ pathname: '/chat', params: { ...params, ...(pending.originSessionId !== null ? { id: String(pending.originSessionId) } : { worktreeId: String(pending.worktreeId) }) } });
    else onNavigate({ pathname: '/chat', params: { ...params, id: String(chatId) } });
  }
  // A Chat's ⋯ choice runs against its own Project's copy, which is reread afterwards. Archiving the Chat showing
  // behind the navigation leaves it for the project list.
  async function act(projectPath: string, chat: AgentSession, action: string) {
    const copy = projectPath === currentPath && session.snapshot ? session.snapshot : copies[projectPath];
    if (!copy || !session.client) return;
    setError('');
    try {
      const result = await runChatAction({ action, chat, running: !!copy.runs.runs[`${copy.project.path}#${chat.id}`], client: session.client, projectPath: copy.project.path, state: copy.project.state,
        refresh: () => projectPath === currentPath ? session.refresh() : load(projectPath), expectActivity: session.expectActivity, notify: message => { if (alive.current) setError(message); } });
      if ((result === 'hidden' || result === 'removed') && projectPath === currentPath && chat.id === activeChatId) onNavigate('/projects');
    } catch (e) { if (alive.current) setError((e as Error).message); }
  }
  // Removing a Project takes it off the recent list, as desktop does; its folder and Chats stay on the Mac.
  async function projectAction(projectPath: string, name: string, action: string) {
    if (action === 'new') { select(projectPath); return; }
    if (action === 'copy') { await Clipboard.setStringAsync(projectPath); return; }
    if (action !== 'remove' || !session.client) return;
    const client = session.client;
    const confirmed = await confirm(`Remove ${name}?`, 'It leaves this list on your phone and your Mac. The folder and its Chats stay on your computer; add it again to bring it back.', 'Remove');
    if (!confirmed) return;
    setError('');
    try { await client.call('project:forget', [projectPath]); await reloadProjects(); }
    catch (e) {
      const message = (e as Error).message;
      if (alive.current) setError(/not available from mobile/i.test(message) ? 'Update Milagre on your Mac to remove Projects from your phone.' : message);
    }
  }
  // A typed path opens like any Project: the Chat loads it behind the splash mark and shows a wrong path with Retry.
  function addProject(projectPath: string) {
    if (busy || !session.client) return;
    setPage(null);
    onNavigate({ pathname: '/chat', params: { projectPath, hostId: session.client.url } });
  }
  async function switchComputer(id: string) {
    if (busy) return;
    if (id === 'add') { onNavigate('/add-computer', true); return; }
    if (id === 'manage') { session.cancelNavigation(); onNavigate('/'); return; }
    const host = session.hosts.find(item => item.id === id);
    if (!host || host.address === session.client?.url) return;
    setBusy(true); setError('');
    try { if (await session.connect(host) && alive.current) onNavigate('/projects'); }
    catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  const footer = <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
    <Pressable accessibilityRole="button" accessibilityLabel="Add project" disabled={busy} onPress={() => setPage('add')} style={({ pressed }) => [s.footerAction, { opacity: pressed ? 0.55 : 1 }]}><Icon icon={FolderAddIcon} tone="ink2" size={18} /><Text style={s.secondary}>Add project</Text></Pressable>
    <IconButton label="Settings" icon={Settings01Icon} size={44} onPress={() => setPage('settings')} />
  </View>;
  if (page) return <View style={styles.screen}>
    <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 8, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <IconButton label={page === 'settings' || page === 'add' ? 'Back to Projects' : 'Back to Settings'} icon={ArrowLeft01Icon} size={44} onPress={() => setPage(page === 'settings' || page === 'add' ? null : 'settings')} />
      <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, color: colors.ink, fontSize: 17, fontWeight: '600' }}>{page === 'add' ? 'Add project' : page === 'settings' ? 'Settings' : page === 'notifications' ? 'Notifications' : 'Plan usage'}</Text>
      {onClose && <IconButton label="Close navigation" icon={Cancel01Icon} size={44} onPress={onClose} />}
    </View>
    {page === 'add' ? <ProjectSearch onOpen={addProject} /> : page === 'settings' ? <PageScroll><SettingsView onOpen={setPage} /></PageScroll> : page === 'notifications' ? <NotificationsView /> : <PageScroll><UsageSection /></PageScroll>}
  </View>;
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, gap: 16, paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <PullDown label="Switch computer" title="Computers" style={{ flex: 1 }} sections={[
          { items: session.hosts.map(host => ({ id: host.id, title: host.name, checked: host.address === session.client?.url, systemImage: 'laptopcomputer', disabled: busy })) },
          { items: [{ id: 'add', title: 'Add computer', systemImage: 'plus', disabled: busy }, { id: 'manage', title: 'Manage computers', systemImage: 'desktopcomputer', disabled: busy }] },
        ]} onSelect={id => void switchComputer(id)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
            <View style={s.computerIcon}><Icon icon={LaptopIcon} tone="ink" size={21} /></View>
            <View style={{ flex: 1, gap: 3 }}><Text numberOfLines={1} style={s.host}>{session.hostName || 'Computer'}</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: session.error ? colors.orange : colors.green }} /><Text style={s.detail}>{session.error ? 'Connection interrupted' : 'Connected'}</Text></View></View>
            <Icon icon={UnfoldMoreIcon} tone="ink3" size={15} />
          </View>
        </PullDown>
        {onClose && <IconButton label="Close navigation" icon={Cancel01Icon} size={44} onPress={onClose} />}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={[s.search, { flex: 1 }]}><Icon icon={Search01Icon} tone="ink3" size={18} /><View style={{ flex: 1 }}><Field label="Search chats" hideLabel placeholder="Search chats" value={query} onChangeText={setQuery} clearButtonMode="while-editing" style={{ backgroundColor: 'transparent', paddingHorizontal: 0, paddingVertical: 8 }} /></View></View>
        <PullDown label="Filter Chats" nativeTrigger={{ systemImage: show === 'all' ? 'line.3.horizontal.decrease.circle' : 'line.3.horizontal.decrease.circle.fill' }} sections={[{ title: 'Show', items: SHOW.map(([id, title, systemImage]) => ({ id, title, systemImage, checked: show === id })) }]} onSelect={id => setShow(id as Show)}>
          <View style={[s.filter, show !== 'all' && { backgroundColor: colors.field }]}><Icon icon={FilterHorizontalIcon} tone={show === 'all' ? 'ink2' : 'ink'} size={19} /></View>
        </PullDown>
      </View>
      {busy && <View accessible accessibilityRole="progressbar" accessibilityLabel="Opening..." accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><LoadingLogo size={22} /><Text style={s.secondary}>Opening...</Text></View>}
      {error ? <ErrorNotice message={error} /> : null}
    </View>
    <FlatList data={rows} keyExtractor={row => row.key} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void reloadProjects().then(() => Promise.all([...expanded].map(load))).catch(e => setError(e.message)).finally(() => setRefreshing(false)); }} />}
      ListEmptyComponent={<Text style={[styles.muted, { padding: 20 }]}>{query.trim() ? 'No chats match your search.' : show !== 'all' ? 'No chats match this filter.' : 'Add a project from your computer to start a Chat.'}</Text>}
      renderItem={({ item }) => {
        if (item.kind === 'project') {
          const menu = [{ items: [{ id: 'new', title: 'New Chat', systemImage: 'square.and.pencil' }, { id: 'copy', title: 'Copy path', systemImage: 'doc.on.doc' }] }, { items: [{ id: 'remove', title: 'Remove from list', systemImage: 'minus.circle', destructive: true }] }];
          const choose = (action: string) => void projectAction(item.path, item.name, action);
          // A tap folds the group; a long press opens the Project's menu.
          return <View style={s.project}>
            <PullDown label={`${item.expanded ? 'Collapse' : 'Expand'} ${item.name}`} title={item.name} sections={menu} onSelect={choose} onPress={() => setExpanded(previous => { const next = new Set(previous); if (next.has(item.path)) next.delete(item.path); else next.add(item.path); return next; })} style={{ flex: 1 }}>
              <View style={s.projectTitle}><ProjectIcon client={session.client} path={item.path} /><Text numberOfLines={1} style={[s.secondary, { flex: 1, fontWeight: '500', color: colors.ink }]}>{item.name}</Text><Icon icon={item.expanded ? ArrowDown01Icon : ArrowRight01Icon} tone="ink3" size={13} /></View>
            </PullDown>
            <IconButton label={`New Chat in ${item.name}`} icon={Add01Icon} size={44} disabled={busy} onPress={() => select(item.path)} />
            <PullDown label={`Actions for ${item.name}`} title={item.name} sections={menu} onSelect={choose}>
              <View style={{ width: 36, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon icon={MoreHorizontalIcon} tone="ink3" size={18} /></View>
            </PullDown>
          </View>;
        }
        if (item.kind === 'notice') return <Pressable accessibilityRole={item.failed ? 'button' : 'text'} disabled={!item.failed} onPress={() => void load(item.path)} style={s.notice}><Text style={[s.detail, item.failed && { color: colors.red }]}>{item.message}</Text></Pressable>;
        const title = item.chat.title || item.chat.generatedTitle || 'New Chat';
        const selected = currentPath === item.path && activeChatId === item.chat.id;
        const copy = item.path === currentPath && session.snapshot ? session.snapshot : copies[item.path];
        const menu = chatMenu(item.chat, copy?.project.state.worktrees[item.chat.worktree_id]);
        // A tap opens the Chat and a long press opens its ⋯ menu, as on desktop's sidebar.
        return <View style={[s.chat, { backgroundColor: selected ? colors.hover : 'transparent' }]}>
          <PullDown label={`${title}, ${item.worktree}${labels[item.mark] ? `, ${labels[item.mark]}` : ''}`} title={title} sections={item.pending ? [] : menu} onSelect={action => { if (!item.pending) void act(item.path, item.chat, action); }} onPress={() => select(item.path, item.chat.id, item.pending)} style={{ flex: 1 }}>
            <View style={s.chatBody}>
              <ChatMarkIcon mark={item.mark} />
              <View style={{ flex: 1, gap: 5 }}><Text numberOfLines={2} style={[s.chatTitle, item.mark === 'unread' && { fontWeight: '600' }]}>{title}</Text><View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}><Icon icon={GitBranchIcon} tone="ink3" size={12} /><Text numberOfLines={1} style={[s.detail, { flexShrink: 1 }]}>{item.worktree}</Text>{!!labels[item.mark] && <Text style={[s.detail, { color: item.mark === 'failed' ? colors.red : item.mark === 'question' || item.mark === 'waiting' ? colors.orange : colors.ink2 }]}>{labels[item.mark]}</Text>}</View></View>
            </View>
          </PullDown>
          {!item.pending && <PullDown label={`Actions for ${title}`} title={title} sections={menu} onSelect={action => void act(item.path, item.chat, action)}>
            <View style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon icon={MoreHorizontalIcon} tone="ink3" size={18} /></View>
          </PullDown>}
        </View>;
      }} />
    {footer}
  </KeyboardAvoidingView>;
}

const s = StyleSheet.create({
  host: { color: colors.ink, fontSize: 17, fontWeight: '600' },
  secondary: { color: colors.ink2, fontSize: 15 },
  detail: { color: colors.ink2, fontSize: 12 },
  computerIcon: { width: 38, height: 38, borderRadius: 10, borderCurve: 'continuous', backgroundColor: colors.field, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 10, borderCurve: 'continuous', backgroundColor: colors.field },
  project: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  projectTitle: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8 },
  chat: { flexDirection: 'row', alignItems: 'center', marginVertical: 2, borderRadius: 8, borderCurve: 'continuous' },
  chatBody: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, paddingLeft: 12, paddingVertical: 12 },
  filter: { width: 44, height: 44, borderRadius: 10, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  chatTitle: { color: colors.ink, fontSize: 15, lineHeight: 20 },
  notice: { minHeight: 44, justifyContent: 'center', paddingLeft: 42, paddingRight: 12 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  footerAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
});
