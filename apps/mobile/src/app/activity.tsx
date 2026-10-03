import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { activitySummary, replyActivity } from '@milagre/shared/reply-parts';
import { ToolRow } from '../chat-reply';
import { Markdown } from '../markdown';
import { useSession } from '../session';
import { CircleButton, colors, styles } from '../ui';

/** A reply's tools and notes, like desktop's expanded ActivityBlock; live while the turn runs. Each tool expands to its output. */
export default function ActivitySheet() {
  const { id, message } = useLocalSearchParams<{ id: string; message: string }>();
  const session = useSession();
  const project = session.snapshot?.project;
  const chatId = `${project?.path}#${id}`;
  const run = message === 'run' ? session.snapshot?.runs.runs[chatId] : undefined;
  // When the live turn ends while the sheet is open, its saved reply takes over.
  const saved = message === 'run' ? (run ? undefined : project?.state.messages.filter(entry => entry.session_id === Number(id) && entry.role !== 'user').at(-1)) : project?.state.messages.find(entry => entry.id === Number(message));
  const steps = run?.steps ?? saved?.steps ?? [];
  const { setup, activity, images } = replyActivity(run?.text ?? saved?.body ?? '', steps);
  const waiting = !!(run?.approvals.length || run?.questions.length);
  const summary = activitySummary(steps);
  return <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
      <CircleButton label="Close" icon={Cancel01Icon} onPress={() => router.back()} />
      <View style={{ alignItems: 'center', flexShrink: 1 }}>
        <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 17, fontWeight: '600' }}>Activity</Text>
        {!!summary.text && <Text numberOfLines={1} style={{ color: colors.ink3, fontSize: 12 }}>{run ? 'Running' : summary.text}</Text>}
      </View>
      <View style={{ width: 40 }} />
    </View>
    <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
      {!steps.length && <Text style={styles.muted}>No activity yet.</Text>}
      {setup.map(step => <ToolRow key={step.id} step={step} live={!!run} waiting={waiting} />)}
      {activity.map((entry, index) => entry.type === 'step' ? <ToolRow key={entry.step.id} step={entry.step} live={!!run} waiting={waiting} /> : <View key={`text-${index}`} style={{ paddingVertical: 6 }}><Markdown text={entry.text} /></View>)}
      {images.map(step => <ToolRow key={step.id} step={step} live={!!run} waiting={waiting} />)}
    </View>
  </ScrollView>;
}
