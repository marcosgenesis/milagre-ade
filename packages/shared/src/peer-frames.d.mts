export const PART_THRESHOLD: number;
export const PIECE_BYTES: number;
export const MAX_FRAME_BYTES: number;
export const MAX_PARTS: number;
export type PeerMessageKind = "rpc" | "evt";
export type PeerFrameErrorCode = "FRAME_TOO_LARGE" | "BAD_PART" | "INVALID_REQUEST";
export type FrameWriter = {
  /** The UTF-8 message texts that carry one frame, each ready for Channel.sealEncoded. Throws FRAME_TOO_LARGE past 16 MiB. */
  write(json: string): Uint8Array[];
};
export type FrameReader = {
  /** The frame a message completes, or null while parts still arrive. Throws an Error with a PeerFrameErrorCode `code`. */
  read(message: unknown): { frame: unknown } | null;
  pending(): boolean;
};
export function createFrameWriter(kind: PeerMessageKind): FrameWriter;
export function createFrameReader(kind: PeerMessageKind, options?: { maxBytes?: number }): FrameReader;
