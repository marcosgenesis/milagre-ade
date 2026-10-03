import { Text } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import type { DiffFileResult } from '@milagre/shared/git-diff';
import { useSession } from '../session';
import { useRpc } from '../use-rpc';
import { ErrorNotice, PageScroll, colors, styles } from '../ui';

export default function Diff() {
  const params = useLocalSearchParams<{ worktreeId: string; path: string; oldPath?: string; untracked?: string; mode: string; base?: string }>();
  const session = useSession();
  const worktree = session.snapshot?.project.state.worktrees[Number(params.worktreeId)];
  const { path, oldPath, untracked, mode, base } = params;
  const { data: result, error } = useRpc<DiffFileResult>(worktree ? session.client : null, 'git:diff-file', [{ cwd: worktree?.path, path, oldPath, untracked: untracked === '1', mode, base }]);
  if (!session.client || !session.snapshot || !worktree) return <Redirect href="/" />;
  const lines = result?.patch.split('\n') || [];
  return <PageScroll><Text style={styles.label}>FILE DIFF</Text><Text selectable style={styles.subtitle}>{path}</Text>
    {error ? <ErrorNotice message={error} /> : !result ? <Text style={styles.muted}>Reading diff...</Text> : result.binary ? <Text style={styles.muted}>This is a binary file. Review it on your computer.</Text> : result.tooLarge ? <Text style={styles.muted}>This diff is too large for the preview. Review it on your computer.</Text> : !result.patch ? <Text style={styles.muted}>No diff remains for this file. Refresh changes to see its current state.</Text> : <>
      {lines.length > 600 && <Text style={styles.muted}>Showing the first 600 lines. Open this file on your computer for the full diff.</Text>}
      <Text selectable style={styles.code}>{lines.slice(0, 600).map((line, index) => <Text key={index} style={{ color: line.startsWith('+') ? colors.green : line.startsWith('-') ? colors.error : line.startsWith('@@') ? colors.accent : colors.text }}>{line}{'\n'}</Text>)}</Text>
    </>}
  </PageScroll>;
}
