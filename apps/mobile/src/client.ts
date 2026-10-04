import type { ChatMessage, CoordinatorState } from '@milagre/shared/model';
import type { AgentRuns } from '@milagre/shared/agent-runs';
import { openLive, type LiveOptions } from './live.ts';

export type OpenProject = { path: string; name: string; state: CoordinatorState };
/** A Project's streaming turns; `seq` numbers the last event they hold. */
export type Runs = { runs: AgentRuns; seq?: number };
export type Snapshot = { project: OpenProject; runs: Runs };
export type RecentProject = { path: string; name?: string };

/** A Cloudflare Access service token: the edge drops any request to the host's tunnel without it. */
export type Access = { id: string; secret: string };
export function validAccess(value: unknown): Access | undefined {
  const access = value as Partial<Access> | undefined;
  if (!access?.id && !access?.secret) return undefined;
  if (!/^[a-f0-9]{32}\.access$/.test(String(access.id)) || !/^[A-Za-z0-9_-]{32,128}$/.test(String(access.secret))) throw new Error('This computer\'s Cloudflare access token is not valid. Scan its code again.');
  return { id: String(access.id), secret: String(access.secret) };
}

export function localEndpoint(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('Enter your computer\'s HTTPS address or a local simulator address.'); }
  const local = url.protocol === 'http:' && ['127.0.0.1', '10.0.2.2'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTPS address, or 127.0.0.1 on iOS / 10.0.2.2 on Android for a local simulator. Enter the token separately.');
  }
  return url.origin;
}

export function createClient(address: string, token: string, fetcher: typeof fetch = fetch, timeoutMs = 30000, access?: Access) {
  const url = localEndpoint(address);
  if (access && !url.startsWith('https:')) throw new Error('A Cloudflare access token needs an HTTPS address.');
  // The last snapshot per route and its ETag: an unchanged Project answers 304 instead of megabytes.
  const cached = new Map<string, { etag: string; value: unknown }>();
  const auth = { Authorization: `Bearer ${token.trim()}`, ...(access ? { 'CF-Access-Client-Id': access.id, 'CF-Access-Client-Secret': access.secret } : {}) };
  async function request<T>(route: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        const previous = body === undefined ? cached.get(route) : undefined;
        response = await fetcher(url + route, { method: body === undefined ? 'GET' : 'POST',
          headers: { ...auth, 'Content-Type': 'application/json', ...(previous ? { 'If-None-Match': previous.etag } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, redirect: 'error' });
      } catch {
        throw new Error('Connection lost. Reconnect to your computer. Check the Chat before sending again.');
      }
      if (response.redirected || (response.url && new URL(response.url).origin !== url)) throw new Error('The computer address redirected. Enter its direct HTTPS address.');
      if (response.status === 304 && cached.has(route)) return cached.get(route)!.value as T;
      let value;
      // Cloudflare and proxies answer with an HTML page when the request never reaches the host.
      try { value = JSON.parse(await response.text()); }
      catch {
        throw new Error([401, 403].includes(response.status) ? 'Your computer\'s Cloudflare access was refused. Scan its pairing code again.'
          : response.status >= 500 ? 'Your computer isn\'t answering. Check that Milagre and its mobile host are running on your Mac.'
          : `Unexpected response from your computer (${response.status}).`);
      }
      if (value?.v !== 1) throw new Error('Incompatible daemon response. Update the app and daemon together.');
      if (!response.ok || value.error) throw new Error(value.error?.message || `Request failed (${response.status})`);
      const etag = response.headers?.get?.('etag');
      if (body === undefined && etag) cached.set(route, { etag, value: value.result });
      return value.result as T;
    } finally { clearTimeout(timeout); }
  }
  return {
    url,
    upload: (projectPath: string, name: string, base64: string) => request<{ path: string; name: string }>('/attachments', { projectPath, name, base64 }),
    call: <T,>(method: string, args: unknown[] = []) => request<T>('/rpc', { v: 1, method, args }),
    /** An image file on the computer, served by the bridge only from the Project's Worktrees and Milagre's image folders. */
    media: (projectPath: string, path: string) => ({ uri: `${url}/media?projectPath=${encodeURIComponent(projectPath)}&path=${encodeURIComponent(path)}`, headers: auth }),
    /** One message with its tools' full output; the snapshot leaves that out. */
    message: (projectPath: string, id: number) => request<ChatMessage>(`/message?projectPath=${encodeURIComponent(projectPath)}&id=${id}`),
    snapshot: (projectPath: string) => request<Snapshot>('/snapshot?projectPath=' + encodeURIComponent(projectPath)),
    /** Just the Project's streaming turns: what a live "runs" signal fetches instead of the whole snapshot. */
    runs: (projectPath: string) => request<Runs>('/runs?projectPath=' + encodeURIComponent(projectPath)),
    /** The Project's live socket, through the same tunnel and Access headers as every request. */
    live: (projectPath: string, options: LiveOptions) => openLive(`${url.replace(/^http/, 'ws')}/live?projectPath=${encodeURIComponent(projectPath)}`, auth, options),
  };
}
export type Client = ReturnType<typeof createClient>;
