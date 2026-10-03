import { memo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import type { AgentRun } from '@milagre/shared/agent-runs';
import type { ChatMessage, ChatStep, StepKind } from '@milagre/shared/model';
import { activitySummary, replyActivity, unspokenThought } from '@milagre/shared/reply-parts';
import { activityState } from './chat-presentation';
import { Markdown } from './markdown';
import { Icon, PageScroll, colors, styles } from './ui';

const icons: Record<StepKind, { ios: string; android: string }> = {
  shell: { ios: 'terminal', android: 'terminal' }, setup: { ios: 'terminal', android: 'terminal' },
  read: { ios: 'doc.text', android: 'description' }, edit: { ios: 'pencil.line', android: 'edit' },
  search: { ios: 'magnifyingglass', android: 'search' }, thinking: { ios: 'sparkles', android: 'psychology' },
  image: { ios: 'photo', android: 'image' }, other: { ios: 'wrench.and.screwdriver', android: 'build' },
};
function ToolRow({ step, live, waiting, onInteract }: { step: ChatStep; live: boolean; waiting: boolean; onInteract?: () => void }) {
  const [open, setOpen] = useState(false);
  const running = live && step.status === 'running' && !waiting;
  const state = step.status === 'failed' ? 'Failed' : live && step.status === 'running' ? waiting ? 'Waiting' : 'Running' : '';
  return <View style={{ gap: 8 }}><Pressable accessibilityRole={step.detail ? 'button' : 'text'} accessibilityState={step.detail ? { expanded: open } : undefined} accessibilityLabel={`${step.title.replace(/`/g, '')}${state ? `, ${state}` : ''}`} disabled={!step.detail} onPress={() => { onInteract?.(); setOpen(!open); }} style={({ pressed }) => ({ minHeight: 44, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.5 : 1 })}>
    {running ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon name={icons[step.kind] as Parameters<typeof Icon>[0]['name']} color={step.status === 'failed' ? colors.error : colors.muted} />}
    <View style={{ flex: 1, gap: 2 }}><Text style={[styles.muted, { color: step.status === 'failed' ? colors.error : colors.text }]}>{step.title.replace(/`/g, '')}</Text>{(step.note || state) && <Text style={styles.label}>{[state, step.note].filter(Boolean).join(' · ')}</Text>}</View>
    {step.detail && <Icon name={{ ios: open ? 'chevron.down' : 'chevron.right', android: open ? 'expand_more' : 'chevron_right' }} size={12} />}
  </Pressable>{open && step.detail && <PageScroll nestedScrollEnabled style={{ maxHeight: 320, backgroundColor: colors.field, borderRadius: 12 }} contentContainerStyle={{ padding: 12, paddingBottom: 12 }}>
    {step.kind === 'thinking' ? <Markdown text={step.detail} streaming={running} /> : <Text selectable style={styles.code}>{step.detail}</Text>}
  </PageScroll>}</View>;
}
export const ChatReply = memo(function ChatReply({ message, run, onInteract }: { message?: ChatMessage; run?: AgentRun; onInteract?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const text = run?.text ?? message?.body ?? '';
  const steps = run?.steps ?? message?.steps ?? [];
  const reply = replyActivity(text, steps);
  const state = activityState(steps, run);
  const waiting = !!(run?.approvals.length || run?.questions.length);
  const summary = activitySummary(steps);
  const answer = reply.answer || (!run ? unspokenThought(reply.activity, reply.answer) : '');
  if (message?.role === 'user') return <View style={{ alignSelf: 'flex-end', maxWidth: '92%', backgroundColor: colors.field, borderRadius: 22, borderCurve: 'continuous', padding: 16, gap: 8 }}><Text selectable style={styles.text}>{text}</Text>{message.images?.map(photo => <Image key={photo.id} source={{ uri: photo.dataUrl }} accessibilityLabel={photo.name} resizeMode="contain" style={{ width: 220, height: 160, borderRadius: 12 }} />)}{message.files?.map(file => <Text key={file} selectable style={styles.muted}>{file.split(/[\\/]/).pop()}</Text>)}</View>;
  return <View style={{ gap: 14, paddingVertical: 8 }}>
    <View style={[styles.row, { gap: 7 }]}><Icon name={{ ios: 'sparkles', android: 'auto_awesome' }} color={colors.accent} size={16} /><Text style={[styles.label, { color: colors.text }]}>{message?.model || run?.model || 'Milagre'}</Text></View>
    {reply.setup.map(step => <ToolRow key={step.id} step={step} live={!!run} waiting={waiting} onInteract={onInteract} />)}
    {(reply.activity.length > 0 || run) && <View style={{ gap: 4 }}><Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${run ? state.label : summary.text || 'Activity'}. ${expanded ? 'Hide' : 'Show'} activity`} onPress={() => { onInteract?.(); setExpanded(!expanded); }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, opacity: pressed ? 0.5 : 1 })}>
      {state.working ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon name={{ ios: waiting ? 'hand.raised' : summary.failed ? 'exclamationmark.circle' : 'checkmark.circle', android: waiting ? 'pan_tool' : summary.failed ? 'error' : 'check_circle' }} color={summary.failed ? colors.error : colors.muted} size={18} />}
      <Text style={[styles.muted, { flex: 1 }]}>{run ? state.label : summary.text || 'Activity'}{!run && summary.failed ? ` · ${state.label}` : ''}</Text><Icon name={{ ios: expanded ? 'chevron.down' : 'chevron.right', android: expanded ? 'expand_more' : 'chevron_right' }} size={12} />
    </Pressable>{expanded && <View style={{ paddingLeft: 16, marginLeft: 8, borderLeftWidth: 1, borderColor: colors.line, gap: 4 }}>{reply.activity.map((entry, i) => entry.type === 'step' ? <ToolRow key={entry.step.id} step={entry.step} live={!!run} waiting={waiting} onInteract={onInteract} /> : <Markdown key={`text-${i}`} text={entry.text} />)}</View>}</View>}
    {reply.images.map(step => <ToolRow key={step.id} step={step} live={!!run} waiting={waiting} onInteract={onInteract} />)}
    {!!answer && <Markdown text={answer} streaming={!!run} />}
    {run?.tasks?.length ? <View style={[styles.card, { gap: 8 }]}>{run.tasks.map(task => <View key={task.id} style={[styles.row, { flexWrap: 'nowrap' }]}><Icon name={{ ios: task.status === 'completed' ? 'checkmark.circle.fill' : 'circle', android: task.status === 'completed' ? 'check_circle' : 'radio_button_unchecked' }} color={task.status === 'completed' ? colors.green : colors.muted} /><Text style={[styles.muted, { flex: 1 }]}>{task.status === 'in_progress' ? task.activeForm || task.content : task.content}</Text></View>)}</View> : null}
    {!run && message?.outcome === 'cancelled' && <Text style={styles.muted}>Turn stopped</Text>}
    {!run && message?.outcome === 'failed' && <Text accessibilityRole="alert" style={{ color: colors.error }}>The turn failed. Review the response before trying again.</Text>}
    {!run && !text && !steps.length && !message?.outcome && <Text style={styles.muted}>No text response</Text>}
  </View>;
});
