import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Reanimated from 'react-native-reanimated';
import { Alert, Image, Keyboard, Linking, Text, View } from 'react-native';
import { Redirect, Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Add01Icon, ArrowUp02Icon, Cancel01Icon, File01Icon, GitBranchIcon, GitForkIcon, LaptopIcon, StopIcon, UnfoldMoreIcon } from '@hugeicons/core-free-icons';
import { sessionForWorktree } from '@milagre/shared/model';
import type { Client, OpenProject } from '../client';
import { lastUserModel } from '@milagre/shared/agent-runs';
import { blockerPrompt, pullRequestBlockers } from '@milagre/shared/pr-blockers';
import { useComposer, useSession } from '../session';
import { pickAttachments } from '../attachment-picker';
import { appendAttachments, attachmentPrompt, prepareAttachments } from '../attachments';
import { PullRequestAction, SubagentChip, usePullRequest } from '../status-indicators';
import { KeyboardChatScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { ChatReply } from '../chat-reply';
import { ThinkingIndicator } from '../running-logo';
import { BottomFade } from '../bottom-fade';
import { useDotBackground } from '../dot-background';
import { Approval, Questions } from '../questions';
import { AgentControls, PermissionChip } from '../agent-controls';
import { selectedModel, sendOptions } from '../turn-options';
import { Icon } from '../icons';
import { PanelSwipe, useSidePanels } from '../side-panels';
import { LoadingLogo } from '../loading-logo';
import { useOpenProject } from '../use-open-project';
import { ErrorNotice, Field, IconButton, PageScroll, PillButton, PullDown, colors, styles } from '../ui';
import { archiveFromPhone } from '../archive';
import { confirmSheet } from '../confirm-store';

const PAGE = 40;

export default function ChatScreen() {
  const params = useLocalSearchParams<{ id?: string; worktreeId?: string; projectPath?: string; hostId?: string }>();
  const session = useSession();
  const composer = useComposer();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [dockHeight, setDockHeight] = useState(140);
  const [error, setError] = useState('');
  const [isolation, setIsolation] = useState<'local' | 'worktree'>('local');
  const [baseBranch, setBaseBranch] = useState('');
  const [branchList, setBranchList] = useState<{ client: Client; path: string; items: string[]; error?: string } | null>(null);
  // A failed send can retry in the checkout already created for this draft.
  const preparedTarget = useRef<{ client: Client; path: string; base: string; worktreeId: number; sessionId: number } | null>(null);
  const scroll = useRef<Reanimated.ScrollView>(null);
  const dots = useDotBackground();
  const following = useRef(true);
  // Short transcripts never auto-scroll: a scroll to the end while the keyboard is up would stay offset after it hides.
  const viewport = useRef(0);
  const worktreeOf = session.snapshot?.project.state.worktrees[(params.id ? session.snapshot.project.state.sessions[Number(params.id)]?.worktree_id : Number(params.worktreeId)) ?? -1];
  const pr = usePullRequest(worktreeOf);
  // Stable props keep each memoized ChatReply from re-rendering on every keystroke and poll tick.
  const connected = session.client;
  const projectPath = session.snapshot?.project.path;
  const focused = useRef<object | null>(null);
  useFocusEffect(useCallback(() => { focused.current = { client: connected, projectPath, id: params.id, worktreeId: params.worktreeId }; return () => { focused.current = null; }; }, [connected, projectPath, params.id, params.worktreeId]));
  useEffect(() => {
    let cancelled = false;
    if (connected && projectPath && !params.id) void connected.call<string[]>('project:branches', [projectPath]).then(items => {
      if (!cancelled) setBranchList({ client: connected, path: projectPath, items });
    }).catch(error => {
      if (!cancelled) setBranchList({ client: connected, path: projectPath, items: [], error: (error as Error).message });
    });
    return () => { cancelled = true; };
  }, [connected, projectPath, params.id]);
  const allMessages = session.snapshot?.project.state.messages;
  const media = useCallback((path: string) => connected!.image(projectPath!, path), [connected, projectPath]);
  const messages = useMemo(() => params.id && allMessages ? allMessages.filter(m => m.session_id === Number(params.id)) : [], [allMessages, params.id]);
  // Long Chats mount their newest messages first; earlier ones load on request.
  const [shown, setShown] = useState({ id: params.id, count: PAGE });
  const visible = shown.id === params.id ? shown.count : PAGE;
  const openActivity = useCallback((message: string) => router.push({ pathname: '/activity', params: { id: String(params.id), message } }), [params.id]);
  const { rememberChat } = session;
  const targetMatches = (!params.projectPath || params.projectPath === projectPath) && (!params.hostId || params.hostId === connected?.url);
  const canRemember = !!params.id && !!session.snapshot?.project.state.sessions[Number(params.id)] && targetMatches;
  useFocusEffect(useCallback(() => {
    if (canRemember) rememberChat(Number(params.id));
  }, [canRemember, params.id, rememberChat]));
  const panels = useSidePanels({ chatId: params.id ? Number(params.id) : undefined, worktreeId: targetMatches && worktreeOf ? worktreeOf.id : undefined });
  // A Chat picked in another Project opens that Project here, behind the splash mark, rather than in the navigation.
  const { wanted, error: openError, retry: retryOpen } = useOpenProject(params);
  // A new Chat picked without a Worktree starts in the Project's own checkout once the Project is here.
  const loaded = targetMatches && !!session.snapshot;
  const needsWorktree = !params.id && !params.worktreeId;
  const candidates = loaded && needsWorktree ? Object.values(session.snapshot!.project.state.worktrees) : [];
  const starterId = (candidates.find(item => item.path === projectPath) || candidates[0])?.id;
  useEffect(() => {
    if (!needsWorktree || !loaded) return;
    if (starterId === undefined) router.replace('/projects'); else router.setParams({ worktreeId: String(starterId) });
  }, [needsWorktree, loaded, starterId]);
  const sidebar = <Stack.Toolbar placement="left"><Stack.Toolbar.Button icon="sidebar.left" accessibilityLabel="Open navigation" onPress={() => panels.show('left')} /></Stack.Toolbar>;
  if (!session.client || (!session.snapshot && !wanted)) return <Redirect href="/" />;
  if (!session.snapshot || !targetMatches || needsWorktree) {
    return <View style={styles.screen}>
      <Stack.Screen options={{ title: '', headerBackVisible: false, gestureEnabled: false }} />
      {sidebar}
      <PanelSwipe panels={panels}><View accessible={!openError} accessibilityRole="progressbar" accessibilityLabel="Opening Chat…" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        {openError ? <ErrorNotice message={openError} retry={retryOpen} retryTitle="Try again" /> : wanted || needsWorktree ? <LoadingLogo /> : null}
      </View></PanelSwipe>
    </View>;
  }
  const client = session.client;
  const { project, runs } = session.snapshot;
  const chat = params.id ? project.state.sessions[Number(params.id)] : null;
  const chatId = `${project.path}#${params.id ?? `new:${params.worktreeId}`}`;
  const draft = composer.drafts[chatId] || '';
  const attachments = composer.attachments[chatId] || [];
  const attachmentDisabled = busy || picking || attachments.length >= 4;
  const run = chat ? runs.runs[chatId] : undefined;
  const preferences = composer.preferences[chatId] || composer.defaults;
  const actualProvider = chat?.provider || preferences.provider;
  const model = selectedModel(actualProvider, preferences.model || (chat ? lastUserModel(project.state, chat.id) : ''), session.models);
  const worktreeId = chat?.worktree_id ?? Number(params.worktreeId);
  const worktree = project.state.worktrees[worktreeId];
  const branches = branchList?.client === client && branchList.path === project.path ? branchList : null;
  const base = baseBranch && branches?.items.includes(baseBranch) ? baseBranch
    : worktree?.name && branches?.items.includes(worktree.name) ? worktree.name : branches?.items[0] || '';
  const newWorktree = !params.id && isolation === 'worktree';
  const targetDisabled = busy || picking;
  const branchDisabled = targetDisabled || (newWorktree && !branches?.items.length);
  const branchName = newWorktree ? base || 'Choose branch' : worktree?.name || 'Choose branch';
  const unavailable = session.cliStatus?.[actualProvider]?.state !== undefined && session.cliStatus[actualProvider].state !== 'ready';
  const title = chat?.title || chat?.generatedTitle || 'New Chat';
  async function action(work: () => Promise<unknown>) {
    if (busy) return false;
    setBusy(true); setError('');
    try { await work(); session.expectActivity(); await session.refresh(); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  async function pick(kind: 'photos' | 'camera' | 'files') {
    if (attachmentDisabled) return;
    setPicking(true); setError('');
    try {
      const added = await pickAttachments(kind);
      const next = appendAttachments(attachments, added);
      composer.setAttachments(current => ({ ...current, [chatId]: next }));
    } catch (e) { setError((e as Error).message); }
    finally { setPicking(false); }
  }
  async function send(body = draft, withAttachments = true) {
    const sent = body;
    const sending = withAttachments ? attachments : [];
    const focus = focused.current;
    const current = () => focus !== null && focused.current === focus && session.isSelected();
    await action(async () => {
      const media = await prepareAttachments(client, project.path, sending);
      let target = { sessionId: params.id ? Number(params.id) : null as number | null, worktreeId };
      if (newWorktree) {
        if (!base) throw new Error(branches?.error || 'Choose a base branch before sending.');
        let ready = preparedTarget.current;
        if (!ready || ready.client !== client || ready.path !== project.path || ready.base !== base) {
          const created = await client.call<{ project: OpenProject; worktreeId: number }>('worktree:create', [{ projectPath: project.path, baseBranch: base, prompt: sent }]);
          const chat = sessionForWorktree(created.project.state, created.worktreeId);
          if (!chat) throw new Error('No Chat was created for the new worktree.');
          ready = { client, path: project.path, base, worktreeId: created.worktreeId, sessionId: chat.id };
          preparedTarget.current = ready;
        }
        if (!current()) return;
        target = { sessionId: ready.sessionId, worktreeId: ready.worktreeId };
      }
      const result = await client.call<{ sessionId: number }>('chat:send', [{ projectPath: project.path, ...target, body: sent, ...media, prompt: attachmentPrompt(sent, media.files), ...sendOptions(model, preferences) }]);
      if (newWorktree && !current()) return;
      const destination = `${project.path}#${result.sessionId}`;
      if (sent === draft) composer.setDrafts(current => {
        const remaining = current[chatId] === sent ? '' : current[chatId] || '';
        const preserved = destination !== chatId ? current[destination] || '' : '';
        const next = { ...current, [destination]: [preserved, remaining].filter(Boolean).join('\n') };
        if (destination !== chatId) delete next[chatId];
        return next;
      });
      composer.setAttachments(current => {
        const sentIds = new Set(sending.map(item => item.id));
        const remaining = (current[chatId] || []).filter(item => !sentIds.has(item.id));
        const preserved = destination !== chatId ? current[destination] || [] : [];
        const next = { ...current, [destination]: [...preserved, ...remaining] };
        if (destination !== chatId) delete next[chatId];
        return next;
      });
      composer.setPreferences(current => {
        const next = { ...current, [destination]: { ...(current[chatId] || preferences), provider: actualProvider, model: model.id } };
        if (destination !== chatId) delete next[chatId];
        return next;
      });
      following.current = true;
      Keyboard.dismiss();
      if (!params.id) router.setParams({ id: String(result.sessionId) });
    });
  }
  function headerAction(id: string) {
    if (id === 'changes') panels.show('right');
    else if (id === 'pr' && pr && /^https:\/\//.test(pr.url)) void Linking.openURL(pr.url).catch(() => {});
    else if (id === 'agents' && chat) router.push({ pathname: '/agents', params: { id: String(chat.id) } });
    else if (id === 'rename' && chat) Alert.prompt('Rename Chat', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Save', onPress: (value?: string) => { if (value?.trim()) void action(() => client.call('chat:patch', [project.path, chat.id, { title: value.trim() }])); } }], 'plain-text', title);
    else if (id === 'archive' && chat?.archived) void action(() => client.call('chat:patch', [project.path, chat.id, { archived: false }]));
    else if (id === 'archive' && chat) void archive(chat);
  }
  // Archive asks first, as desktop does, with what removing the worktree would lose; a running turn is stopped. The
  // Chat is left once it is archived; one whose worktree stayed is brought back, and the notice shows here.
  async function archive(target: NonNullable<typeof chat>) {
    if (busy) return;
    setError('');
    try {
      const result = await archiveFromPhone({ client, alert: confirmSheet, projectPath: project.path, state: project.state, chat: target, running: !!run,
        onConfirm: () => { setBusy(true); session.expectActivity(); }, notify: setError, refresh: session.refresh });
      if (result === 'hidden' || result === 'removed') router.replace('/projects');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const blockers = pullRequestBlockers(pr);
  const agents = (chat?.subagents || []).filter(agent => !agent.archived);
  const diff = worktree?.diff;
  const header = <>
    <View style={{ alignItems: 'center', maxWidth: 230 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Text numberOfLines={1} style={{ color: colors.ink, fontSize: 16, fontWeight: '600', flexShrink: 1 }}>{title}</Text></View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, opacity: worktree ? 1 : 0 }}><Icon icon={GitBranchIcon} tone="ink3" size={11} /><Text numberOfLines={1} style={{ color: colors.ink2, fontSize: 12, flexShrink: 1 }}>{worktree?.name ?? ''}</Text><Text style={{ fontSize: 12 }}><Text style={{ color: colors.green }}>{diff && (diff.added > 0 || diff.removed > 0) ? `+${diff.added}` : ''}</Text>{diff && (diff.added > 0 || diff.removed > 0) ? ' ' : ''}<Text style={{ color: colors.red }}>{diff && (diff.added > 0 || diff.removed > 0) ? `−${diff.removed}` : ''}</Text></Text></View>
    </View>
  </>;
  const more = <Stack.Toolbar placement="right">
    <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Chat actions">
      <Stack.Toolbar.MenuAction icon="doc.text.magnifyingglass" subtitle={diff ? `+${diff.added} −${diff.removed}` : undefined} onPress={() => headerAction('changes')}>View changes</Stack.Toolbar.MenuAction>
      {pr && <Stack.Toolbar.MenuAction icon="arrow.triangle.pull" subtitle={blockers.length ? blockers.join(', ').replace(/-/g, ' ') : pr.state === 'MERGED' ? 'Merged' : 'Open on GitHub'} onPress={() => headerAction('pr')}>{`Pull request #${pr.number}`}</Stack.Toolbar.MenuAction>}
      {agents.length > 0 && <Stack.Toolbar.MenuAction icon="person.2" subtitle={String(agents.length)} onPress={() => headerAction('agents')}>Subagents</Stack.Toolbar.MenuAction>}
      {chat && <Stack.Toolbar.Menu inline>
        <Stack.Toolbar.MenuAction icon="pencil" onPress={() => headerAction('rename')}>Rename</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon={chat.archived ? 'tray.and.arrow.up' : 'archivebox'} disabled={busy} onPress={() => headerAction('archive')}>{chat.archived ? 'Restore' : 'Archive'}</Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>}
    </Stack.Toolbar.Menu>
  </Stack.Toolbar>;
  const question = run?.questions[0];
  // The composer floats above the transcript and rides the keyboard, stopping 8pt above it.
  const dockPadding = Math.max(insets.bottom, 12);
  const lift = dockPadding - 8;
  return <View style={[styles.screen, dots]}>
    <Stack.Screen options={{ title, headerTitle: () => header, headerBackVisible: false, gestureEnabled: false }} />
    {sidebar}
    {more}
    <PanelSwipe panels={panels}>
    <KeyboardChatScrollView ref={scroll} offset={lift} keyboardLiftBehavior="whenAtEnd" contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={[styles.content, { paddingTop: 12, gap: 16, paddingBottom: dockHeight + 16 }]} scrollEventThrottle={32} onScroll={({ nativeEvent: e }) => { following.current = e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height < 120; }} onLayout={({ nativeEvent }) => { viewport.current = nativeEvent.layout.height; }} onContentSizeChange={(_, height) => { if (following.current && height > viewport.current) scroll.current?.scrollToEnd({ animated: true }); }}>
      {process.env.EXPO_PUBLIC_DEMO === '1' && <Text style={styles.caption}>Demo agent. Send tools, approval, question, or slow to try the controls.</Text>}
      {session.providerError ? <Text style={styles.caption}>{session.providerError}</Text> : null}
      {chat?.archived && <View style={styles.card}><Text style={styles.muted}>This Chat is archived. Restore it to send a message.</Text><PillButton title="Restore Chat" disabled={busy} onPress={() => void action(() => client.call('chat:patch', [project.path, chat.id, { archived: false }]))} style={{ alignSelf: 'flex-start' }} /></View>}
      {!messages.length && !run && <View style={{ paddingVertical: 48, alignItems: 'center', gap: 8 }}><Text style={styles.subtitle}>What are we working on?</Text><Text style={[styles.muted, { textAlign: 'center' }]}>{newWorktree ? `Your agent starts in a new worktree from ${base || 'the selected branch'} on your computer.` : `Your agent runs in ${worktree?.name || 'this Worktree'} on your computer.`}</Text></View>}
      {newWorktree && branches?.error ? <ErrorNotice message={branches.error} /> : null}
      {messages.length > visible && <PillButton title={`Show earlier messages (${messages.length - visible})`} secondary onPress={() => { following.current = false; setShown({ id: params.id, count: visible + PAGE }); }} style={{ alignSelf: 'center' }} />}
      {chat && messages.slice(-visible).map(message => <ChatReply key={message.id} message={message} media={media} basePath={worktree?.path || project.path} onActivity={openActivity} />)}
      {run && <ChatReply run={run} media={media} basePath={worktree?.path || project.path} onActivity={openActivity} />}
      {run && <ThinkingIndicator startedAt={run.startedAt} label={run.waitingForSubagents ? 'Waiting on subagents' : `Working with ${model.name}`} />}
      {chat?.resumeTurn && !run && <PillButton title="Continue interrupted turn" secondary disabled={busy} onPress={() => void action(() => client.call('chat:resume', [project.path, chat.id]))} style={{ alignSelf: 'flex-start' }} />}
      {error ? <ErrorNotice message={error} /> : null}{session.error ? <ErrorNotice message={session.error} retry={() => router.dismissTo('/')} /> : null}
    </KeyboardChatScrollView>
    <KeyboardStickyView offset={{ closed: 0, opened: lift }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
    {/* The transcript blurs and fades under the composer like desktop's. */}
    <BottomFade height={dockHeight + 48} />
    <View onLayout={({ nativeEvent }) => setDockHeight(Math.round(nativeEvent.layout.height))} style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: dockPadding, gap: 8 }}>
      {(blockers.length > 0 || agents.length > 0) && !question && <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
        {pr && blockers.length > 0 && chat && <PullRequestAction pr={pr} disabled={busy || !!run} onRun={() => void send(blockerPrompt(blockers[0], pr), false)} />}
        <View style={{ flex: 1 }} />
        <SubagentChip agents={agents} onPress={() => headerAction('agents')} />
      </View>}
      {run?.approvals.map(approval => <Approval key={approval.requestId} approval={approval} busy={busy} respond={decision => void action(async () => { const accepted = await client.call('agent:respond-permission', [{ chatId, requestId: approval.requestId, decision }]); if (!accepted) throw new Error('This approval is no longer pending. Refresh the Chat.'); })} />)}
      {question ? <Questions key={question.requestId} request={question} busy={busy} submit={(answers, summary) => void action(async () => { const accepted = await client.call('agent:answer-question', [{ chatId, requestId: question.requestId, answers, summary }]); if (!accepted) throw new Error('This question is no longer pending. Refresh the Chat.'); })} />
      : <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 24, borderCurve: 'continuous', paddingTop: 8, paddingHorizontal: 8, paddingBottom: 6, gap: 4, boxShadow: '0 4px 20px #0000000f' }}>
        {!params.id && <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
          <PullDown label="Choose isolation" nativeTrigger={{ title: isolation === 'local' ? 'Local' : 'New worktree', systemImage: isolation === 'local' ? 'laptopcomputer' : 'arrow.triangle.branch', disabled: targetDisabled }} sections={[{ title: 'Isolation', items: [{ id: 'local', title: 'Local', systemImage: 'laptopcomputer', checked: isolation === 'local', disabled: targetDisabled }, { id: 'worktree', title: 'New worktree', systemImage: 'arrow.triangle.branch', checked: isolation === 'worktree', disabled: targetDisabled }] }]} onSelect={id => { if (!targetDisabled) setIsolation(id === 'worktree' ? 'worktree' : 'local'); }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, opacity: targetDisabled ? 0.35 : 1 }}><Icon icon={isolation === 'local' ? LaptopIcon : GitForkIcon} tone="ink2" size={14} /><Text style={styles.label}>{isolation === 'local' ? 'Local' : 'New worktree'}</Text><Icon icon={UnfoldMoreIcon} tone="ink3" size={13} /></View>
          </PullDown>
          <PullDown label="Choose branch" nativeTrigger={{ title: branchName, systemImage: 'arrow.triangle.branch', disabled: branchDisabled, maxWidth: 180 }} sections={[{ title: newWorktree ? 'Branch from' : 'Choose a branch', items: newWorktree ? (branches?.items || []).map(item => ({ id: item, title: item, checked: item === base, systemImage: 'arrow.triangle.branch', disabled: branchDisabled })) : Object.values(project.state.worktrees).map(item => ({ id: String(item.id), title: item.name, checked: item.id === worktreeId, systemImage: 'arrow.triangle.branch', disabled: targetDisabled })) }]} onSelect={id => { if (!branchDisabled) { if (newWorktree) setBaseBranch(id); else router.setParams({ worktreeId: id }); } }}>
            <View style={{ maxWidth: 180, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, opacity: branchDisabled ? 0.35 : 1 }}><Icon icon={GitBranchIcon} tone="ink2" size={14} /><Text numberOfLines={1} style={[styles.label, { flexShrink: 1 }]}>{branchName}</Text><Icon icon={UnfoldMoreIcon} tone="ink3" size={13} /></View>
          </PullDown>
        </View>}
        {!!attachments.length && <PageScroll horizontal contentContainerStyle={{ padding: 4, paddingBottom: 4, gap: 8 }}>{attachments.map(item => <View key={item.id} style={{ backgroundColor: colors.field, borderRadius: 12, borderCurve: 'continuous', paddingLeft: item.image ? 4 : 10, flexDirection: 'row', alignItems: 'center', maxWidth: 220 }}>{item.image ? <Image source={{ uri: item.uri }} accessibilityLabel={item.name} style={{ width: 44, height: 44, borderRadius: 8 }} /> : <Icon icon={File01Icon} tone="ink2" size={18} />}<Text numberOfLines={1} style={[styles.label, { flexShrink: 1, paddingLeft: 6 }]}>{item.name}</Text><IconButton label={`Remove ${item.name}`} icon={Cancel01Icon} size={32} disabled={busy || picking} onPress={() => composer.setAttachments(current => ({ ...current, [chatId]: (current[chatId] || []).filter(attachment => attachment.id !== item.id) }))} /></View>)}</PageScroll>}
        <Field label="Message" hideLabel placeholder="Message the agent" multiline autoCorrect spellCheck autoCapitalize="sentences" value={draft} onChangeText={value => composer.setDrafts(current => ({ ...current, [chatId]: value }))} style={{ backgroundColor: 'transparent', minHeight: 44, maxHeight: 140, paddingHorizontal: 10, paddingVertical: 6 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <PullDown label="Add photos or files" nativeTrigger={{ systemImage: 'plus', disabled: attachmentDisabled }} sections={[{ items: [{ id: 'photos', title: 'Photo Library', systemImage: 'photo.on.rectangle', disabled: attachmentDisabled }, { id: 'camera', title: 'Take Photo', systemImage: 'camera', disabled: attachmentDisabled }, { id: 'files', title: 'Choose Files', systemImage: 'folder', disabled: attachmentDisabled }] }]} onSelect={kind => void pick(kind as 'photos' | 'camera' | 'files')}>
            <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: attachmentDisabled ? 0.35 : 1 }}><Icon icon={Add01Icon} tone="ink2" size={21} /></View>
          </PullDown>
          <AgentControls model={model} onToggle={() => { router.push({ pathname: '/model-sheet', params: { chatId, model: model.id, ...(chat?.provider ? { locked: chat.provider } : {}), ...(run ? { busy: '1' } : {}) } }); }} />
          <PermissionChip mode={preferences.permissionMode} onPress={() => router.push({ pathname: '/permission-sheet', params: { chatId, ...(run ? { busy: '1' } : {}) } })} />
          <View style={{ flex: 1 }} />
          {run && !draft.trim() && !attachments.length && <IconButton label="Stop" icon={StopIcon} filled size={34} disabled={busy} onPress={() => void action(() => client.call('agent:interrupt', [chatId]))} />}
          {(!run || !!draft.trim() || !!attachments.length) && <IconButton label={busy ? 'Sending...' : run ? 'Send follow-up' : 'Send message'} icon={ArrowUp02Icon} filled size={34} loading={busy} disabled={busy || picking || (newWorktree && !base) || (!draft.trim() && !attachments.length) || !!session.error || !!chat?.archived || unavailable} onPress={() => void send()} />}
        </View>
      </View>}
    </View>
    </KeyboardStickyView>
    </PanelSwipe>
  </View>;
}
