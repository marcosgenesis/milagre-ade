import { useRef, useState } from 'react';
import { Image, Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lastUserModel } from '@milagre/shared/agent-runs';
import { useSession } from '../session';
import { pickAttachments } from '../attachment-picker';
import { appendAttachments, attachmentPrompt, prepareAttachments } from '../attachments';
import { ChatStatus, AgentStatus, WorktreeStatus } from '../status-indicators';
import { ChatReply } from '../chat-reply';
import { Questions } from '../questions';
import { AgentControls } from '../agent-controls';
import { defaultPreferences, selectedModel, sendOptions } from '../turn-options';
import { Button, Icon, IconButton, choiceMenu, ErrorNotice, Field, PageScroll, colors, styles } from '../ui';

export default function ChatScreen() {
  const params = useLocalSearchParams<{ id?: string; worktreeId?: string }>();
  const session = useSession();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const scroll = useRef<ScrollView>(null);
  const following = useRef(true);
  if (!session.client || !session.snapshot) return <Redirect href="/" />;
  const client = session.client;
  const { project, runs } = session.snapshot;
  const chat = params.id ? project.state.sessions[Number(params.id)] : null;
  const chatId = `${project.path}#${params.id ?? `new:${params.worktreeId}`}`;
  const draft = session.drafts[chatId] || '';
  const attachments = session.attachments[chatId] || [];
  const run = chat ? runs.runs[chatId] : undefined;
  const messages = chat ? project.state.messages.filter(m => m.session_id === chat.id) : [];
  const preferences = session.preferences[chatId] || defaultPreferences;
  const actualProvider = chat?.provider || preferences.provider;
  const model = selectedModel(actualProvider, preferences.model || (chat ? lastUserModel(project.state, chat.id) : ''), session.models);
  const worktreeId = chat?.worktree_id ?? Number(params.worktreeId);
  const unavailable = session.cliStatus?.[actualProvider]?.state !== undefined && session.cliStatus[actualProvider].state !== 'ready';
  const title = chat?.title || chat?.generatedTitle || 'New Chat';
  async function action(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); await session.refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function pick(kind: 'photos' | 'files') {
    if (picking || busy) return;
    setPicking(true); setError('');
    try {
      const added = await pickAttachments(kind);
      const next = appendAttachments(attachments, added);
      session.setAttachments(current => ({ ...current, [chatId]: next }));
    } catch (e) { setError((e as Error).message); }
    finally { setPicking(false); }
  }
  async function send() {
    const sent = draft;
    await action(async () => {
      const media = await prepareAttachments(client, project.path, attachments);
      const result = await client.call<{ sessionId: number }>('chat:send', [{ projectPath: project.path, sessionId: params.id ? Number(params.id) : null, worktreeId, body: sent, ...media, prompt: attachmentPrompt(sent, media.files), ...sendOptions(model, preferences) }]);
      session.setDrafts(current => {
        const remaining = current[chatId] === sent ? '' : current[chatId] || '';
        const destination = `${project.path}#${result.sessionId}`;
        const preserved = destination !== chatId ? current[destination] || '' : '';
        const next = { ...current, [destination]: [preserved, remaining].filter(Boolean).join('\n') };
        if (destination !== chatId) delete next[chatId];
        return next;
      });
      session.setAttachments(current => {
        const sentIds = new Set(attachments.map(item => item.id));
        const remaining = (current[chatId] || []).filter(item => !sentIds.has(item.id));
        const destination = `${project.path}#${result.sessionId}`;
        const preserved = destination !== chatId ? current[destination] || [] : [];
        const next = { ...current, [destination]: [...preserved, ...remaining] };
        if (destination !== chatId) delete next[chatId];
        return next;
      });
      session.setPreferences(current => {
        const destination = `${project.path}#${result.sessionId}`;
        const next = { ...current, [destination]: { ...(current[chatId] || preferences), provider: actualProvider, model: model.id } };
        if (destination !== chatId) delete next[chatId];
        return next;
      });
      following.current = true;
      Keyboard.dismiss();
      if (!params.id) router.setParams({ id: String(result.sessionId) });
    });
  }
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 44}>
    <Stack.Screen options={{ title, headerRight: () => chat ? <Button title="Details" secondary onPress={() => router.push({ pathname: '/chat-details', params: { id: String(chat.id) } })} /> : null }} />
    <PageScroll ref={scroll} contentContainerStyle={{ paddingTop: 12 }} scrollEventThrottle={32} onScroll={({ nativeEvent: e }) => { following.current = e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height < 120; }} onContentSizeChange={() => { if (following.current) scroll.current?.scrollToEnd({ animated: true }); }}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}><ChatStatus chat={chat || undefined} run={run} messages={messages} /><Text style={styles.label}>{project.name}</Text></View>
      {process.env.EXPO_PUBLIC_DEMO === '1' && <Text style={styles.muted}>Demo agent. Try a message, or send tools, approval, question, or slow to test controls.</Text>}
      <View style={styles.row}><Button title="View changes" secondary onPress={() => router.push({ pathname: '/changes', params: { worktreeId: String(worktreeId) } })} /></View>

      {session.providerError ? <Text style={styles.muted}>{session.providerError}</Text> : null}
      {chat?.archived && <View style={styles.card}><Text style={styles.muted}>This Chat is archived. Restore it to send a message.</Text><Button title="Restore Chat" disabled={busy} onPress={() => void action(() => client.call('chat:patch', [project.path, chat.id, { archived: false }]))} /></View>}
      {!messages.length && !run && <View style={[styles.card, { paddingVertical: 28 }]}><Text style={styles.subtitle}>What are we working on?</Text><Text style={styles.muted}>Ask your agent to look into something. It runs in this Project on your computer.</Text></View>}
      {messages.map(message => <ChatReply key={message.id} message={message} onInteract={() => { following.current = false; }} />)}
      {run && <ChatReply run={run} onInteract={() => { following.current = false; }} />}
      {run?.approvals.map(approval => <View style={styles.card} key={approval.requestId}><Text style={[styles.label, { color: colors.accent }]}>Approval needed</Text><Text style={styles.subtitle}>{approval.title}</Text>{[approval.description, approval.command, approval.diff, approval.detail, approval.reason].filter(Boolean).map((text, i) => <Text key={i} selectable style={styles.code}>{text}</Text>)}<View style={styles.row}>{(['allow', 'deny'] as const).map(decision => <Button key={decision} title={decision === 'allow' ? 'Allow once' : 'Deny'} secondary={decision === 'deny'} disabled={busy} onPress={() => void action(async () => { const accepted = await client.call('agent:respond-permission', [{ chatId, requestId: approval.requestId, decision }]); if (!accepted) throw new Error('This approval is no longer pending. Refresh the Chat.'); })} />)}</View></View>)}
      {run?.questions.map(request => <Questions key={request.requestId} request={request} busy={busy} submit={(answers, summary) => void action(async () => { const accepted = await client.call('agent:answer-question', [{ chatId, requestId: request.requestId, answers, summary }]); if (!accepted) throw new Error('This question is no longer pending. Refresh the Chat.'); })} />)}
      {chat?.resumeTurn && !run && <Button title="Continue interrupted turn" disabled={busy} onPress={() => void action(() => client.call('chat:resume', [project.path, chat.id]))} />}
      {error ? <ErrorNotice message={error} /> : null}{session.error ? <ErrorNotice message={session.error} retry={() => router.push('/')} /> : null}
    </PageScroll>
    <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 12), backgroundColor: colors.bg }}>
      <View style={[styles.row, { gap: 12 }]}><AgentStatus agents={chat?.subagents || []} />{project.state.worktrees[worktreeId] && <WorktreeStatus worktree={project.state.worktrees[worktreeId]} />}</View>
      <View style={{ backgroundColor: colors.panel, borderWidth: 0.5, borderColor: colors.line, borderRadius: 24, borderCurve: 'continuous', padding: 8, gap: 6 }}>
        {!!attachments.length && <PageScroll horizontal contentContainerStyle={{ padding: 4, paddingBottom: 4, gap: 8 }}>{attachments.map(item => <View key={item.id} style={{ backgroundColor: colors.field, borderRadius: 12, paddingLeft: 8, flexDirection: 'row', alignItems: 'center', maxWidth: 220 }}>{item.image ? <Image source={{ uri: item.uri }} accessibilityLabel={item.name} style={{ width: 44, height: 44, borderRadius: 8 }} /> : <Icon name={{ ios: 'doc', android: 'description' }} />}<Text numberOfLines={1} style={[styles.label, { flexShrink: 1, paddingLeft: 6 }]}>{item.name}</Text><IconButton label={`Remove ${item.name}`} name={{ ios: 'xmark.circle.fill', android: 'cancel' }} disabled={busy || picking} onPress={() => session.setAttachments(current => ({ ...current, [chatId]: (current[chatId] || []).filter(attachment => attachment.id !== item.id) }))} /></View>)}</PageScroll>}
        <Field label="Message" hideLabel placeholder="Message your agent" multiline value={draft} onChangeText={value => session.setDrafts(current => ({ ...current, [chatId]: value }))} style={{ backgroundColor: 'transparent', minHeight: 58, maxHeight: 140, paddingHorizontal: 12 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <IconButton label="Add photos or files" name={{ ios: 'plus', android: 'add' }} loading={picking} disabled={busy || picking || attachments.length >= 4} onPress={() => choiceMenu('Add attachment', [{ title: 'Photo Library', onPress: () => void pick('photos') }, { title: 'Choose Files', onPress: () => void pick('files') }])} />
          <AgentControls model={model} preferences={preferences} reported={session.models} status={session.cliStatus} lockedProvider={!!chat?.provider} disabled={busy || !!run} onToggle={() => { following.current = false; }} onChange={patch => session.setPreferences(current => ({ ...current, [chatId]: { ...preferences, ...patch } }))} />
          {run && <IconButton label="Stop" name={{ ios: 'stop.fill', android: 'stop' }} disabled={busy} onPress={() => void action(() => client.call('agent:interrupt', [chatId]))} />}
          {(!run || !!draft.trim() || !!attachments.length) && <IconButton label={busy ? 'Sending...' : run ? 'Send follow-up' : 'Send message'} name={{ ios: 'arrow.up', android: 'arrow_upward' }} filled loading={busy} disabled={busy || picking || (!draft.trim() && !attachments.length) || !!session.error || !!chat?.archived || unavailable} onPress={() => void send()} />}
        </View>
      </View>
    </View>
  </KeyboardAvoidingView>;
}
