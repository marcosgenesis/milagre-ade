import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { useSession } from '../session';
import { SubagentItem } from '../subagent-item';
import { CircleButton, PageScroll, colors, styles } from '../ui';

/** The Chat's subagents, like desktop's subagent popover: status, latest activity and the end of each transcript. */
export default function AgentsSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const agents = (session.snapshot?.project.state.sessions[Number(id)]?.subagents || []).filter(agent => !agent.archived);
  return <PageScroll style={styles.screen} contentContainerStyle={{ padding: 0, gap: 0, paddingBottom: 40 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, backgroundColor: colors.page }}>
      <CircleButton label="Close" icon={Cancel01Icon} onPress={() => router.back()} />
      <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 17, fontWeight: '600' }}>Subagents</Text>
      <View style={{ width: 40 }} />
    </View>
    <View style={{ paddingHorizontal: 20, paddingTop: 4, gap: 2 }}>
      {!agents.length && <Text style={styles.muted}>No subagents in this Chat.</Text>}
      {agents.map(agent => <SubagentItem key={agent.id} agent={agent} />)}
    </View>
  </PageScroll>;
}
