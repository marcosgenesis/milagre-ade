import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Archive02Icon, Cancel01Icon } from '@hugeicons/core-free-icons';
import { subagentFinished } from '@milagre/shared/project-edits';
import { useSession } from '../session';
import { SubagentItem } from '../subagent-item';
import { Icon } from '../icons';
import { CircleButton, ErrorNotice, IconButton, ListRow, PageScroll, colors, styles } from '../ui';

/** The Chat's subagents, like desktop's subagent popover: status, latest activity and the end of each transcript. */
export default function AgentsSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const project = session.snapshot?.project;
  const chat = project?.state.sessions[Number(id)];
  const agents = chat?.subagents || [];
  const visible = agents.filter(agent => !agent.archived);
  const disabled = busy || !session.client || !chat;

  async function archive(agentId?: string) {
    if (pending.current || !session.client || !project || !chat) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      session.expectActivity();
      if (agentId === undefined) await session.client.call('chat:archive-finished-subagents', [project.path, chat.id]);
      else await session.client.call('chat:archive-subagent', [project.path, chat.id, agentId, true]);
      await session.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <PageScroll style={styles.screen} contentContainerStyle={{ padding: 0, gap: 0, paddingBottom: 40 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, backgroundColor: colors.page }}>
      <CircleButton label="Close" icon={Cancel01Icon} onPress={() => router.back()} />
      <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 17, fontWeight: '600' }}>Subagents</Text>
      <View style={{ width: 40 }} />
    </View>
    <View style={{ paddingHorizontal: 20, paddingTop: 4, gap: 2 }}>
      <ListRow title="Archive finished subagents" leading={<Icon icon={Archive02Icon} tone="ink2" size={20} />} trailing={<View />} disabled={disabled || !visible.some(subagentFinished)} onPress={() => archive()} />
      {error ? <ErrorNotice message={error} /> : null}
      {!visible.length && <Text style={[styles.muted, { paddingVertical: 16 }]}>No subagents to show.</Text>}
      {visible.map(agent => <View key={agent.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
        <View style={{ flex: 1, paddingTop: 4 }}><SubagentItem agent={agent} /></View>
        <IconButton label={`Archive ${agent.title}`} icon={Archive02Icon} size={44} disabled={disabled} onPress={() => archive(agent.id)} />
      </View>)}
    </View>
  </PageScroll>;
}
