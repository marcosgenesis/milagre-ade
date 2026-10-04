import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ArrowDown01Icon } from '@hugeicons/core-free-icons';
import type { Subagent } from '@milagre/shared/model';
import { Icon, SpinnerRing } from './icons';
import { colors, styles } from './ui';

const LABELS: Record<string, string> = { initializing: 'Starting', running: 'Running', waiting: 'Waiting', completed: 'Done', failed: 'Failed', cancelled: 'Stopped' };

/** An inline summary; only the disclosure control toggles its details. */
export function SubagentItem({ agent }: { agent: Subagent }) {
  const [expanded, setExpanded] = useState(false);
  const status = LABELS[agent.status] || agent.status;
  return <View style={{ gap: 4 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 }}>
      {['running', 'initializing'].includes(agent.status) && <SpinnerRing size={13} />}
      <Text selectable style={{ color: colors.ink2, fontSize: 13, flex: 1 }} numberOfLines={expanded ? undefined : 1}>{agent.title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? 'Hide' : 'Show'} details for ${agent.title}, ${status}`} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} hitSlop={4} style={({ pressed }) => ({ flexDirection: 'row', gap: 4, paddingLeft: 4, paddingRight: 16, minWidth: 44, minHeight: 36, alignItems: 'center', justifyContent: 'flex-end', opacity: pressed ? 0.5 : 1 })}>
        <Text style={{ color: agent.status === 'failed' ? colors.red : agent.status === 'waiting' ? colors.orange : colors.ink3, fontSize: 12 }}>{status}</Text>
        <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}><Icon icon={ArrowDown01Icon} tone="ink3" size={12} /></View>
      </Pressable>
    </View>
    {expanded && <View style={{ gap: 8, paddingBottom: 8 }}>
      {!!agent.latestActivity && <Text selectable style={styles.caption}>{agent.latestActivity}</Text>}
      {agent.transcript.slice(-4).map(item => <Text key={item.id} selectable style={item.kind === 'tool' ? [styles.code, { fontSize: 12, color: colors.ink2 }] : { color: colors.ink2, fontSize: 13, lineHeight: 18 }}>{item.text}</Text>)}
    </View>}
  </View>;
}
