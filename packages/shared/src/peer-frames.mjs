// The paired-desktop protocol inside an encrypted channel (relay-crypto). A desktop sends each daemon request as an
// `rpc` message and the daemon sends each of its frames (a reply, an error or an event) as an `evt` message:
//   { t: "rpc" | "evt", frame }
// A frame whose UTF-8 JSON is over PART_THRESHOLD bytes travels instead as consecutive `part` messages, each with the
// base64 of PIECE_BYTES of it (a whole 768 KiB piece would be 1 MiB in base64, past the relay's frames):
//   { t: "part", id, i, n, data }   id: the sender's count of split frames, i: 0..n-1, n: how many parts
// A frame's parts are never interleaved with another rpc, evt or part message, and the channel delivers in order, so a
// reader holds at most one frame. Node only (the daemon and Electron main): it uses Buffer.
import { Buffer } from "node:buffer";

export const PART_THRESHOLD = 768 * 1024;
export const PIECE_BYTES = 512 * 1024;
// The daemon's frame limit (apps/daemon/src/protocol.cjs).
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;
export const MAX_PARTS = MAX_FRAME_BYTES / PIECE_BYTES;
const MAX_DATA = Math.ceil(PIECE_BYTES / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const CLOSE_BRACE = Buffer.from("}");

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const peerError = (code, message) => Object.assign(new Error(message), { code });

/** Writes frames of one direction: `kind` is "rpc" on a desktop, "evt" on the daemon. */
export function createFrameWriter(kind) {
  const head = Buffer.from(`{"t":${JSON.stringify(kind)},"frame":`);
  let lastId = 0;
  return {
    /** The UTF-8 message texts that carry one frame (`json`, its JSON text), each ready for channel.sealEncoded. */
    write(json) {
      const bytes = Buffer.from(json, "utf8");
      if (bytes.length > MAX_FRAME_BYTES)
        throw Object.assign(peerError("FRAME_TOO_LARGE", `The message is ${megabytes(bytes.length)}, over the ${megabytes(MAX_FRAME_BYTES)} frame limit`), {
          bytes: bytes.length,
        });
      if (bytes.length <= PART_THRESHOLD) return [Buffer.concat([head, bytes, CLOSE_BRACE])];
      const id = ++lastId;
      const n = Math.ceil(bytes.length / PIECE_BYTES);
      const parts = [];
      for (let i = 0; i < n; i++) {
        const data = bytes.subarray(i * PIECE_BYTES, (i + 1) * PIECE_BYTES).toString("base64");
        parts.push(Buffer.from(`{"t":"part","id":${id},"i":${i},"n":${n},"data":"${data}"}`));
      }
      return parts;
    },
  };
}

/** Reads frames of one direction: `kind` is "rpc" on the daemon, "evt" on a desktop. */
export function createFrameReader(kind, { maxBytes = MAX_FRAME_BYTES } = {}) {
  let partial = null; // { id, n, pieces, size } while a split frame arrives
  const refuse = (code, message) => {
    partial = null;
    return peerError(code, message);
  };
  return {
    /** The frame `message` completes, or null while parts are still arriving. Throws (with a code) on a broken one. */
    read(message) {
      if (message?.t === kind) {
        if (partial) throw refuse("BAD_PART", "A frame's parts were interrupted");
        return { frame: message.frame };
      }
      if (message?.t !== "part") throw refuse("BAD_PART", "Not a frame");
      const { id, i, n, data } = message;
      if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(i) || !Number.isSafeInteger(n) || n < 2 || typeof data !== "string")
        throw refuse("BAD_PART", "Malformed part");
      if (n > Math.ceil(maxBytes / PIECE_BYTES)) throw refuse("FRAME_TOO_LARGE", `A frame of ${n} parts is over the ${megabytes(maxBytes)} frame limit`);
      if (partial ? id !== partial.id || n !== partial.n || i !== partial.pieces.length : i !== 0) throw refuse("BAD_PART", "Parts arrived out of order");
      if (data.length > MAX_DATA || data.length % 4 !== 0 || !BASE64.test(data)) throw refuse("BAD_PART", "Malformed part");
      const piece = Buffer.from(data, "base64");
      partial ??= { id, n, pieces: [], size: 0 };
      partial.size += piece.length;
      if (partial.size > maxBytes) throw refuse("FRAME_TOO_LARGE", `The frame is over the ${megabytes(maxBytes)} frame limit`);
      partial.pieces.push(piece);
      if (partial.pieces.length < partial.n) return null;
      const { pieces, size } = partial;
      partial = null;
      try {
        return { frame: JSON.parse(Buffer.concat(pieces, size).toString("utf8")) };
      } catch {
        throw peerError("INVALID_REQUEST", "Expected a JSON frame");
      }
    },
    /** Whether a split frame is half received. */
    pending: () => partial !== null,
  };
}
