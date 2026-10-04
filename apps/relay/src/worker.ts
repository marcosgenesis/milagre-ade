import { createRoom, type Room as RoomLogic } from './room.mjs';

export interface Env { ROOMS: DurableObjectNamespace }
const ID = /^[A-Za-z0-9_-]{22}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    const role = url.pathname === '/v1/host' ? 'host' : url.pathname === '/v1/phone' ? 'phone' : null;
    if (!role) return new Response('Not found', { status: 404 });
    if (!ID.test(url.searchParams.get('id') ?? '')) return new Response('Bad id', { status: 400 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const id = url.searchParams.get('id')!;
    return env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(request);
  },
};

type Role = 'host' | 'phone';

/**
 * One Mac's room, on the WebSocket Hibernation API: while nobody sends anything the runtime may
 * evict the object and keep the sockets open, so an idle Mac costs no duration. The Mac's
 * keepalive is protocol-level ping frames, which the runtime answers without waking the object;
 * there is deliberately no setWebSocketAutoResponse.
 *
 * Nothing lives only in memory: each socket carries its role as a tag and the room's mark for it
 * as its attachment, and the room id sits in storage. Every entry point goes through `live()`,
 * which rebuilds the room from those after an eviction.
 */
export class Room implements DurableObject {
  private room?: RoomLogic;
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const id = url.searchParams.get('id')!;
    const role: Role = url.pathname === '/v1/host' ? 'host' : 'phone';
    // A hibernation wake has no request to read the id from, and the room needs it to check a Mac's proof.
    const kv = this.state.storage.kv;
    if (kv.get('id') !== id) kv.put('id', id);
    const room = this.live(); // before accepting, so a rebuild cannot mistake the new socket for one that lost its state
    const [client, server] = Object.values(new WebSocketPair());
    // A phone turned away at the door never becomes hibernatable: the runtime takes about 10 s to finish
    // closing a hibernatable socket that has not sent anything yet, and the phone would wait that long for its 4404.
    const refusal = role === 'phone' ? room.phoneRefusal() : null;
    if (refusal) {
      server.accept();
      server.close(refusal.code, refusal.reason);
      return new Response(null, { status: 101, webSocket: client });
    }
    // Hibernatable sockets hand binary over as an ArrayBuffer, which the room reads with its brand check.
    this.state.acceptWebSocket(server, [role]);
    if (role === 'host') room.hostOpened(server); else room.phoneOpened(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const room = this.live();
    if (this.roleOf(ws) === 'host') room.hostMessage(ws, message); else room.phoneMessage(ws, message);
  }

  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    this.closed(ws);
    // The compatibility date turns on web_socket_auto_reply_to_close, so the runtime has already answered
    // the peer's Close frame; closing back is only a fallback and throws if the socket is already closed.
    if (ws.readyState !== WebSocket.READY_STATE_CLOSED) { try { ws.close(1000, 'closed'); } catch { /* already closed */ } }
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    this.closed(ws);
    try { ws.close(1011, 'error'); } catch { /* already closed */ }
  }

  /** A socket can end with an error, a close, or both; the room ignores a socket it already forgot. */
  private closed(ws: WebSocket): void {
    const room = this.live(ws);
    if (this.roleOf(ws) === 'host') room.hostClosed(ws); else room.phoneClosed(ws);
  }

  /**
   * The room in memory, rebuilt after an eviction from the sockets the runtime still holds.
   * `ending` is a socket whose close woke the object: it may no longer be listed, but the room still
   * has to hear about it (a phone's close becomes a CLOSE frame for the Mac). It goes first, so a
   * listed socket wins any tie.
   */
  private live(ending?: WebSocket): RoomLogic {
    if (this.room) return this.room;
    const room = createRoom({ id: this.state.storage.kv.get<string>('id') ?? '', mark: (socket, state) => (socket as WebSocket).serializeAttachment(state) });
    const sockets = this.state.getWebSockets();
    if (ending && !sockets.includes(ending)) sockets.unshift(ending);
    room.restore(sockets.map(ws => ({ socket: ws, state: this.stateOf(ws) })));
    return (this.room = room);
  }

  /** The room's mark on a socket, if it agrees with the socket's role tag. */
  private stateOf(ws: WebSocket): unknown {
    const state: unknown = ws.deserializeAttachment();
    const role = state && typeof state === 'object' ? (state as { role?: unknown }).role : undefined;
    const tag: Role | null = role === 'host' || role === 'pending' ? 'host' : role === 'phone' ? 'phone' : null;
    return tag && tag === this.roleOf(ws) ? state : null;
  }

  private roleOf(ws: WebSocket): Role | null {
    let tags: string[];
    try { tags = this.state.getTags(ws); } catch { return null; }
    return tags.includes('host') ? 'host' : tags.includes('phone') ? 'phone' : null;
  }
}
