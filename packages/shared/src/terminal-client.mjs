// One viewer of a Terminal: reads its output in a loop and sends what the user types, in order. The desktop panel and
// the phone's screen both drive their xterm through this.

/**
 * Starts following a Terminal. `write(data)` appends output; `reset(data)` replaces everything shown; `ended()` runs
 * once when the shell is gone; `info(terminal)` gets the host's latest view of it. A failed read retries after
 * `retryMs`, so a viewer survives the host reconnecting.
 *
 * The next read waits for `write` and `reset` to settle when they return a promise: a viewer that has not drawn the
 * last output asks for no more, and one that falls behind the host's kept output is reset to its tail instead of
 * queueing everything a flood printed. `readLimit` caps how much one read carries.
 */
export function followTerminal({
  terminalId,
  api,
  write,
  reset,
  ended = () => {},
  info = () => {},
  readLimit,
  retryMs = 1000,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let stopped = false;
  let offset = 0;
  let pending = "";
  let sending = null;
  let size = null;
  let sizing = null;

  async function readLoop() {
    while (!stopped) {
      let read;
      try {
        read = await api.read({ terminalId, after: offset, ...(readLimit ? { limit: readLimit } : {}) });
      } catch {
        if (!stopped) await wait(retryMs);
        continue;
      }
      if (stopped) return;
      try {
        if (read.reset) await reset(read.data);
        else if (read.data) await write(read.data);
      } catch {
        // The viewer dropped it (xterm refuses writes past its own queue); the next read goes on from what the host has.
      }
      if (stopped) return;
      offset = read.offset;
      if (read.terminal) info(read.terminal);
      if (read.ended) {
        stopped = true;
        ended();
        return;
      }
    }
  }

  // What the user types while a send is out is joined into the next one, so keys arrive in order and in few requests.
  async function flush() {
    // `stop()` may run while a send is out; each turn checks it again.
    while (pending) {
      if (stopped) break;
      const data = pending;
      pending = "";
      try {
        await api.input({ terminalId, data });
      } catch {
        // The Terminal ended or the host is away; the read loop reports which.
      }
    }
    sending = null;
  }

  async function flushSize() {
    while (size) {
      if (stopped) break;
      const next = size;
      size = null;
      try {
        await api.resize({ terminalId, cols: next.cols, rows: next.rows });
      } catch {
        // As above.
      }
    }
    sizing = null;
  }

  void readLoop();
  return {
    send(data) {
      if (stopped || typeof data !== "string" || !data) return;
      pending += data;
      sending ??= flush();
    },
    /** The PTY takes the size of the viewer that sent one last. */
    resize(cols, rows) {
      if (stopped || !Number.isSafeInteger(cols) || !Number.isSafeInteger(rows) || cols < 2 || rows < 1) return;
      size = { cols, rows };
      sizing ??= flushSize();
    },
    stop() {
      stopped = true;
    },
    get stopped() {
      return stopped;
    },
  };
}
