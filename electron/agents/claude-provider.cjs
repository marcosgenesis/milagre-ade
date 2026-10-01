const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { killTree } = require("./process-tree.cjs");
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, isTerminal, mapClaudeMessage, missingCliMessage } = require("./events.cjs");

// Milagre permission mode -> Claude Code permission mode. Approvals arrive in a later step,
// so Ask uses acceptEdits like the old `claude --print` call; Ask also keeps Milagre's
// pre-run confirmation in the renderer.
const CLAUDE_MODES = { ask: "acceptEdits", auto: "acceptEdits", full: "bypassPermissions" };

// User messages for a running query: the SDK's streaming-input mode reads this until it ends.
class Inbox {
  constructor() {
    this.queue = [];
    this.wake = null;
    this.ended = false;
  }

  push(message) {
    this.queue.push(message);
    this.wake?.();
  }

  end() {
    this.ended = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.queue.length) yield this.queue.shift();
      if (this.ended) return;
      await new Promise((resolve) => { this.wake = resolve; });
      this.wake = null;
    }
  }
}

class ClaudeSession {
  constructor({ cwd, resumeId, command, emit, loadSdk = () => import("@anthropic-ai/claude-agent-sdk"), spawnImpl = spawn, interruptGraceMs = 3000 }) {
    Object.assign(this, { cwd, resumeId, command, emit, loadSdk, spawnImpl, interruptGraceMs });
    this.state = { sessionId: resumeId ?? null, turnId: null, hasText: false };
    this.query = null;
    this.inbox = null;
    this.child = null;
    this.stderr = "";
    this.initSeen = false;
    this.turnActive = false;
    this.cancelRequested = false;
    this.closed = false;
  }

  get nativeId() {
    return this.state.sessionId;
  }

  async startTurn({ prompt, images = [], model, permissionMode }) {
    if (this.turnActive) throw new Error("This chat already has a turn running.");
    if (!this.command) {
      this.emit({ type: "turn-failed", message: missingCliMessage("claude") });
      return { turnId: null };
    }
    this.turnActive = true;
    this.cancelRequested = false;
    const turnId = randomUUID();
    Object.assign(this.state, { turnId, hasText: false });
    const mode = CLAUDE_MODES[permissionMode] ?? "acceptEdits";
    try {
      if (!this.query) await this.start(model, mode);
      if (model !== this.model) {
        await this.query.setModel(model);
        this.model = model;
      }
      if (mode !== this.mode) {
        await this.query.setPermissionMode(mode);
        this.mode = mode;
      }
    } catch (error) {
      this.finishTurn({ type: "turn-failed", message: error.message });
      return { turnId: null };
    }
    const content = [{ type: "text", text: prompt }, ...images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mime, data: image.base64 } }))];
    this.inbox.push({ type: "user", message: { role: "user", content }, parent_tool_use_id: null });
    return { turnId };
  }

  async start(model, mode) {
    const { query } = await this.loadSdk();
    this.inbox = new Inbox();
    this.model = model;
    this.mode = mode;
    this.query = query({
      prompt: this.inbox,
      options: {
        cwd: this.cwd,
        model,
        permissionMode: mode,
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        pathToClaudeCodeExecutable: this.command,
        settingSources: ["user", "project", "local"],
        systemPrompt: { type: "preset", preset: "claude_code", append: MILAGRE_INSTRUCTIONS },
        ...(this.resumeId ? { resume: this.resumeId } : {}),
        // Own the process so close() can stop Claude Code and everything it started.
        spawnClaudeCodeProcess: ({ command, args, cwd, env, signal }) => {
          const child = this.spawnImpl(command, args, { cwd, env, signal, stdio: ["pipe", "pipe", "pipe"], detached: true });
          child.stderr?.on("data", (chunk) => { this.stderr = (this.stderr + chunk.toString()).slice(-4000); });
          this.child = child;
          return child;
        },
      },
    });
    void this.readMessages(this.query);
  }

  async readMessages(query) {
    try {
      for await (const message of query) {
        if (message.type === "system" && message.subtype === "init") this.initSeen = true;
        for (const event of mapClaudeMessage(message, this.state)) {
          if (!isTerminal(event)) this.emit(event);
          else if (this.cancelRequested) this.finishTurn({ type: "turn-cancelled" });
          else if (event.type === "turn-failed" && this.resumeId && !this.initSeen) this.resumeFailed();
          else this.finishTurn(event);
        }
      }
      this.handleEnd(null);
    } catch (error) {
      this.handleEnd(error);
    }
  }

  handleEnd(error) {
    this.query = null;
    this.closed = true;
    if (!this.turnActive) return;
    if (this.cancelRequested) this.finishTurn({ type: "turn-cancelled" });
    else if (this.resumeId && !this.initSeen) this.resumeFailed();
    else this.finishTurn({ type: "turn-failed", message: error?.message || this.stderr.trim() || "Claude Code stopped unexpectedly." });
  }

  resumeFailed() {
    if (!this.turnActive) return;
    this.emit({ type: "session-reset" });
    this.finishTurn({ type: "turn-failed", message: RESUME_FAILED_MESSAGE });
    void this.close();
  }

  finishTurn(event) {
    if (!this.turnActive) return;
    this.turnActive = false;
    clearTimeout(this.interruptTimer);
    this.emit(event);
  }

  async interrupt() {
    if (!this.turnActive) return;
    this.cancelRequested = true;
    clearTimeout(this.interruptTimer);
    // If Claude never confirms, stop the process; the turn then ends as cancelled.
    this.interruptTimer = setTimeout(() => {
      void this.close().then(() => this.finishTurn({ type: "turn-cancelled" }));
    }, this.interruptGraceMs);
    // interrupt() rejects with "Query closed before response received" when the query
    // closes first; that is expected during cancel and shutdown.
    await this.query?.interrupt().catch(() => {});
  }

  async close() {
    if (this.turnActive) this.cancelRequested = true;
    this.closed = true;
    this.inbox?.end();
    const query = this.query;
    this.query = null;
    // An async generator stuck on an await never settles return(), so don't wait forever.
    await Promise.race([query?.return?.().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await killTree(this.child);
  }
}

module.exports = { ClaudeSession, CLAUDE_MODES };
