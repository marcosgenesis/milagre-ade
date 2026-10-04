import type { ChatMessage, CoordinatorState } from '@milagre/shared/model';
import type { AgentRuns } from '@milagre/shared/agent-runs';
import { openLive, type Live, type LiveOptions } from './live.ts';
import type { RelayTransport } from './relay-transport.ts';

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

/** How the phone reaches a Mac with no tunnel: the public relay, the Mac's id there, and its pinned box key. */
export type RelayLink = { url: string; hostId: string; key: string };
export function validRelay(value: unknown): RelayLink {
  const relay = value as Partial<RelayLink> | undefined;
  const damaged = () => new Error('This pairing code is damaged. Scan the code again in Settings → Phone on your Mac.');
  let url: URL;
  try { url = new URL(String(relay?.url ?? '')); } catch { throw damaged(); }
  if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw damaged();
  if (!/^[A-Za-z0-9_-]{22}$/.test(String(relay?.hostId)) || !/^[A-Za-z0-9_-]{43}$/.test(String(relay?.key))) throw damaged();
  return { url: url.origin, hostId: String(relay!.hostId), key: String(relay!.key) };
}
/** A relay computer's address and saved id: there is no URL to show, so its id on the relay stands in. */
export const relayAddress = (hostId: string) => `relay://${hostId}`;

/** What a client needs to reach one computer: a direct address, or the relay. */
export type ClientHost = { address: string; token: string; access?: Access; relay?: RelayLink };
/** The phone's side of the relay, injected so this file stays free of native modules. */
export type RelayRuntime = {
  /** The one transport for this Mac, opened on first use and shared by every client. */
  transport(host: { relay: RelayLink; token: string }): Promise<RelayTransport>;
  /** Images fetched through the relay, kept as files in the cache folder. */
  files: { find(name: string): Promise<string | null>; write(name: string, bytes: Uint8Array): Promise<string> };
};

/** A short, stable file name for an image: FNV-1a twice over, plus the image's own extension. */
export function mediaName(text: string, path: string): string {
  const fnv = (seed: number) => {
    let hash = seed >>> 0;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
    return hash.toString(16).padStart(8, '0');
  };
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(path)?.[1]?.toLowerCase();
  return fnv(0x811c9dc5) + fnv(0x050c5d1f) + (ext ? `.${ext}` : '');
}

type Answer = { status: number; ok: boolean; etag?: string | null; text: () => Promise<string> };
const LOST = 'Connection lost. Reconnect to your computer. Check the Chat before sending again.';
const decoder = new TextDecoder();

