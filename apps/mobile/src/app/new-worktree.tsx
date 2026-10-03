import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSession } from '../session';
import { Button, ErrorNotice, Field, PageScroll, Select, styles } from '../ui';

export default function NewWorktree() {
  const session = useSession();
  const projectPath = session.snapshot?.project.path;
  const [branches, setBranches] = useState<string[]>([]);
  const [base, setBase] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (session.client && projectPath) void session.client.call<string[]>('project:branches', [projectPath]).then(items => { if (!cancelled) { setBranches(items); setBase(items.includes('main') ? 'main' : items[0] || ''); } }).catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [session.client, projectPath]);
  if (!session.client || !session.snapshot) return <Redirect href="/" />;
  async function create() {
    setBusy(true); setError('');
    try {
      const result = await session.client!.call<{ worktreeId: number; setupNote?: string }>('worktree:create', [{ projectPath, baseBranch: base, prompt: prompt.trim() }]);
      await session.open(projectPath!);
      session.setDrafts(current => ({ ...current, [`${projectPath}#new:${result.worktreeId}`]: prompt.trim() }));
      router.replace({ pathname: '/chat', params: { worktreeId: String(result.worktreeId) } });
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <PageScroll><Text style={styles.title}>New Worktree</Text><Text style={styles.muted}>Create an isolated checkout on your computer. Its setup runs before the first message.</Text>
    <Select label="Base branch" value={base} options={branches.map(value => ({ value, title: value }))} onChange={setBase} disabled={busy} />
    <Field label="What will you work on?" value={prompt} onChangeText={setPrompt} multiline placeholder="Describe the work. It will start as a draft in the new Chat." />
    <Button title={busy ? 'Creating Worktree...' : 'Create Worktree'} disabled={busy || !base || !prompt.trim()} onPress={() => void create()} />
    {error ? <ErrorNotice message={error} /> : null}
  </PageScroll>;
}
