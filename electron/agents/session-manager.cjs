const { isTerminal } = require("./events.cjs");
const { PERMISSION_MODES, USER_DECISIONS } = require("./permissions.cjs");
const { validAnswers } = require("./questions.cjs");
const { capOutput } = require("./steps.cjs");

const IDLE_MS = 10 * 60 * 1000;
const BATCH_MS = 50;

// Streamed events that are batched: reply text per turn, and command output per step.
function streamKey(event) {
  if (event.type === "text-delta") return `text:${event.messageId}`;
  if (event.type === "step-output") return `step:${event.id}`;
  return null;
}

// One agent session per chat. A chat id is the renderer's chat key, `${projectPath}#${sessionId}`.
// Sessions start on a chat's first turn, resume from the id the chat saved, close after a quiet
// period, and are replaced when they crash or the chat changes provider or working directory.
// Text deltas and command output are batched so fast streams don't flood IPC; a batch of output
// keeps only the end the renderer would keep. Replacing and closing a chat's
// session run one at a time per chat, and onSessionClosed(chatId) runs once a chat's session is gone. Events from a session that is no longer the chat's
// current one are dropped. A turn's session steers it when the chat sends again while it runs.
class SessionManager {
  constructor({ createSession, send, onSessionClosed = () => {}, idleMs = IDLE_MS, batchMs = BATCH_MS }) {
    Object.assign(this, { createSession, send, onSessionClosed, idleMs, batchMs });
    this.sessions = new Map();
    this.buffers = new Map();
    this.queues = new Map();
  }

  async startTurn(request) {
    const start = (entry) => {
      clearTimeout(entry.idleTimer);
      return entry.session.startTurn({ prompt: request.prompt, images: request.images, model: request.model, permissionMode: request.permissionMode, effort: request.effort, ultracode: request.ultracode, fastMode: request.fastMode, replies: request.replies });
    };
    const entry = await this.serial(request.chatId, () => this.currentEntry(request));
    try {
      return await start(entry);
    } catch (error) {
      if (!error.sessionClosed) throw error;
      // The session closed under this message (Stop had to close it); retry once on a fresh one.
      return start(await this.serial(request.chatId, () => this.currentEntry(request)));
    }
  }

  async currentEntry(request) {
    const { chatId, provider, cwd } = request;
    const existing = this.sessions.get(chatId);
    const tldrEnabled = request.tldrEnabled !== false;
    const sameChat = existing && existing.provider === provider && existing.cwd === cwd;
    // System instructions are fixed for a provider session. Resume it between turns when
    // the preference changes, preserving its native history and any running reply.
    if (sameChat && !existing.session.closed && (existing.tldrEnabled === tldrEnabled || existing.session.turnActive)) return existing;
    const resumeId = sameChat && !existing.session.closed ? existing.session.nativeId ?? request.resumeId : request.resumeId;
    if (existing) await this.closeEntry(chatId, existing);
    const entry = { provider, cwd, tldrEnabled, session: null, idleTimer: null };
    entry.session = this.createSession(provider, {
      cwd,
      resumeId,
      tldrEnabled,
      command: request.command,
      emit: (event) => this.forward(chatId, entry, event),
    });
    this.sessions.set(chatId, entry);
    return entry;
  }

  // Runs fn once any earlier replace or close for the same chat has finished.
  serial(chatId, fn) {
    const run = (this.queues.get(chatId) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.queues.set(chatId, run);
    return run;
  }

  forward(chatId, entry, event) {
    if (this.sessions.get(chatId) !== entry) return;
    const key = streamKey(event);
    if (key) {
      const buffer = this.buffers.get(chatId);
      if (buffer && buffer.key !== key) this.flush(chatId);
      let next = this.buffers.get(chatId);
      if (!next) {
        next = { key, event, text: "", timer: setTimeout(() => this.flush(chatId), this.batchMs) };
        next.timer.unref?.();
        this.buffers.set(chatId, next);
      }
      next.text = event.type === "step-output" ? capOutput(next.text + event.text) : next.text + event.text;
      return;
    }
    this.flush(chatId);
    this.send(chatId, event);
    // A turn the provider started itself (a steer that missed the end of the last one) isn't covered by
    // startTurn's clear; the timer armed by the previous turn's end must not close it mid-run.
    if (event.type === "turn-started") clearTimeout(entry.idleTimer);
    if (isTerminal(event)) this.scheduleIdleClose(chatId);
  }

  flush(chatId) {
    const buffer = this.buffers.get(chatId);
    if (!buffer) return;
    clearTimeout(buffer.timer);
    this.buffers.delete(chatId);
    if (buffer.text) this.send(chatId, { ...buffer.event, text: buffer.text });
  }

  scheduleIdleClose(chatId) {
    const entry = this.sessions.get(chatId);
    if (!entry) return;
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      void this.serial(chatId, () => (this.sessions.get(chatId) === entry ? this.closeEntry(chatId, entry) : undefined)).catch(() => {});
    }, this.idleMs);
    entry.idleTimer.unref?.();
  }

  async interrupt(chatId) {
    await this.sessions.get(chatId)?.session.interrupt();
  }

  // The renderer is untrusted input: only the user's three answers reach a session.
  respondToPermission(chatId, requestId, decision) {
    if (!USER_DECISIONS.has(decision)) throw new Error(`Unknown permission decision: ${decision}`);
    return this.sessions.get(chatId)?.session.respondToPermission(requestId, decision) ?? false;
  }

  // Answers come from the renderer too: only null or a few short strings per question id reach a session.
  answerQuestion(chatId, requestId, answers) {
    if (!validAnswers(answers)) throw new Error("Invalid answers to an agent question.");
    return this.sessions.get(chatId)?.session.answerQuestion(requestId, answers) ?? false;
  }

  // A mode switch reaches the chat's session at once, so a running turn stops asking for what it allows.
  async setPermissionMode(chatId, mode) {
    if (!PERMISSION_MODES.has(mode)) throw new Error(`Unknown permission mode: ${mode}`);
    await this.sessions.get(chatId)?.session.setPermissionMode(mode);
  }

  async interruptAll() {
    await Promise.all([...this.sessions.values()].map((entry) => entry.session.interrupt()));
  }

  closeChat(chatId) {
    return this.serial(chatId, () => this.closeEntry(chatId, this.sessions.get(chatId)));
  }

  // The session stays current while it closes, so its own final event (a cancelled turn)
  // still reaches the renderer; then any batched text is sent and the chat forgets it.
  async closeEntry(chatId, entry) {
    if (!entry) return;
    clearTimeout(entry.idleTimer);
    await entry.session.close();
    clearTimeout(entry.idleTimer);
    if (this.sessions.get(chatId) !== entry) return;
    this.flush(chatId);
    this.sessions.delete(chatId);
    this.onSessionClosed(chatId);
  }

  async closeAll() {
    await Promise.all([...this.sessions.keys()].map((chatId) => this.closeChat(chatId)));
  }
}

module.exports = { SessionManager };