export function createClient(host: ClientHost, fetcher: typeof fetch = fetch, timeoutMs = 30000, runtime?: RelayRuntime) {
  const relay = host.relay ? validRelay(host.relay) : undefined;
  if (relay && !runtime) throw new Error('This app cannot reach a Mac through the relay.');
  const access = relay ? undefined : host.access;
  const url = relay ? relayAddress(relay.hostId) : localEndpoint(host.address);
  if (access && !url.startsWith('https:')) throw new Error('A Cloudflare access token needs an HTTPS address.');
  const token = host.token.trim();
  // The last snapshot per route and its ETag: an unchanged Project answers 304 instead of megabytes.
  const cached = new Map<string, { etag: string; value: unknown }>();
  const auth = { Authorization: `Bearer ${token}`, ...(access ? { 'CF-Access-Client-Id': access.id, 'CF-Access-Client-Secret': access.secret } : {}) };
  // The Mac adds the token to every request it forwards; over the relay it only rides the handshake.
  const transport = () => runtime!.transport({ relay: relay!, token });

  async function overHttp(route: string, headers: Record<string, string>, body: string | undefined, signal: AbortSignal): Promise<Answer> {
    let response: Response;
    try {
      response = await fetcher(url + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...auth, ...headers }, body, signal, redirect: 'error' });
    } catch { throw new Error(LOST); }
    if (response.redirected || (response.url && new URL(response.url).origin !== url)) throw new Error('The computer address redirected. Enter its direct HTTPS address.');
    return { status: response.status, ok: response.ok, etag: response.headers?.get?.('etag'), text: () => response.text() };
  }

  /**
   * One request through the relay. The relay's own failures, and a phone key that can't be read, carry copy for the
   * user; anything else is a lost connection.
   */
  function overRelay(method: 'GET' | 'POST', route: string, headers: Record<string, string>, body: string | undefined, signal: AbortSignal) {
    // The transport cannot cancel a request, so the deadline only stops waiting for it.
    const deadline = new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error(LOST)), { once: true }));
    const answer = transport().then(relayed => relayed.request(method, route, headers, body).catch(error => {
      throw (error as Error)?.name === 'RelayTransportError' ? error : new Error(LOST);
    }));
    return Promise.race([deadline, answer]);
  }

  /** Runs `work` with a signal that aborts after `deadlineMs`, including the time to read the body. */
  async function timed<T>(deadlineMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deadlineMs);
    try { return await work(controller.signal); } finally { clearTimeout(timeout); }
  }

  function request<T>(route: string, body?: unknown, deadlineMs = timeoutMs): Promise<T> {
    return timed(deadlineMs, async signal => {
      const previous = body === undefined ? cached.get(route) : undefined;
      const headers = { 'Content-Type': 'application/json', ...(previous ? { 'If-None-Match': previous.etag } : {}) };
      const sent = body === undefined ? undefined : JSON.stringify(body);
      let response: Answer;
      if (relay) {
        const relayed = await overRelay(sent === undefined ? 'GET' : 'POST', route, headers, sent, signal);
        response = { status: relayed.status, ok: relayed.status >= 200 && relayed.status < 300, etag: relayed.headers.etag, text: async () => decoder.decode(relayed.body) };
      } else response = await overHttp(route, headers, sent, signal);
      if (response.status === 304 && cached.has(route)) return cached.get(route)!.value as T;
      let value;
      // Cloudflare and proxies answer with an HTML page when the request never reaches the host.
      try { value = JSON.parse(await response.text()); }
      catch {
        throw new Error([401, 403].includes(response.status) ? (relay ? 'Your Mac refused this phone. Scan its code again in Settings → Phone.' : 'Your computer\'s Cloudflare access was refused. Scan its pairing code again.')
          : response.status >= 500 ? 'Your computer isn\'t answering. Check that Milagre and its mobile host are running on your Mac.'
          : `Unexpected response from your computer (${response.status}).`);
      }
      if (value?.v !== 1) throw new Error('Incompatible daemon response. Update the app and daemon together.');
      if (!response.ok || value.error) throw new Error(value.error?.message || `Request failed (${response.status})`);
      if (body === undefined && response.etag) cached.set(route, { etag: response.etag, value: value.result });
      return value.result as T;
    });
  }

  const mediaRoute = (projectPath: string, path: string) => `/media?projectPath=${encodeURIComponent(projectPath)}&path=${encodeURIComponent(path)}`;
  /** An image file on the computer, served by the bridge only from the Project's Worktrees and Milagre's image folders. */
  function media(projectPath: string, path: string) {
    if (relay) throw new Error('Images from a relay computer load through mediaFile.');
    return { uri: url + mediaRoute(projectPath, path), headers: auth };
  }
  // One load per image: thumbnails ask on every render, and must get the same source back.
  const images = new Map<string, Promise<{ uri: string }>>();
  function relayImage(projectPath: string, path: string): Promise<{ uri: string }> {
    const name = mediaName(`${url}\n${projectPath}\n${path}`, path);
    const known = images.get(name);
    if (known) return known;
    const loading = (async () => {
      const found = await runtime!.files.find(name);
      if (found) return { uri: found };
      const response = await timed(timeoutMs, signal => overRelay('GET', mediaRoute(projectPath, path), {}, undefined, signal));
      if (response.status !== 200) throw new Error('Could not load this image from your Mac.');
      return { uri: await runtime!.files.write(name, response.body) };
    })();
    images.set(name, loading);
    loading.catch(() => { if (images.get(name) === loading) images.delete(name); });
    return loading;
  }

  /** The bridge's live socket, read through the relay. It opens once the transport is ready, unless closed first. */
  function relayLive(path: string, { onSignal, onStatus }: LiveOptions): Live {
    let closed = false;
    let handle: { close(): void } | null = null;
    transport().then(relayed => {
      if (closed) return;
      handle = relayed.live(path, data => {
        let type: unknown;
        try { type = JSON.parse(data).type; } catch { return; }
        if (type === 'runs' || type === 'project') onSignal(type);
      }, onStatus);
    }, () => { /* the snapshot polls until a live socket opens */ });
    return { close() { closed = true; handle?.close(); handle = null; } };
  }

  return {
    url,
    upload: (projectPath: string, name: string, base64: string) => request<{ path: string; name: string }>('/attachments', { projectPath, name, base64 }),
    // Git fetches and worktree setup get the same deadline as the desktop daemon client.
    call: <T,>(method: string, args: unknown[] = []) => request<T>('/rpc', { v: 1, method, args }, method === 'worktree:create' ? Math.max(timeoutMs, 330000) : timeoutMs),
    media,
    /** A relay computer's image, fetched once into the cache folder; resolves to its file:// URI. */
    mediaFile: (projectPath: string, path: string) => relayImage(projectPath, path).then(source => source.uri),
    /** The image source to show: the authenticated URL directly, or the cached file through the relay. */
    image: (projectPath: string, path: string): { uri: string; headers?: Record<string, string> } | Promise<{ uri: string }> => relay ? relayImage(projectPath, path) : media(projectPath, path),
    /** One message with its tools' full output; the snapshot leaves that out. */
    message: (projectPath: string, id: number) => request<ChatMessage>(`/message?projectPath=${encodeURIComponent(projectPath)}&id=${id}`),
    snapshot: (projectPath: string) => request<Snapshot>('/snapshot?projectPath=' + encodeURIComponent(projectPath)),
    /** Just the Project's streaming turns: what a live "runs" signal fetches instead of the whole snapshot. */
    runs: (projectPath: string) => request<Runs>('/runs?projectPath=' + encodeURIComponent(projectPath)),
    /** The Project's live socket, through the same tunnel and Access headers as every request, or through the relay. */
    live: (projectPath: string, options: LiveOptions) => {
      const path = `/live?projectPath=${encodeURIComponent(projectPath)}`;
      return relay ? relayLive(path, options) : openLive(`${url.replace(/^http/, 'ws')}${path}`, auth, options);
    },
  };
}
export type Client = ReturnType<typeof createClient>;
