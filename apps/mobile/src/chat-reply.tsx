import { memo, useState } from 'react';
import { Image, Pressable, Text, View, type ImageSourcePropType } from 'react-native';
import { router } from 'expo-router';
import { AiBrainIcon, Alert02Icon, ArrowDown01Icon, ArrowRight01Icon, CheckmarkCircle02Icon, CircleIcon, CommandLineIcon, File01Icon, FileEditIcon, Image01Icon, Maximize01Icon, Search01Icon, ShieldAlertIcon, Wrench01Icon } from '@hugeicons/core-free-icons';
import type { AgentRun } from '@milagre/shared/agent-runs';
import type { ChatMessage, ChatStep, StepKind } from '@milagre/shared/model';
import { activitySummary, replyActivity, unspokenThought } from '@milagre/shared/reply-parts';
import { activityState } from './chat-presentation';
import { Markdown } from './markdown';
import { Icon, SpinnerRing, type IconData } from './icons';
import { showImages, type ViewerImage } from './viewer-store';
import { PageScroll, colors, styles } from './ui';

const icons: Record<StepKind, IconData> = { shell: CommandLineIcon, setup: CommandLineIcon, read: File01Icon, edit: FileEditIcon, search: Search01Icon, thinking: AiBrainIcon, image: Image01Icon, other: Wrench01Icon };
/** Resolves a saved file on the computer to an authenticated image source. */
export type MediaSource = (path: string) => ImageSourcePropType;
const open = (images: ViewerImage[], index: number) => { showImages(images, index); router.push('/viewer'); };

