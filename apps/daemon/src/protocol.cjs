const VERSION = 1;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_PENDING = 32;

function protocolError(code, message) { return Object.assign(new Error(message), { code }); }

// Each UTF-8 JSON frame ends in a newline. Bound both partial frames and queued
// writes, so a stalled client cannot accumulate the daemon's event stream.
function wire(socket, { onMessage, onInvalid, maxFrameBytes = MAX_FRAME_BYTES }) {
  // Partial frame as chunks, joined once when a newline arrives: concatenating per chunk is quadratic for multi-MB frames.
  let pending = [];
  let pendingBytes = 0;
  let failed = false;
  socket.on('data', chunk => {
    if (failed) return;
    if (!chunk.includes(10)) {
      pending.push(chunk);
      pendingBytes += chunk.length;
      if (pendingBytes > maxFrameBytes) {
        failed = true;
        onInvalid(protocolError('FRAME_TOO_LARGE', 'Frame exceeds the local daemon size limit'));
      }
      return;
    }
    let buffer = pending.length ? Buffer.concat([...pending, chunk]) : chunk;
    pending = [];
    pendingBytes = 0;
    while (buffer.length) {
      const newline = buffer.indexOf(10);
      if (newline > maxFrameBytes || (newline < 0 && buffer.length > maxFrameBytes)) {
        failed = true;
        onInvalid(protocolError('FRAME_TOO_LARGE', 'Frame exceeds the local daemon size limit'));
        return;
      }
      if (newline < 0) { pending = [buffer]; pendingBytes = buffer.length; return; }
      const frame = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      let message;
      try { message = JSON.parse(frame.toString('utf8')); }
      catch { failed = true; onInvalid(protocolError('INVALID_REQUEST', 'Expected a JSON frame')); return; }
      onMessage(message);
      if (socket.destroyed) return;
    }
  });
  return {
    send(message) {
      if (socket.destroyed || socket.writableEnded) return false;
      const frame = JSON.stringify(message) + '\n';
      const bytes = Buffer.byteLength(frame);
      if (bytes > maxFrameBytes) throw protocolError('FRAME_TOO_LARGE', 'Response exceeds the local daemon size limit');
      if (socket.writableLength + bytes > 2 * maxFrameBytes) {
        socket.destroy();
        return false;
      }
      socket.write(frame);
      return true;
    },
  };
}

module.exports = { VERSION, MAX_FRAME_BYTES, MAX_PENDING, protocolError, wire };
