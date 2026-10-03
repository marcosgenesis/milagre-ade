import type { CoordinatorState } from '@milagre/shared/model';
import type { AgentRuns } from '@milagre/shared/agent-runs';

export type OpenProject = { path: string; name: string; state: CoordinatorState };
export type Snapshot = { project: OpenProject; runs: { runs: AgentRuns } };
export type RecentProject = { path: string; name?: string };

export function localEndpoint(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('Enter your computer\'s HTTPS address or a local simulator address.'); }
  const local = url.protocol === 'http:' && ['127.0.0.1', '10.0.2.2'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTPS address, or 127.0.0.1 on iOS / 10.0.2.2 on Android for a local simulator. Enter the token separately.');
  }
  return url.origin;
}

export function createClient(address: string, token: string, fetcher: typeof fetch = fetch, timeoutMs = 30000) {
  const url = localEndpoint(address);
  async function request<T>(route: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetcher(url + route, { method: body === undefined ? 'GET' : 'POST',
          headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, redirect: 'error' });
      } catch {
        throw new Error('Connection lost. Reconnect to your computer. Check the Chat before sending again.');
      }
      if (response.redirected || (response.url && new URL(response.url).origin !== url)) throw new Error('The computer address redirected. Enter its direct HTTPS address.');
      const value = await response.json();
      if (value?.v !== 1) throw new Error('Incompatible daemon response. Update the app and daemon together.');
      if (!response.ok || value.error) throw new Error(value.error?.message || `Request failed (${response.status})`);
      return value.result as T;
    } finally { clearTimeout(timeout); }
  }
  return {
    url,
    upload: (projectPath: string, name: string, base64: string) => request<{ path: string; name: string }>('/attachments', { projectPath, name, base64 }),
    call: <T,>(method: string, args: unknown[] = []) => request<T>('/rpc', { v: 1, method, args }),
    snapshot: (projectPath: string) => request<Snapshot>('/snapshot?projectPath=' + encodeURIComponent(projectPath)),
  };
}
export type Client = ReturnType<typeof createClient>;
