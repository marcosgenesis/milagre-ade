export const MAX_PHONES: number;
export type Payload = string | ArrayBuffer | ArrayBufferView;
export interface RoomSocket {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}
export function frame(type: number, conn: bigint, payload?: Uint8Array): Uint8Array;
export function unframe(bytes: ArrayBuffer | Uint8Array): { type: number; conn: bigint; payload: Uint8Array };
/** What the room marks on a socket so a fresh room can rebuild after eviction; null once the room is done with it. */
export type RoomSocketState = { role: "pending"; challenge: string } | { role: "host"; next: string } | { role: "phone"; conn: string };
export interface Room {
  hostOpened(socket: RoomSocket): void;
  hostMessage(socket: RoomSocket, data: Payload): void;
  hostClosed(socket: RoomSocket): void;
  /** Why a new phone would be turned away right now, or null. Changes nothing. */
  phoneRefusal(): { code: number; reason: string } | null;
  phoneOpened(socket: RoomSocket): bigint | null;
  phoneMessage(socket: RoomSocket, data: Payload): void;
  phoneClosed(socket: RoomSocket): void;
  /** Rebuilds a fresh room from surviving sockets and their last marks, in the runtime's listing order. */
  restore(entries: { socket: RoomSocket; state: unknown }[]): void;
}
export function createRoom(options: {
  id: string;
  nonce?: () => Uint8Array;
  /** Called whenever a socket's role or state changes. */
  mark?: (socket: RoomSocket, state: RoomSocketState | null) => void;
}): Room;
