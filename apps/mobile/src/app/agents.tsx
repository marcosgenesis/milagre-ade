import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { useSession } from '../session';
import { SpinnerRing } from '../icons';
import { CircleButton, colors, styles } from '../ui';

const LABELS: Record<string, string> = { initializing: 'Starting', running: 'Running', waiting: 'Waiting', completed: 'Done', failed: 'Failed', cancelled: 'Stopped' };

/** The Chat's subagents, like desktop's subagent popover: status, latest activity and the end of each transcript. */
export default function AgentsSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const agents = (session.snapshot?.project.state.sessions[Number(id)]?.subagents || []).filter(agent => !agent.archived);
  return <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, backgroundColor: colors.page }}>
      <CircleButton label="Close" icon={Cancel01Icon} onPress={() => router.back()} />
      <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 17, fontWeight: '600' }}>Subagents</Text>
      <View style={{ width: 40 }} />
    </View>
    <View style={{ padding: 16, gap: 12 }}>
      {!agents.length && <Text style={styles.muted}>No subagents in this Chat.</Text>}
      {agents.map(agent => <View key={agent.id} style={[styles.card, { gap: 8 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {['running', 'initializing'].includes(agent.status) && <SpinnerRing size={13} />}
          <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '600', flex: 1 }} numberOfLines={2}>{agent.title}</Text>
          <Text style={{ color: agent.status === 'failed' ? colors.red : agent.status === 'waiting' ? colors.orange : colors.ink3, fontSize: 12 }}>{LABELS[agent.status] || agent.status}</Text>
        </View>
        {!!agent.latestActivity && <Text style={styles.caption}>{agent.latestActivity}</Text>}
        {agent.transcript.slice(-4).map(item => <Text key={item.id} selectable numberOfLines={6} style={item.kind === 'tool' ? [styles.code, { fontSize: 12, color: colors.ink2 }] : { color: colors.ink2, fontSize: 13, lineHeight: 18 }}>{item.text}</Text>)}
      </View>)}
    </View>
  </ScrollView>;
}
