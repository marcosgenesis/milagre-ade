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

/**
 * One Mac's room. No hibernation: the room lives in memory, so the object has to stay
 * resident while any socket is open (the Mac pings every 20 s, so it never idles out).
 */
export class Room implements DurableObject {
  private room?: RoomLogic;
  constructor(_state: DurableObjectState) {}
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const id = url.searchParams.get('id')!;
    const role = url.pathname === '/v1/host' ? 'host' : 'phone';
    // The room itself tells pending Mac sockets from the proven one, so the listeners just forward every event.
    const room = (this.room ??= createRoom({ id }));
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.binaryType = 'arraybuffer'; // Workers hands binary over as a Blob by default, which cannot be read synchronously
    server.addEventListener('message', event => role === 'host' ? room.hostMessage(server, event.data) : room.phoneMessage(server, event.data));
    // A socket can end with 'error' and no 'close'; both forget it, and the room ignores a socket it already forgot.
    const closed = () => role === 'host' ? room.hostClosed(server) : room.phoneClosed(server);
    server.addEventListener('close', closed);
    server.addEventListener('error', closed);
    if (role === 'host') room.hostOpened(server); else room.phoneOpened(server);
    return new Response(null, { status: 101, webSocket: client });
  }
}
