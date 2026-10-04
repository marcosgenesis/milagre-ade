import { memo, useRef, useState } from 'react';
import { Image, Pressable, Text, View, useColorScheme, type ImageSourcePropType, type TextStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { router } from 'expo-router';
import { AiBrainIcon, Alert02Icon, ArrowDown01Icon, ArrowRight01Icon, ArrowUp01Icon, CheckmarkCircle02Icon, CircleIcon, CommandLineIcon, File01Icon, FileEditIcon, Image01Icon, Maximize01Icon, Search01Icon, Wrench01Icon } from '@hugeicons/core-free-icons';
import type { AgentRun } from '@milagre/shared/agent-runs';
import type { ChatMessage, ChatStep, StepKind } from '@milagre/shared/model';
import { activitySummary, replyActivity, titleSpans, unspokenThought } from '@milagre/shared/reply-parts';
import { Markdown } from './markdown';
import { Icon, type IconData } from './icons';
import { ShimmerText } from './running-logo';
import { fonts, hex } from './theme';
import { showImages, type ViewerImage } from './viewer-store';
import { PageScroll, colors, styles } from './ui';

const icons: Record<StepKind, IconData> = { shell: CommandLineIcon, setup: CommandLineIcon, read: File01Icon, edit: FileEditIcon, search: Search01Icon, thinking: AiBrainIcon, image: Image01Icon, other: Wrench01Icon };
/** Resolves a saved file on the computer to an authenticated image source. */
export type MediaSource = (path: string) => ImageSourcePropType;
/** Measures every thumbnail first, so the viewer morphs out of the tapped one and back into whichever is showing. */
function open(images: ViewerImage[], index: number, thumbs: (View | null)[]) {
  void Promise.all(images.map((image, i) => new Promise<ViewerImage>(resolve => {
    const thumb = thumbs[i];
    if (!thumb) { resolve(image); return; }
    thumb.measureInWindow((x, y, width, height) => resolve(width && height ? { ...image, from: { x, y, width, height } } : image));
  }))).then(measured => { showImages(measured, index); router.push('/viewer'); });
}

/** Your photos above your bubble: one large, or tiles; tapping opens the full-screen viewer. */
function Photos({ message, media }: { message: ChatMessage; media: MediaSource }) {
  const photos: ViewerImage[] = (message.images || []).map(photo => ({ name: photo.name, source: photo.dataUrl ? { uri: photo.dataUrl } : photo.path ? media(photo.path) : { uri: '' } }));
  const thumbs = useRef<(View | null)[]>([]);
  if (!photos.length) return null;
  const single = photos.length === 1;
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end', maxWidth: 264 }}>
    {photos.map((photo, index) => <Pressable key={index} ref={view => { thumbs.current[index] = view; }} accessibilityRole="imagebutton" accessibilityLabel={`${photo.name}. Open full screen`} onPress={() => open(photos, index, thumbs.current)}>
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
  const thumb = useRef<View>(null);
  if (!step.file || step.status !== 'done') return null;
  const image: ViewerImage = { source: media(step.file), name: step.file.split('/').pop() || 'Generated image' };
  return <Pressable accessibilityRole="imagebutton" accessibilityLabel="Generated image. Open full screen" ref={thumb} onPress={() => open([image], 0, [thumb.current])} style={{ width: 240 }}>
    <Image source={image.source} onLoad={({ nativeEvent }) => { const { width, height } = nativeEvent.source; if (width && height) setRatio(width / height); }} style={{ width: 240, aspectRatio: ratio, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.canvas }} />
    <View style={{ position: 'absolute', right: 8, top: 8, width: 30, height: 30, borderRadius: 10, backgroundColor: '#ffffffcc', alignItems: 'center', justifyContent: 'center' }}><Icon icon={Maximize01Icon} tone="ink" size={15} /></View>
  </Pressable>;
}
/** A step title with its code spans as chips, like desktop's; a running step's title shimmers. */
function StepTitle({ title, shimmer, style }: { title: string; shimmer: boolean; style: TextStyle }) {
  const spans = titleSpans(title).map((span, index) => span.code ? <Text key={index} style={{ fontFamily: fonts.mono, fontSize: (style.fontSize || 14) * 0.92, backgroundColor: shimmer ? undefined : colors.field, color: colors.ink }}>{span.text}</Text> : span.text);
  return shimmer ? <ShimmerText style={style}>{spans}</ShimmerText> : <Text numberOfLines={1} style={style}>{spans}</Text>;
}
/** One tool step. In the Chat a tap opens the activity sheet; in the sheet it expands to show the tool's output. */
export function ToolRow({ step, live, waiting, onPress }: { step: ChatStep; live: boolean; waiting: boolean; onPress?: () => void }) {
  const [open, setOpen] = useState(false);
  const running = live && step.status === 'running';
  const failed = step.status === 'failed';
  const expandable = !onPress && !!step.detail;
  return <View style={{ gap: 8 }}><Pressable accessibilityRole={onPress || expandable ? 'button' : 'text'} accessibilityState={expandable ? { expanded: open } : undefined} accessibilityLabel={`${step.title.replace(/`/g, '')}${failed ? ', Failed' : running ? waiting ? ', Waiting for approval' : ', Running' : ''}`} disabled={!onPress && !expandable} onPress={() => onPress ? onPress() : setOpen(!open)} style={({ pressed }) => ({ minHeight: 36, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.5 : 1 })}>
    <Icon icon={failed ? Alert02Icon : icons[step.kind]} tone={failed ? 'red' : running ? 'ink2' : 'ink3'} size={16} />
    <View style={{ flex: 1, gap: 2 }}>
      <StepTitle title={step.title} shimmer={running && !waiting} style={{ color: failed ? colors.red : colors.ink2, fontSize: 14 }} />
      {(step.note || (running && waiting)) && <Text style={styles.label}>{[running && waiting ? 'Waiting for approval' : '', step.note].filter(Boolean).join(' · ')}</Text>}
    </View>
    {(onPress || expandable) && <Icon icon={onPress ? ArrowRight01Icon : open ? ArrowUp01Icon : ArrowDown01Icon} tone="ink3" size={12} />}
  </Pressable>{open && step.detail && <PageScroll nestedScrollEnabled style={{ maxHeight: 320, backgroundColor: colors.field, borderRadius: 12 }} contentContainerStyle={{ padding: 12, paddingBottom: 12 }}>
    {step.kind === 'thinking' ? <Markdown text={step.detail} streaming={running} /> : <Text selectable style={styles.code}>{step.detail}</Text>}
  </PageScroll>}</View>;
}
const SPARKLE = 'M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z';
/** Desktop's ActivityBlock header: a sparkle, the running step's shimmering title or the summary, and failures. */
function ActivityRow({ steps, live, waiting, onPress }: { steps: ChatStep[]; live: boolean; waiting: boolean; onPress: () => void }) {
  const palette = hex(useColorScheme());
  const current = live ? [...steps].reverse().find(step => step.status === 'running') : undefined;
  const summary = activitySummary(steps);
  const label = current ? current.title : summary.text || 'Activity';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label.replace(/`/g, '')}${waiting ? ', waiting for approval' : ''}${!current && summary.failed ? `, ${summary.failed} failed` : ''}. Show activity`} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36, opacity: pressed ? 0.5 : 1 })}>
    <Svg width={16} height={16} viewBox="0 0 24 24"><Path d={SPARKLE} fill={current ? palette.ink2 : palette.ink3} /></Svg>
    <View style={{ flexShrink: 1 }}>{current ? <StepTitle title={current.title} shimmer={!waiting} style={{ color: colors.ink2, fontSize: 14 }} /> : <Text numberOfLines={1} style={{ color: colors.ink2, fontSize: 14 }}>{label}</Text>}</View>
    {waiting && <Text style={{ color: colors.ink3, fontSize: 12.5 }}>Waiting for approval</Text>}
    {!current && summary.failed > 0 && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon icon={Alert02Icon} tone="red" size={13} /><Text style={{ color: colors.red, fontSize: 12.5 }}>{summary.failed} failed</Text></View>}
    <View style={{ flex: 1 }} />
    <Icon icon={ArrowRight01Icon} tone="ink3" size={12} />
  </Pressable>;
}
export const ChatReply = memo(function ChatReply({ message, run, onActivity, media }: { message?: ChatMessage; run?: AgentRun; onActivity: (message: string) => void; media: MediaSource }) {
  const openActivity = () => onActivity(message ? String(message.id) : 'run');
  const text = run?.text ?? message?.body ?? '';
  const steps = run?.steps ?? message?.steps ?? [];
  const reply = replyActivity(text, steps);
  const waiting = !!(run?.approvals.length || run?.questions.length);
  const answer = reply.answer || (!run ? unspokenThought(reply.activity, reply.answer) : '');
  if (message?.role === 'user') return <View style={{ alignSelf: 'flex-end', alignItems: 'flex-end', gap: 6, maxWidth: '88%' }}>
    <Photos message={message} media={media} />
    {message.files?.filter(file => !message.images?.some(image => image.path === file || image.sourcePath === file)).map(file => <FileChip key={file} path={file} />)}
    {!!text && <View style={{ backgroundColor: colors.canvas, borderRadius: 18, borderCurve: 'continuous', paddingVertical: 10, paddingHorizontal: 14 }}><Text selectable style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>{text}</Text></View>}
  </View>;
  return <View style={{ gap: 14, paddingVertical: 8 }}>
    {reply.setup.map(step => <ToolRow key={step.id} step={step} live={!!run} waiting={waiting} onPress={openActivity} />)}
    {reply.activity.length === 1 && reply.activity[0].type === 'step' ? <ToolRow step={reply.activity[0].step} live={!!run} waiting={waiting} onPress={openActivity} />
      : reply.activity.length > 0 && <ActivityRow steps={reply.activity.flatMap(entry => entry.type === 'step' ? [entry.step] : [])} live={!!run} waiting={waiting} onPress={openActivity} />}
    {reply.images.map(step => <View key={step.id} style={{ gap: 6 }}><ToolRow step={step} live={!!run} waiting={waiting} onPress={openActivity} /><GeneratedImage step={step} media={media} /></View>)}
    {!!answer && <Markdown text={answer} streaming={!!run} />}
    {run?.tasks?.length ? <View style={[styles.card, { gap: 8 }]}>{run.tasks.map(task => <View key={task.id} style={[styles.row, { flexWrap: 'nowrap' }]}><Icon icon={task.status === 'completed' ? CheckmarkCircle02Icon : CircleIcon} tone={task.status === 'completed' ? 'green' : 'ink3'} size={16} /><Text style={[styles.muted, { flex: 1 }]}>{task.status === 'in_progress' ? task.activeForm || task.content : task.content}</Text></View>)}</View> : null}
    {!run && message?.outcome === 'cancelled' && <Text style={styles.muted}>Turn stopped</Text>}
    {!run && message?.outcome === 'failed' && <Text accessibilityRole="alert" style={{ color: colors.error }}>The turn failed. Review the response before trying again.</Text>}
    {!run && !text && !steps.length && !message?.outcome && <Text style={styles.muted}>No text response</Text>}
  </View>;
});
