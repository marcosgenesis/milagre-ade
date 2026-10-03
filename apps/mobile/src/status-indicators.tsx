import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import type { AgentRun } from '@milagre/shared/agent-runs';
import type { AgentSession, ChatMessage, PullRequest, Subagent, Worktree } from '@milagre/shared/model';
import { BLOCKERS, pullRequestBlockers } from '@milagre/shared/pr-blockers';
import { agentCounts, chatIndicator } from './indicators';
import { useSession } from './session';
import { useRpc } from './use-rpc';
import { Icon, Sheet, colors, styles } from './ui';

export function ChatStatus({ chat, run, messages }: { chat?: AgentSession; run?: AgentRun; messages?: ChatMessage[] }) {
  const state = chatIndicator(chat, run, messages);
  const color = state.tone === 'error' ? colors.error : state.tone === 'attention' || state.tone === 'unread' ? colors.accent : colors.muted;
  return <View style={[styles.row, { gap: 6 }]}>{state.tone === 'running' ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon name={{ ios: state.tone === 'attention' ? 'hand.raised' : state.tone === 'error' ? 'exclamationmark.circle' : state.tone === 'unread' ? 'circle.fill' : 'checkmark.circle', android: state.tone === 'attention' ? 'pan_tool' : state.tone === 'error' ? 'error' : state.tone === 'unread' ? 'circle' : 'check_circle' }} size={14} color={color} />}<Text style={[styles.label, { color }]}>{state.label}</Text></View>;
}
export function AgentStatus({ agents }: { agents: Subagent[] }) {
  const [open, setOpen] = useState(false);
  const count = agentCounts(agents);
  if (!count.total) return null;
  const label = [`${count.total} agent${count.total === 1 ? '' : 's'}`, count.running ? `${count.running} running` : '', count.waiting ? `${count.waiting} waiting` : '', count.failed ? `${count.failed} failed` : ''].filter(Boolean).join(' · ');
  return <><Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} style={[styles.row, { gap: 6, minHeight: 44 }]}><Icon name={{ ios: 'person.2', android: 'group' }} size={18} color={count.failed ? colors.error : colors.muted} /><Text style={[styles.label, { color: count.failed ? colors.error : colors.muted }]}>{label}</Text></Pressable><Sheet title="Agents" visible={open} close={() => setOpen(false)}>{agents.filter(agent => !agent.archived).map(agent => <View key={agent.id} style={styles.card}><Text style={styles.subtitle}>{agent.title}</Text><Text style={[styles.label, { color: agent.status === 'failed' ? colors.error : colors.accent }]}>{agent.status}</Text>{!!agent.latestActivity && <Text style={styles.muted}>{agent.latestActivity}</Text>}{agent.transcript.slice(-5).map(item => <Text key={item.id} selectable style={styles.muted}>{item.text}</Text>)}</View>)}</Sheet></>;
}
export function WorktreeStatus({ worktree }: { worktree: Worktree }) {
  const session = useSession();
  const { data: pr, error, loading, refresh } = useRpc<PullRequest | null>(session.client, 'worktree:pull-request', [worktree.path]);
  // PR checks are much slower than local run snapshots. Keep them off the one-second polling path.
  useEffect(() => { const timer = setInterval(refresh, 30000); return () => clearInterval(timer); }, [session.client, worktree.path]); // eslint-disable-line react-hooks/exhaustive-deps
  return <View style={[styles.row, { gap: 10 }]}>{worktree.diff && <Text style={styles.label}>+{worktree.diff.added} / -{worktree.diff.removed}</Text>}{loading ? <Text style={styles.label}>Checking PR...</Text> : error ? <Text style={styles.label}>PR status unavailable</Text> : pr ? <Pressable accessibilityRole="link" accessibilityLabel={`Pull request ${pr.number}, ${pr.state}, ${pullRequestBlockers(pr).map(blocker => BLOCKERS[blocker].long).join(', ')}`} onPress={() => { if (/^https:\/\//.test(pr.url)) void Linking.openURL(pr.url).catch(() => {}); }} style={[styles.row, { gap: 6, minHeight: 44 }]}><Icon name={{ ios: 'arrow.triangle.pull', android: 'merge_type' }} size={16} /><Text style={styles.label}>#{pr.number}{pr.state === 'MERGED' ? ' · Merged' : ''}</Text>{pullRequestBlockers(pr).map(blocker => <Text key={blocker} style={[styles.label, { color: colors.error }]}>{BLOCKERS[blocker].short}</Text>)}{pr.checks === 'running' && <Text style={styles.label}>CI running</Text>}{pr.conflictStatusKnown === false && !pr.hasConflicts && pr.state === 'OPEN' && <Text style={styles.label}>Conflicts unknown</Text>}</Pressable> : null}</View>;
}
