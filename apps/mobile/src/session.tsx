import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { createClient, type Client, type OpenProject, type RecentProject, type Snapshot } from './client';
import { savedConnection } from './connection-native';
import type { AgentCliStatus, AgentModels } from '@milagre/shared/model';
import type { Attachment } from './attachments';
import type { TurnPreferences } from './turn-options';

function useSessionState() {
  const [client, setClient] = useState<Client | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>({});
  const [preferences, setPreferences] = useState<Record<string, TurnPreferences>>({});
  const [models, setModels] = useState<AgentModels | null>(null);
  const [cliStatus, setCliStatus] = useState<AgentCliStatus | null>(null);
  const [providerError, setProviderError] = useState('');
  const generation = useRef(0);
  const selection = useRef<{ client: Client; path: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!client || process.env.EXPO_PUBLIC_DEMO === '1') return;
    void Promise.all([client.call<AgentModels>('agent:models'), client.call<AgentCliStatus>('agent:cli-status')]).then(([models, status]) => {
      if (!cancelled) { setModels(models); setCliStatus(status); }
    }).catch(() => { if (!cancelled) setProviderError('Could not check the installed agents. Reconnect to check again.'); });
    return () => { cancelled = true; };
  }, [client]);
  const connect = async (address: string, token: string, remember = true) => {
    const next = createClient(address, token);
    const current = ++generation.current;
    const previous = selection.current;
    selection.current = null;
    try {
      await next.call('daemon:status');
      const projects = await next.call<RecentProject[]>('project:recent');
      if (current !== generation.current) return false;
      if (process.env.EXPO_PUBLIC_DEMO !== '1') {
        try {
          if (remember) await savedConnection.save({ address: next.url, token: token.trim() });
          else await savedConnection.forget();
        } catch { throw new Error('Could not save this connection on your device. Turn off Remember this computer to connect without saving it.'); }
      }
      if (current !== generation.current) return false;
      setModels(null); setCliStatus(null); setProviderError('');
      setClient(next); setRecent(projects); setSnapshot(null); setError('');
      return true;
    } catch (error) {
      if (current === generation.current) selection.current = previous;
      throw error;
    }
  };
  const open = async (projectPath: string) => {
    if (!client) throw new Error('Connect to your computer first.');
    const current = ++generation.current;
    const previous = selection.current;
    selection.current = null;
    try {
      const project = await client.call<OpenProject>('project:open', [projectPath]);
      const state = await client.snapshot(project.path);
      if (current === generation.current) {
        selection.current = { client, path: project.path };
        setSnapshot(state); setError('');
      }
    } catch (error) {
      if (current === generation.current) selection.current = previous;
      throw error;
    }
  };
  const projectPath = snapshot?.project.path;
  const refresh = useCallback(async () => {
    const current = selection.current;
    if (!client || !projectPath || current?.client !== client || current.path !== projectPath) return;
    try {
      const state = await client.snapshot(projectPath);
      if (current === selection.current) { setSnapshot(state); setError(''); }
    } catch (error) {
      if (current === selection.current) throw error;
    }
  }, [client, projectPath]);
  useEffect(() => {
    if (!client || !projectPath) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    async function poll() {
      if (cancelled || inFlight || AppState.currentState !== 'active') return;
      inFlight = true;
      try { await refresh(); } catch (e) { if (!cancelled) setError((e as Error).message); }
      finally { inFlight = false; if (!cancelled) timer = setTimeout(poll, 1000); }
    }
    void poll();
    const subscription = AppState.addEventListener('change', state => { clearTimeout(timer); if (state === 'active') void poll(); });
    return () => { cancelled = true; clearTimeout(timer); subscription.remove(); };
  }, [client, projectPath, refresh]);
  const selected = selection.current;
  const isSelected = () => selected !== null && selection.current === selected;
  const disconnect = () => { generation.current++; selection.current = null; setClient(null); setSnapshot(null); setError(''); };
  return { client, recent, snapshot, error, setError, drafts, setDrafts, attachments, setAttachments, preferences, setPreferences, models, cliStatus, providerError, connect, open, refresh, isSelected, disconnect };
}
const SessionContext = createContext<ReturnType<typeof useSessionState> | null>(null);
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const session = useSessionState();
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('SessionProvider is required');
  return session;
}
