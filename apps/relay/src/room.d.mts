export const MAX_FRAME: number;
export const MAX_PHONES: number;
export type Payload = string | ArrayBuffer | ArrayBufferView;
export interface RoomSocket {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}
export function frame(type: number, conn: bigint, payload?: Uint8Array): Uint8Array;
export function unframe(bytes: ArrayBuffer | Uint8Array): { type: number; conn: bigint; payload: Uint8Array };
export interface Room {
  hostOpened(socket: RoomSocket): void;
  hostMessage(socket: RoomSocket, data: Payload): void;
  hostClosed(socket: RoomSocket): void;
  phoneOpened(socket: RoomSocket): bigint | null;
  phoneMessage(socket: RoomSocket, data: Payload): void;
  phoneClosed(socket: RoomSocket): void;
}
export function createRoom(options: { id: string; nonce?: () => Uint8Array }): Room;
