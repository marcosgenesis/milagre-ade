import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, Linking, Pressable, Text, View } from 'react-native';
import { BubbleChatIcon, GitPullRequestIcon, ShieldAlertIcon, Alert02Icon } from '@hugeicons/core-free-icons';
import type { PullRequest, Subagent, Worktree } from '@milagre/shared/model';
import { BLOCKERS, pullRequestBlockers } from '@milagre/shared/pr-blockers';
import { agentCounts, MARK_LABEL, type ChatMark } from './indicators';
import { useSession } from './session';
import { readPullRequest } from './pr-status';
import { Icon, SpinnerRing } from './icons';
import { colors } from './ui';

/** The open PR for a Worktree. Slow GitHub lookups are pooled and cached, and stop while the screen is hidden. */
export function usePullRequest(worktree?: Worktree) {
  const session = useSession();
  const [pr, setPr] = useState<PullRequest | null>(null);
  useFocusEffect(useCallback(() => {
    if (!worktree || !session.client) return;
    const client = session.client;
    let focused = true;
    const active = () => focused && AppState.currentState === 'active';
    const refresh = () => void readPullRequest(client, worktree.path, active).then(value => { if (active() && value !== undefined) setPr(value); }).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 30000);
    const subscription = AppState.addEventListener('change', refresh);
    return () => { focused = false; clearInterval(timer); subscription.remove(); };
  }, [session.client, worktree?.path])); // eslint-disable-line react-hooks/exhaustive-deps
  return pr;
}

/** Desktop's chat mark slot: a question bubble, an approval shield, a spinning ring, an unread dot, or a faint idle dot. */
export function ChatMarkIcon({ mark }: { mark: ChatMark }) {
  const body = mark === 'question' ? <Icon icon={BubbleChatIcon} tone="accent" size={15} strokeWidth={2} />
    : mark === 'waiting' ? <Icon icon={ShieldAlertIcon} tone="orange" size={15} strokeWidth={2} />
    : mark === 'interrupted' ? <Icon icon={Alert02Icon} tone="orange" size={15} strokeWidth={2} />
    : mark === 'running' ? <SpinnerRing size={14} />
    : <View style={{ width: mark === 'idle' ? 6 : 8, height: mark === 'idle' ? 6 : 8, borderRadius: 4, backgroundColor: mark === 'unread' ? colors.accent : mark === 'failed' ? colors.red : colors.idleDot }} />;
  return <View accessible={mark !== 'idle'} accessibilityLabel={MARK_LABEL[mark] || undefined} style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>{body}</View>;
}

/** Desktop sidebar wording: "#142" in muted text, then the first blocker in its tone, "CI running" in orange, or "Ready" in green. */
export function PullRequestLabel({ pr, compact = false }: { pr: PullRequest; compact?: boolean }) {
  const blocker = pullRequestBlockers(pr)[0];
  const checking = pr.state === 'OPEN' && pr.checks === 'running' && !blocker;
  const ready = pr.state === 'OPEN' && !blocker && !checking && pr.conflictStatusKnown !== false;
  const tone = pr.state === 'MERGED' ? '#a855f7' : blocker ? (BLOCKERS[blocker].tone === 'red' ? colors.red : colors.orange) : checking ? colors.orange : colors.green;
  const status = pr.state === 'MERGED' ? 'Merged' : blocker ? BLOCKERS[blocker].short : checking ? 'CI running' : ready ? 'Ready' : '';
  // oxlint-disable-next-line unicorn/prefer-string-starts-ends-with -- pr comes unvalidated from the host's JSON response, so pr.url may be missing and startsWith would throw
  return <Pressable accessibilityRole="link" accessibilityLabel={`Pull request ${pr.number}${status ? `, ${status}` : ''}`} onPress={() => { if (/^https:\/\//.test(pr.url)) void Linking.openURL(pr.url).catch(() => {}); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
    <Icon icon={GitPullRequestIcon} tone="ink3" size={12} />
    <Text style={{ color: colors.ink3, fontSize: 13 }}>#{pr.number}</Text>
    {!!status && !compact && <Text style={{ color: tone, fontSize: 13 }}>{status}</Text>}
  </Pressable>;
}

/** Desktop's pullRequestAction chip: the first blocker's fix, sent to the agent. */
export function PullRequestAction({ pr, onRun, disabled }: { pr: PullRequest; onRun: () => void; disabled?: boolean }) {
  const blocker = pullRequestBlockers(pr)[0];
  if (!blocker) return null;
  const red = BLOCKERS[blocker].tone === 'red';
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onRun} style={({ pressed }) => ({ height: 28, paddingHorizontal: 11, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: red ? '#e3474c33' : '#ef720d33', backgroundColor: red ? colors.redTint : colors.orangeTint, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 })}>
    <Icon icon={GitPullRequestIcon} tone={red ? 'red' : 'orange'} size={14} />
    <Text style={{ color: red ? colors.red : colors.orange, fontSize: 12, fontWeight: '500' }}>{BLOCKERS[blocker].action}</Text>
  </Pressable>;
}

/** Desktop's SubagentTrack trigger: a white chip with a ring while any agent works. */
export function SubagentChip({ agents, onPress }: { agents: Subagent[]; onPress: () => void }) {
  const count = agentCounts(agents);
  if (!count.total) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Subagents, ${count.total}${count.running ? `, ${count.running} running` : ''}`} onPress={onPress} style={({ pressed }) => ({ height: 28, paddingHorizontal: 11, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 })}>
    {count.running > 0 && <SpinnerRing size={12} />}
    <Text style={{ color: count.failed ? colors.red : colors.ink2, fontSize: 12 }}>Subagents {count.total}</Text>
  </Pressable>;
}