/** Your photos above your bubble: one large, or tiles; tapping opens the full-screen viewer. */
function Photos({ message, media }: { message: ChatMessage; media: MediaSource }) {
  const photos: ViewerImage[] = (message.images || []).map(photo => ({ name: photo.name, source: photo.dataUrl ? { uri: photo.dataUrl } : photo.path ? media(photo.path) : { uri: '' } }));
  if (!photos.length) return null;
  const single = photos.length === 1;
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end', maxWidth: 264 }}>
    {photos.map((photo, index) => <Pressable key={index} accessibilityRole="imagebutton" accessibilityLabel={`${photo.name}. Open full screen`} onPress={() => open(photos, index)}>
      <Image source={photo.source} resizeMode="cover" style={{ width: single ? 220 : 130, height: single ? 220 : 130, borderRadius: 14, backgroundColor: colors.canvas }} />
    </Pressable>)}
  </View>;
}
function FileChip({ path }: { path: string }) {
  const name = path.split(/[\\/]/).pop() || path;
  const ext = name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : 'FILE';
  return <View accessible accessibilityLabel={`Attached file ${name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingLeft: 8, paddingRight: 12, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.canvas, maxWidth: 264 }}>
    <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: ext === 'PDF' ? colors.red : colors.ink2, fontSize: 9, fontWeight: '700' }}>{ext}</Text></View>
    <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 14, fontWeight: '500', flexShrink: 1 }}>{name}</Text>
  </View>;
}
/** An image the agent generated, under its step, at most 240 wide; tap or expand for full screen. */
function GeneratedImage({ step, media }: { step: ChatStep; media: MediaSource }) {
  const [ratio, setRatio] = useState(4 / 5);
  if (!step.file || step.status !== 'done') return null;
  const image: ViewerImage = { source: media(step.file), name: step.file.split('/').pop() || 'Generated image' };
  return <Pressable accessibilityRole="imagebutton" accessibilityLabel="Generated image. Open full screen" onPress={() => open([image], 0)} style={{ width: 240 }}>
    <Image source={image.source} onLoad={({ nativeEvent }) => { const { width, height } = nativeEvent.source; if (width && height) setRatio(width / height); }} style={{ width: 240, aspectRatio: ratio, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.canvas }} />
    <View style={{ position: 'absolute', right: 8, top: 8, width: 30, height: 30, borderRadius: 10, backgroundColor: '#ffffffcc', alignItems: 'center', justifyContent: 'center' }}><Icon icon={Maximize01Icon} tone="ink" size={15} /></View>
  </Pressable>;
}
function ToolRow({ step, live, waiting, onInteract }: { step: ChatStep; live: boolean; waiting: boolean; onInteract?: () => void }) {
  const [open, setOpen] = useState(false);
  const running = live && step.status === 'running' && !waiting;
  const state = step.status === 'failed' ? 'Failed' : live && step.status === 'running' ? waiting ? 'Waiting' : 'Running' : '';
  return <View style={{ gap: 8 }}><Pressable accessibilityRole={step.detail ? 'button' : 'text'} accessibilityState={step.detail ? { expanded: open } : undefined} accessibilityLabel={`${step.title.replace(/`/g, '')}${state ? `, ${state}` : ''}`} disabled={!step.detail} onPress={() => { onInteract?.(); setOpen(!open); }} style={({ pressed }) => ({ minHeight: 36, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.5 : 1 })}>
    {running ? <SpinnerRing size={15} /> : <Icon icon={icons[step.kind]} tone={step.status === 'failed' ? 'red' : 'ink2'} size={16} />}
    <View style={{ flex: 1, gap: 2 }}><Text style={{ color: step.status === 'failed' ? colors.red : colors.ink, fontSize: 13, fontFamily: styles.code.fontFamily }}>{step.title.replace(/`/g, '')}</Text>{(step.note || state) && <Text style={styles.label}>{[state, step.note].filter(Boolean).join(' · ')}</Text>}</View>
    {step.detail && <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} tone="ink3" size={12} />}
  </Pressable>{open && step.detail && <PageScroll nestedScrollEnabled style={{ maxHeight: 320, backgroundColor: colors.field, borderRadius: 12 }} contentContainerStyle={{ padding: 12, paddingBottom: 12 }}>
    {step.kind === 'thinking' ? <Markdown text={step.detail} streaming={running} /> : <Text selectable style={styles.code}>{step.detail}</Text>}
  </PageScroll>}</View>;
}
export const ChatReply = memo(function ChatReply({ message, run, onInteract, media }: { message?: ChatMessage; run?: AgentRun; onInteract?: () => void; media: MediaSource }) {
  const [expanded, setExpanded] = useState(false);
  const text = run?.text ?? message?.body ?? '';
  const steps = run?.steps ?? message?.steps ?? [];
  const reply = replyActivity(text, steps);
  const state = activityState(steps, run);
  const waiting = !!(run?.approvals.length || run?.questions.length);
  const summary = activitySummary(steps);
  const answer = reply.answer || (!run ? unspokenThought(reply.activity, reply.answer) : '');
  if (message?.role === 'user') return <View style={{ alignSelf: 'flex-end', alignItems: 'flex-end', gap: 6, maxWidth: '88%' }}>
    <Photos message={message} media={media} />
    {message.files?.filter(file => !message.images?.some(image => image.path === file || image.sourcePath === file)).map(file => <FileChip key={file} path={file} />)}
    {!!text && <View style={{ backgroundColor: colors.canvas, borderRadius: 18, borderCurve: 'continuous', paddingVertical: 10, paddingHorizontal: 14 }}><Text selectable style={{ color: colors.ink, fontSize: 15, lineHeight: 21 }}>{text}</Text></View>}
  </View>;
  return <View style={{ gap: 14, paddingVertical: 8 }}>
    {reply.setup.map(step => <ToolRow key={step.id} step={step} live={!!run} waiting={waiting} onInteract={onInteract} />)}
    {(reply.activity.length > 0 || run) && <View style={{ gap: 4 }}><Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${run ? state.label : summary.text || 'Activity'}. ${expanded ? 'Hide' : 'Show'} activity`} onPress={() => { onInteract?.(); setExpanded(!expanded); }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36, opacity: pressed ? 0.5 : 1 })}>
      {state.working ? <SpinnerRing size={15} /> : <Icon icon={waiting ? ShieldAlertIcon : summary.failed ? Alert02Icon : CheckmarkCircle02Icon} tone={waiting ? 'orange' : summary.failed ? 'red' : 'ink3'} size={16} />}
      <Text style={{ color: colors.ink2, fontSize: 14, flex: 1 }}>{run ? state.label : summary.text || 'Activity'}{!run && summary.failed ? ` · ${state.label}` : ''}</Text><Icon icon={expanded ? ArrowDown01Icon : ArrowRight01Icon} tone="ink3" size={12} />
    </Pressable>{expanded && <View style={{ paddingLeft: 16, marginLeft: 8, borderLeftWidth: 1, borderColor: colors.line, gap: 4 }}>{reply.activity.map((entry, i) => entry.type === 'step' ? <ToolRow key={entry.step.id} step={entry.step} live={!!run} waiting={waiting} onInteract={onInteract} /> : <Markdown key={`text-${i}`} text={entry.text} />)}</View>}</View>}
    {reply.images.map(step => <View key={step.id} style={{ gap: 6 }}><ToolRow step={step} live={!!run} waiting={waiting} onInteract={onInteract} /><GeneratedImage step={step} media={media} /></View>)}
    {!!answer && <Markdown text={answer} streaming={!!run} />}
    {run?.tasks?.length ? <View style={[styles.card, { gap: 8 }]}>{run.tasks.map(task => <View key={task.id} style={[styles.row, { flexWrap: 'nowrap' }]}><Icon icon={task.status === 'completed' ? CheckmarkCircle02Icon : CircleIcon} tone={task.status === 'completed' ? 'green' : 'ink3'} size={16} /><Text style={[styles.muted, { flex: 1 }]}>{task.status === 'in_progress' ? task.activeForm || task.content : task.content}</Text></View>)}</View> : null}
    {!run && message?.outcome === 'cancelled' && <Text style={styles.muted}>Turn stopped</Text>}
    {!run && message?.outcome === 'failed' && <Text accessibilityRole="alert" style={{ color: colors.error }}>The turn failed. Review the response before trying again.</Text>}
    {!run && !text && !steps.length && !message?.outcome && <Text style={styles.muted}>No text response</Text>}
  </View>;
});
