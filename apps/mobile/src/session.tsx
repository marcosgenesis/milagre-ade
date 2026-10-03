import { reconcileState } from "@milagre/shared/reconcile";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { createClient, type Access, type Client, type OpenProject, type RecentProject, type Snapshot } from './client';
import { savedHosts } from './hosts-native';
import type { SavedHost } from './hosts-store';
import type { AgentCliStatus, AgentModels } from '@milagre/shared/model';
import type { Attachment } from './attachments';
import type { TurnPreferences } from './turn-options';

const hostOf = (url: string) => String(url || '').replace(/^https?:\/\//, '').replace(/[:/].*$/, '') || 'Computer';

function useSessionState() {
  const [client, setClient] = useState<Client | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [models, setModels] = useState<AgentModels | null>(null);
  const [cliStatus, setCliStatus] = useState<AgentCliStatus | null>(null);
  const [providerError, setProviderError] = useState('');
  const [hosts, setHosts] = useState<SavedHost[]>([]);
  const [hostName, setHostName] = useState('');
  const [booted, setBooted] = useState(false);
  const busyUntil = useRef(0);
  const generation = useRef(0);
  const selection = useRef<{ client: Client; path: string } | null>(null);
  // Launch may open the only saved computer once; after any connect or a Disconnect it never does again.
  const autoOpen = useRef(true);
  const claimAutoOpen = () => { const first = autoOpen.current; autoOpen.current = false; return first; };
  useEffect(() => {
    let cancelled = false;
    if (!client || process.env.EXPO_PUBLIC_DEMO === '1') return;
    void Promise.all([client.call<AgentModels>('agent:models'), client.call<AgentCliStatus>('agent:cli-status')]).then(([models, status]) => {
      if (!cancelled) { setModels(models); setCliStatus(status); }
    }).catch(() => { if (!cancelled) setProviderError('Could not check the installed agents. Reconnect to check again.'); });
    return () => { cancelled = true; };
  }, [client]);
  const loadHosts = useCallback(async () => {
    const list = await savedHosts.list();
    setHosts(list);
    return list;
  }, []);
  // Saved computers are read once at launch; the startup splash waits for them.
  useEffect(() => { void savedHosts.list().then(setHosts).catch(() => {}).finally(() => setBooted(true)); }, []);
  const connect = async (address: string, token: string, remember = true, name = '', access?: Access) => {
    const next = createClient(address, token, undefined, undefined, access);
    const current = ++generation.current;
    const previous = selection.current;
    selection.current = null;
    try {
      await next.call('daemon:status');
      const projects = await next.call<RecentProject[]>('project:recent');
      if (current !== generation.current) return false;
      if (process.env.EXPO_PUBLIC_DEMO !== '1') {
        if (remember) {
          try { await savedHosts.save({ name: name || hosts.find(host => host.id === next.url)?.name || hostOf(next.url), address: next.url, token: token.trim(), ...(access ? { access } : {}) }); }
          catch { throw new Error('Could not save this computer on your device. Try pairing again.'); }
          void loadHosts().catch(() => {});
        }
      }
      if (current !== generation.current) return false;
      setModels(null); setCliStatus(null); setProviderError('');
      autoOpen.current = false;
      setClient(next); setRecent(projects); setSnapshot(null); setError('');
      setHostName(name || hosts.find(host => host.id === next.url)?.name || hostOf(next.url));
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
        setSnapshot(previous => reconcileState(previous ?? undefined, state)); setError('');
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
      if (current === selection.current) { setSnapshot(previous => reconcileState(previous ?? undefined, state)); setError(''); }
    } catch (error) {
      if (current === selection.current) throw error;
    }
  }, [client, projectPath]);
  const live = useRef(false);
  const running = !!snapshot && Object.keys(snapshot.runs.runs).length > 0;
  useEffect(() => { live.current = running; }, [running]);
  /** Poll quickly for a while after the user acts, so a new turn shows up before its first event arrives. */
  const expectActivity = () => { busyUntil.current = Date.now() + 15000; };
  useEffect(() => {
    if (!client || !projectPath) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    async function poll() {
      if (cancelled || inFlight || AppState.currentState !== 'active') return;
      inFlight = true;
      try { await refresh(); } catch (e) { if (!cancelled) setError((e as Error).message); }
      // Live turns refresh every second; an idle Project only needs a slower check for changes made elsewhere.
      finally { inFlight = false; if (!cancelled) timer = setTimeout(poll, live.current || Date.now() < busyUntil.current ? 1000 : 4000); }
    }
    void poll();
    const subscription = AppState.addEventListener('change', state => { clearTimeout(timer); if (state === 'active') void poll(); });
    return () => { cancelled = true; clearTimeout(timer); subscription.remove(); };
  }, [client, projectPath, refresh]);
  const selected = selection.current;
  const isSelected = () => selected !== null && selection.current === selected;
  const disconnect = () => { autoOpen.current = false; generation.current++; selection.current = null; setClient(null); setSnapshot(null); setError(''); };
  return { booted, claimAutoOpen, hosts, loadHosts, hostName, expectActivity, client, recent, snapshot, error, setError, models, cliStatus, providerError, connect, open, refresh, isSelected, disconnect };
}
/**
 * Drafts, attachments and turn settings change on every keystroke, so they live in their own context: typing re-renders
 * only the composer's screens, not every screen that reads the connection and snapshot.
 */
function ComposerProvider({ children }: { children: React.ReactNode }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>({});
  const [preferences, setPreferences] = useState<Record<string, TurnPreferences>>({});
  const value = useMemo(() => ({ drafts, setDrafts, attachments, setAttachments, preferences, setPreferences }), [drafts, attachments, preferences]);
  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
}
type Composer = { drafts: Record<string, string>; setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; attachments: Record<string, Attachment[]>; setAttachments: React.Dispatch<React.SetStateAction<Record<string, Attachment[]>>>; preferences: Record<string, TurnPreferences>; setPreferences: React.Dispatch<React.SetStateAction<Record<string, TurnPreferences>>> };
const ComposerContext = createContext<Composer | null>(null);
export function useComposer() {
  const composer = useContext(ComposerContext);
  if (!composer) throw new Error('SessionProvider is required');
  return composer;
}
const SessionContext = createContext<ReturnType<typeof useSessionState> | null>(null);
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const session = useSessionState();
  return <SessionContext.Provider value={session}><ComposerProvider>{children}</ComposerProvider></SessionContext.Provider>;
}
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('SessionProvider is required');
  return session;
}
