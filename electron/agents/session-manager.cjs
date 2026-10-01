const { isTerminal } = require("./events.cjs");

const IDLE_MS = 10 * 60 * 1000;
const BATCH_MS = 50;

// One agent session per chat. Sessions start on a chat's first turn, resume from the id the
// chat saved, close after a quiet period, and are replaced when they crash or the chat
// changes provider. Text deltas are batched so fast streams don't flood IPC.
class SessionManager {
  constructor({ createSession, send, idleMs = IDLE_MS, batchMs = BATCH_MS }) {
    Object.assign(this, { createSession, send, idleMs, batchMs });
    this.sessions = new Map();
    this.buffers = new Map();
  }

  async startTurn(request) {
    const { chatId, provider } = request;
    let entry = this.sessions.get(chatId);
    if (entry && (entry.provider !== provider || entry.session.closed)) {
      await this.closeChat(chatId);
      entry = undefined;
    }
    if (!entry) {
      const session = this.createSession(provider, {
        cwd: request.cwd,
        resumeId: request.resumeId,
        command: request.command,
        emit: (event) => this.forward(chatId, event),
      });
      entry = { provider, session, idleTimer: null };
      this.sessions.set(chatId, entry);
    }
    clearTimeout(entry.idleTimer);
    return entry.session.startTurn({ prompt: request.prompt, images: request.images, model: request.model, permissionMode: request.permissionMode });
  }

  forward(chatId, event) {
    if (event.type === "text-delta") {
      const buffer = this.buffers.get(chatId);
      if (buffer && buffer.messageId !== event.messageId) this.flush(chatId);
      const next = this.buffers.get(chatId) ?? { messageId: event.messageId, text: "", timer: setTimeout(() => this.flush(chatId), this.batchMs) };
      next.text += event.text;
      this.buffers.set(chatId, next);
      return;
    }
    this.flush(chatId);
    this.send(chatId, event);
    if (isTerminal(event)) this.scheduleIdleClose(chatId);
  }

  flush(chatId) {
    const buffer = this.buffers.get(chatId);
    if (!buffer) return;
    clearTimeout(buffer.timer);
    this.buffers.delete(chatId);
    if (buffer.text) this.send(chatId, { type: "text-delta", messageId: buffer.messageId, text: buffer.text });
  }

  scheduleIdleClose(chatId) {
    const entry = this.sessions.get(chatId);
    if (!entry) return;
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => void this.closeChat(chatId), this.idleMs);
    entry.idleTimer.unref?.();
  }

  async interrupt(chatId) {
    await this.sessions.get(chatId)?.session.interrupt();
  }

  async closeChat(chatId) {
    const entry = this.sessions.get(chatId);
    if (!entry) return;
    this.sessions.delete(chatId);
    clearTimeout(entry.idleTimer);
    await entry.session.close();
  }

  async closeAll() {
    await Promise.all([...this.sessions.keys()].map((chatId) => this.closeChat(chatId)));
  }
}

module.exports = { SessionManager };
