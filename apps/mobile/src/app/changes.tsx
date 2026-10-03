import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import { ArrowDown01Icon, ArrowRight01Icon, File01Icon } from '@hugeicons/core-free-icons';
import type { DiffFileEntry, DiffFilesResult, DiffMode } from '@milagre/shared/git-diff';
import { buildDiffTree, type DiffTreeNode } from '@milagre/shared/diff-tree';
import { useSession } from '../session';
import { useRpc } from '../use-rpc';
import { Counts, StatusBox } from '../diff-ui';
import { Icon } from '../icons';
import { ErrorNotice, PageScroll, Segmented, colors, styles } from '../ui';

const MODES = [{ value: 'uncommitted', title: 'Uncommitted' }, { value: 'committed', title: 'Committed' }];

/** Desktop's ChangesPanel: the Worktree's changed files as a folder tree with counts and status boxes. */
export default function Changes() {
  const { worktreeId } = useLocalSearchParams<{ worktreeId: string }>();
  const session = useSession();
  const worktree = session.snapshot?.project.state.worktrees[Number(worktreeId)];
  const [mode, setMode] = useState<DiffMode>('uncommitted');
  const [refreshing, setRefreshing] = useState(false);
  const { data: result, error, refresh } = useRpc<DiffFilesResult>(worktree ? session.client : null, 'git:diff-files', [{ cwd: worktree?.path, base: worktree?.base, mode }]);
  const files = result?.isRepo ? result.files : undefined;
  const tree = useMemo(() => buildDiffTree(files ?? []), [files]);
  if (!session.client || !session.snapshot || !worktree) return <Redirect href="/" />;
  const added = files?.reduce((sum, file) => sum + file.added, 0) ?? 0;
  const removed = files?.reduce((sum, file) => sum + file.removed, 0) ?? 0;
  const base = result?.isRepo ? result.base : null;
  const open = (file: DiffFileEntry) => router.push({ pathname: '/diff', params: { worktreeId, mode, path: file.path, status: file.status, added: String(file.added), removed: String(file.removed), ...(file.oldPath ? { oldPath: file.oldPath } : {}), untracked: file.untracked ? '1' : '0', binary: file.binary ? '1' : '0', ...(base ? { base } : {}) } });
  const empty = !result ? 'Reading changes…' : !result.isRepo ? result.message : mode === 'committed' && base === null ? 'No base branch to compare with.' : files?.length ? '' : result.message || (mode === 'uncommitted' ? 'No uncommitted changes.' : 'Nothing committed since the base branch.');
  return <PageScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); refresh(); setTimeout(() => setRefreshing(false), 400); }} />} contentContainerStyle={{ gap: 12 }}>
    <Stack.Screen options={{ title: 'Changes' }} />
    <Segmented label="Changes mode" value={mode} options={MODES} onChange={value => setMode(value as DiffMode)} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
      <Text numberOfLines={1} style={[styles.caption, { flex: 1 }]}>{worktree.name}{mode === 'committed' && base ? ` · since ${base}` : ''}</Text>
      {!!files?.length && <Counts added={added} removed={removed} size={13} />}
    </View>
    {error ? <ErrorNotice message={error} retry={refresh} />
      : empty ? <Text style={[styles.muted, { textAlign: 'center', paddingVertical: 32 }]}>{empty}</Text>
      : <View style={[styles.card, { paddingVertical: 4, paddingHorizontal: 0, gap: 0 }]}><Tree nodes={tree} depth={0} onOpen={open} /></View>}
  </PageScroll>;
}

function Tree({ nodes, depth, onOpen }: { nodes: DiffTreeNode<DiffFileEntry>[]; depth: number; onOpen: (file: DiffFileEntry) => void }) {
  return <>{nodes.map(node => <TreeRow key={node.path} node={node} depth={depth} onOpen={onOpen} />)}</>;
}

function TreeRow({ node, depth, onOpen }: { node: DiffTreeNode<DiffFileEntry>; depth: number; onOpen: (file: DiffFileEntry) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const row = { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingLeft: 12 + depth * 14, paddingRight: 14 } as const;
  if (node.type === 'file') return <Pressable accessibilityRole="button" accessibilityLabel={`${node.name}, ${node.file.status}`} onPress={() => onOpen(node.file)} style={({ pressed }) => [row, { backgroundColor: pressed ? colors.hover : 'transparent' }]}>
    <Icon icon={File01Icon} tone="ink3" size={16} strokeWidth={1.6} />
    <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.text, { flex: 1, fontSize: 15 }]}>{node.name}</Text>
    {!node.file.binary && <Counts added={node.file.added} removed={node.file.removed} />}
    <StatusBox status={node.file.status} />
  </Pressable>;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${node.name} folder`} accessibilityState={{ expanded: !collapsed }} onPress={() => setCollapsed(value => !value)} style={({ pressed }) => [row, { backgroundColor: pressed ? colors.hover : 'transparent' }]}>
      <Icon icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon} tone="ink3" size={15} />
      <Text numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, color: colors.ink2, fontSize: 15 }}>{node.name}</Text>
      <Counts added={node.added} removed={node.removed} />
    </Pressable>
    {!collapsed && <Tree nodes={node.children} depth={depth + 1} onOpen={onOpen} />}
  </>;
}
