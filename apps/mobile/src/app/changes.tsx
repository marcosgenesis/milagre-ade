import { useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import type { DiffFilesResult, DiffMode } from '@milagre/shared/git-diff';
import { useSession } from '../session';
import { useRpc } from '../use-rpc';
import { Button, ErrorNotice, PageScroll, Select, colors, styles } from '../ui';

export default function Changes() {
  const { worktreeId } = useLocalSearchParams<{ worktreeId: string }>();
  const session = useSession();
  const worktree = session.snapshot?.project.state.worktrees[Number(worktreeId)];
  const [mode, setMode] = useState<DiffMode>('uncommitted');
  const { data: result, error, refresh } = useRpc<DiffFilesResult>(worktree ? session.client : null, 'git:diff-files', [{ cwd: worktree?.path, base: worktree?.base, mode }]);
  if (!session.client || !session.snapshot || !worktree) return <Redirect href="/" />;
  return <PageScroll><Text style={styles.label}>CHANGES</Text><Text style={styles.title}>{worktree.name}</Text>
    <Select label="Compare" value={mode} options={[{ value: 'uncommitted', title: 'Uncommitted changes' }, { value: 'committed', title: 'Branch changes' }]} onChange={value => setMode(value as DiffMode)} />
    <Button title="Refresh changes" secondary onPress={refresh} />
    {error ? <ErrorNotice message={error} /> : !result ? <Text style={styles.muted}>Reading changes...</Text> : !result.isRepo ? <Text style={styles.muted}>{result.message}</Text> : <>
      <Text style={styles.muted}>{result.base ? `Compared with ${result.base}` : 'Compared with the last commit'}</Text>
      {!result.files.length && <Text style={styles.muted}>{result.message || 'No changes in this view.'}</Text>}
      {result.files.map(file => <View style={styles.card} key={file.path}><Text style={styles.label}>{file.status.toUpperCase()}</Text><Button title={file.path} secondary onPress={() => router.push({ pathname: '/diff', params: { worktreeId, mode, path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}), untracked: file.untracked ? '1' : '0', ...(result.base ? { base: result.base } : {}) } })} /><Text style={{ color: colors.green }}>{file.binary ? 'Binary file' : `+${file.added} / -${file.removed}`}</Text></View>)}
    </>}
  </PageScroll>;
}
