import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { Href } from 'expo-router';
import { Add01Icon, ArrowDown01Icon, ArrowRight01Icon, Cancel01Icon, Folder01Icon, FolderAddIcon, GitBranchIcon, LaptopIcon, Search01Icon, Settings01Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isListedChat } from '@milagre/shared/chats';
import type { AgentSession } from '@milagre/shared/model';
import type { Snapshot } from './client';
import { useSession } from './session';
import { chatMark, type ChatMark } from './indicators';
import { ChatMarkIcon } from './status-indicators';
import { Icon } from './icons';
import { LoadingLogo } from './loading-logo';
import { ErrorNotice, Field, IconButton, PillButton, PullDown, colors, styles } from './ui';

type Destination = (href: Href, secondary?: boolean) => void;
type Row = { key: string; path: string } & (
  | { kind: 'project'; name: string; expanded: boolean }
  | { kind: 'chat'; chat: AgentSession; worktree: string; mark: ChatMark }
  | { kind: 'notice'; message: string; failed?: boolean }
  | { kind: 'all' }
);
const labels: Record<ChatMark, string> = { idle: '', running: 'Running', question: 'Needs reply', waiting: 'Needs approval', interrupted: 'Interrupted', failed: 'Failed', unread: 'Unread' };

/** The same project tree is the first-run destination and the drawer over a Chat. */
export function ProjectNavigation({ onNavigate, onClose, activeChatId, visible = true }: { onNavigate: Destination; onClose?: () => void; activeChatId?: number; visible?: boolean }) {
  const session = useSession();
  const insets = useSafeAreaInsets();
  const { reloadProjects, previewProject } = session;
  const currentPath = session.snapshot?.project.path;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([currentPath || session.recent[0]?.path].filter(Boolean) as string[]));
  const [copies, setCopies] = useState<Record<string, Snapshot>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  const pending = useRef(new Map<string, Promise<void>>());
  const selecting = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // A Project still opening must not take over once the navigation is put away.
  const { cancelNavigation } = session;
  useEffect(() => { if (!visible && selecting.current) cancelNavigation(); }, [visible, cancelNavigation]);
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
  const searching = !!query.trim();
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
      const copy = project.path === currentPath && session.snapshot ? session.snapshot : copies[project.path];
      const name = project.name || project.path.split('/').at(-1) || 'Project';
      const open = searching || expanded.has(project.path);
      // Keep message lookup linear even in large Projects.
      const byChat = new Map<number, NonNullable<typeof copy>['project']['state']['messages']>();
      for (const message of copy?.project.state.messages || []) {
        const list = byChat.get(message.session_id) || [];
        list.push(message); byChat.set(message.session_id, list);
      }
      const chats = Object.values(copy?.project.state.sessions || {}).filter(chat => !chat.archived && (copy?.runs.runs[`${copy.project.path}#${chat.id}`] || isListedChat(chat, byChat.get(chat.id)?.length || 0)))
        .filter(chat => !needle || [name, chat.title, chat.generatedTitle, copy?.project.state.worktrees[chat.worktree_id]?.name].some(text => text?.toLowerCase().includes(needle)))
        .sort((a, b) => b.id - a.id);
      if (needle && copy && !chats.length && !name.toLowerCase().includes(needle) && !failures[project.path]) continue;
      result.push({ key: project.path, path: project.path, kind: 'project', name, expanded: open });
      if (!open) continue;
      for (const chat of chats) result.push({ key: `${project.path}#${chat.id}`, path: project.path, kind: 'chat', chat, worktree: copy?.project.state.worktrees[chat.worktree_id]?.name || 'Worktree', mark: chatMark(chat, copy?.runs.runs[`${copy.project.path}#${chat.id}`], byChat.get(chat.id) || []) });
      if (failures[project.path]) result.push({ key: `${project.path}:error`, path: project.path, kind: 'notice', message: 'Could not load chats. Tap to retry.', failed: true });
      else if (!copy || !chats.length) result.push({ key: `${project.path}:notice`, path: project.path, kind: 'notice', message: !copy ? 'Loading chats...' : needle ? 'No matching chats' : 'No chats yet. Start one with +.' });
      if (copy && !searching) result.push({ key: `${project.path}:all`, path: project.path, kind: 'all' });
    }
    return result;
  }, [copies, currentPath, expanded, failures, query, searching, session.recent, session.snapshot]);

  async function select(projectPath: string, chatId?: number, all = false) {
    if (selecting.current) return;
    // A Chat opens at once; the Chat screen loads its Project behind the splash mark.
    if (chatId !== undefined && session.client) {
      if (projectPath === currentPath && chatId === activeChatId && onClose) onClose();
      else onNavigate({ pathname: '/chat', params: { projectPath, hostId: session.client.url, id: String(chatId) } });
      return;
    }
    selecting.current = true; setBusy(true); setError('');
    try {
      const copy = await session.open(projectPath, { background: true, chatId });
      if (!copy || !alive.current) return;
      if (all) { onNavigate('/project'); return; }
      const params = { projectPath: copy.project.path, hostId: session.client!.url };
      if (chatId !== undefined) {
        if (!copy.project.state.sessions[chatId]) throw new Error('This Chat is no longer available. Choose another Chat.');
        onNavigate({ pathname: '/chat', params: { ...params, id: String(chatId) } });
      } else {
        const worktrees = Object.values(copy.project.state.worktrees);
        const worktree = worktrees.find(item => item.path === copy.project.path) || worktrees[0];
        if (!worktree) { onNavigate('/project'); return; }
        onNavigate({ pathname: '/chat', params: { ...params, worktreeId: String(worktree.id) } });
      }
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { selecting.current = false; if (alive.current) setBusy(false); }
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
    <Pressable accessibilityRole="button" accessibilityLabel="Add project" disabled={busy} onPress={() => setAdding(value => !value)} style={({ pressed }) => [s.footerAction, { opacity: pressed ? 0.55 : 1 }]}><Icon icon={FolderAddIcon} tone="ink2" size={18} /><Text style={s.secondary}>Add project</Text></Pressable>
    <IconButton label="Settings" icon={Settings01Icon} size={44} onPress={() => onNavigate('/settings', true)} />
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
      <View style={s.search}><Icon icon={Search01Icon} tone="ink3" size={18} /><View style={{ flex: 1 }}><Field label="Search chats" hideLabel placeholder="Search chats" value={query} onChangeText={setQuery} clearButtonMode="while-editing" style={{ backgroundColor: 'transparent', paddingHorizontal: 0, paddingVertical: 8 }} /></View></View>
      {busy && <View accessible accessibilityRole="progressbar" accessibilityLabel="Opening..." accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><LoadingLogo size={22} /><Text style={s.secondary}>Opening...</Text></View>}
      {error ? <ErrorNotice message={error} /> : null}
    </View>
    <FlatList data={rows} keyExtractor={row => row.key} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void reloadProjects().then(() => Promise.all([...expanded].map(load))).catch(e => setError(e.message)).finally(() => setRefreshing(false)); }} />}
      ListEmptyComponent={<Text style={[styles.muted, { padding: 20 }]}>{searching ? 'No chats match your search.' : 'Add a project from your computer to start a Chat.'}</Text>}
      renderItem={({ item }) => {
        if (item.kind === 'project') return <View style={s.project}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.expanded ? 'Collapse' : 'Expand'} ${item.name}`} accessibilityState={{ expanded: item.expanded }} onPress={() => setExpanded(previous => { const next = new Set(previous); if (next.has(item.path)) next.delete(item.path); else next.add(item.path); return next; })} style={({ pressed }) => [s.projectTitle, { opacity: pressed ? 0.55 : 1 }]}>
            <View style={s.projectIcon}><Icon icon={Folder01Icon} tone="ink2" size={16} /></View><Text numberOfLines={1} style={[s.secondary, { flex: 1, fontWeight: '500', color: colors.ink }]}>{item.name}</Text><Icon icon={item.expanded ? ArrowDown01Icon : ArrowRight01Icon} tone="ink3" size={13} />
          </Pressable>
          <IconButton label={`New Chat in ${item.name}`} icon={Add01Icon} size={44} disabled={busy} onPress={() => void select(item.path)} />
        </View>;
        if (item.kind === 'notice') return <Pressable accessibilityRole={item.failed ? 'button' : 'text'} disabled={!item.failed} onPress={() => void load(item.path)} style={s.notice}><Text style={[s.detail, item.failed && { color: colors.red }]}>{item.message}</Text></Pressable>;
        if (item.kind === 'all') return <Pressable accessibilityRole="button" disabled={busy} onPress={() => void select(item.path, undefined, true)} style={s.notice}><Text style={s.detail}>All chats and filters</Text></Pressable>;
        const title = item.chat.title || item.chat.generatedTitle || 'New Chat';
        const selected = currentPath === item.path && activeChatId === item.chat.id;
        return <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${item.worktree}${labels[item.mark] ? `, ${labels[item.mark]}` : ''}`} accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={() => void select(item.path, item.chat.id)} style={({ pressed }) => [s.chat, { backgroundColor: selected || pressed ? colors.hover : 'transparent' }]}>
          <ChatMarkIcon mark={item.mark} />
          <View style={{ flex: 1, gap: 5 }}><Text numberOfLines={2} style={[s.chatTitle, item.mark === 'unread' && { fontWeight: '600' }]}>{title}</Text><View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}><Icon icon={GitBranchIcon} tone="ink3" size={12} /><Text numberOfLines={1} style={[s.detail, { flexShrink: 1 }]}>{item.worktree}</Text>{!!labels[item.mark] && <Text style={[s.detail, { color: item.mark === 'failed' ? colors.red : item.mark === 'question' || item.mark === 'waiting' ? colors.orange : colors.ink2 }]}>{labels[item.mark]}</Text>}</View></View>
        </Pressable>;
      }} />
    {adding && <View style={{ padding: 16, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line }}><Field label="Project path on your computer" value={path} onChangeText={setPath} placeholder="/Users/you/Code/project" autoFocus onSubmitEditing={() => { if (path.trim().startsWith('/')) void select(path.trim()); }} /><PillButton title="Open project" disabled={busy || !path.trim().startsWith('/')} onPress={() => void select(path.trim())} /></View>}
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
  projectIcon: { width: 28, height: 28, borderRadius: 7, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.field },
  chat: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, paddingHorizontal: 12, paddingVertical: 12, marginVertical: 2, borderRadius: 8, borderCurve: 'continuous' },
  chatTitle: { color: colors.ink, fontSize: 15, lineHeight: 20 },
  notice: { minHeight: 44, justifyContent: 'center', paddingLeft: 42, paddingRight: 12 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  footerAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
});
