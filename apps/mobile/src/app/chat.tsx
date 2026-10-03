import { useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ModelProvider } from '@milagre/shared/model';
import { MODEL_CATALOG } from '@milagre/shared/model';
import { lastUserModel } from '@milagre/shared/agent-runs';
import { useSession } from '../session';
import { Questions } from '../questions';
import { Button, Choice, ErrorNotice, Field, PageScroll, colors, styles } from '../ui';

export default function ChatScreen() {
  const params = useLocalSearchParams<{ id?: string; worktreeId?: string }>();
  const session = useSession();
  const insets = useSafeAreaInsets();
  const [provider, setProvider] = useState<ModelProvider>('codex');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scroll = useRef<ScrollView>(null);
  const following = useRef(true);
  if (!session.client || !session.snapshot) return <Redirect href="/" />;
  const client = session.client;
  const { project, runs } = session.snapshot;
  const chat = params.id ? project.state.sessions[Number(params.id)] : null;
  const chatId = `${project.path}#${params.id ?? `new:${params.worktreeId}`}`;
  const draft = session.drafts[chatId] || '';
  const run = chat ? runs.runs[chatId] : undefined;
  const messages = chat ? project.state.messages.filter(m => m.session_id === chat.id) : [];
  const actualProvider = chat?.provider || provider;
  const actualModel = model.trim() || (chat ? lastUserModel(project.state, chat.id) : '') || MODEL_CATALOG.find(m => m.provider === actualProvider)?.id || '';
  const title = chat?.title || chat?.generatedTitle || 'New Chat';
  async function action(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); await session.refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function send() {
    const sent = draft;
    await action(async () => {
      const result = await client.call<{ sessionId: number }>('chat:send', [{ projectPath: project.path, sessionId: params.id ? Number(params.id) : null, worktreeId: Number(params.worktreeId), body: sent, provider: actualProvider, model: actualModel, permissionMode: 'ask' }]);
      session.setDrafts(current => {
        const remaining = current[chatId] === sent ? '' : current[chatId] || '';
        const destination = `${project.path}#${result.sessionId}`;
        const next = { ...current, [destination]: remaining };
        if (destination !== chatId) delete next[chatId];
        return next;
      });
      following.current = true;
      Keyboard.dismiss();
      if (!params.id) router.setParams({ id: String(result.sessionId) });
    });
  }
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 44}>
    <Stack.Screen options={{ title }} />
    <PageScroll ref={scroll} contentContainerStyle={{ paddingTop: 12 }} scrollEventThrottle={32} onScroll={({ nativeEvent: e }) => { following.current = e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height < 120; }} onContentSizeChange={() => { if (following.current) scroll.current?.scrollToEnd({ animated: true }); }}>
      <View style={styles.row}><Text style={[styles.label, { color: run ? colors.green : colors.muted }]}>{run ? 'WORKING' : 'READY'}</Text><Text style={styles.muted}>{actualProvider === 'codex' ? 'Codex' : 'Claude'} / {project.name}</Text></View>
      {process.env.EXPO_PUBLIC_DEMO === '1' && <Text style={styles.muted}>Demo agent. Try a message, or send approval, question, or slow to test controls.</Text>}
      {!chat?.provider && <View style={styles.card}><Text style={styles.label}>AGENT</Text><View style={styles.row}>{(['codex', 'claude'] as const).map(p => <Choice key={p} title={p === 'codex' ? 'Codex' : 'Claude'} selected={actualProvider === p} onPress={() => { setProvider(p); setModel(''); }} />)}</View><Field label="Model" placeholder={actualModel} value={model} onChangeText={setModel} /></View>}
      {!messages.length && !run && <View style={[styles.card, { paddingVertical: 28 }]}><Text style={styles.subtitle}>Start here.</Text><Text style={styles.muted}>Ask your agent to look into something. It runs in this Project on your computer.</Text></View>}
      {messages.map(message => <View key={message.id} style={[styles.card, message.role === 'user' ? { backgroundColor: '#2a2432', borderColor: '#43364f' } : {}]}><Text style={styles.label}>{message.role === 'user' ? 'YOU' : 'AGENT'}</Text><Text selectable style={styles.text}>{message.body || (message.outcome === 'cancelled' ? 'Turn stopped.' : 'No text response.')}</Text>{message.steps?.map(step => <Text key={step.id} style={styles.muted}>{step.title}</Text>)}{message.images?.length ? <Text style={styles.muted}>{message.images.length} image attachment(s). View images on desktop.</Text> : null}{message.outcome === 'failed' && <Text style={{ color: colors.error }}>The turn failed. Check the response before trying again.</Text>}</View>)}
      {run && <View style={styles.card}><Text style={styles.label}>AGENT / LIVE</Text><Text selectable style={styles.text}>{run.text || 'Working on your request...'}</Text>{run.steps.map(step => <Text key={step.id} style={styles.muted}>{step.title}</Text>)}</View>}
      {run?.approvals.map(approval => <View style={styles.card} key={approval.requestId}><Text style={[styles.label, { color: colors.accent }]}>APPROVAL NEEDED</Text><Text style={styles.subtitle}>{approval.title}</Text>{[approval.description, approval.command, approval.diff, approval.detail, approval.reason].filter(Boolean).map((text, i) => <Text key={i} selectable style={styles.code}>{text}</Text>)}<View style={styles.row}>{(['allow', 'deny'] as const).map(decision => <Button key={decision} title={decision === 'allow' ? 'Allow once' : 'Deny'} secondary={decision === 'deny'} disabled={busy} onPress={() => void action(async () => { const accepted = await client.call('agent:respond-permission', [{ chatId, requestId: approval.requestId, decision }]); if (!accepted) throw new Error('This approval is no longer pending. Refresh the Chat.'); })} />)}</View></View>)}
      {run?.questions.map(request => <Questions key={request.requestId} request={request} busy={busy} submit={(answers, summary) => void action(async () => { const accepted = await client.call('agent:answer-question', [{ chatId, requestId: request.requestId, answers, summary }]); if (!accepted) throw new Error('This question is no longer pending. Refresh the Chat.'); })} />)}
      {chat?.resumeTurn && !run && <Button title="Continue interrupted turn" disabled={busy} onPress={() => void action(() => client.call('chat:resume', [project.path, chat.id]))} />}
      {error ? <ErrorNotice message={error} /> : null}{session.error ? <ErrorNotice message={session.error} retry={() => router.push('/')} /> : null}
    </PageScroll>
    <View style={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16), gap: 12, borderTopWidth: 1, borderColor: colors.line }}><Field label="Message" placeholder="Ask your agent..." multiline value={draft} onChangeText={value => session.setDrafts(current => ({ ...current, [chatId]: value }))} style={{ maxHeight: 140 }} /><View style={styles.row}><View style={{ flex: 1 }}><Button title={busy ? 'Sending...' : run ? 'Send follow-up' : 'Send message'} onPress={() => void send()} disabled={busy || !draft.trim() || !!session.error} /></View>{run && <Button title="Stop" secondary disabled={busy} onPress={() => void action(() => client.call('agent:interrupt', [chatId]))} />}</View></View>
  </KeyboardAvoidingView>;
}
