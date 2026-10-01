const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { killTree } = require("./process-tree.cjs");
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, isTerminal, mapClaudeMessage, missingCliMessage } = require("./events.cjs");
const { PendingPermissions, claudeRequest, claudeResult } = require("./permissions.cjs");

// Milagre permission mode -> Claude Code permission mode. In Ask (`default`) Claude Code checks with
// the user, through canUseTool, before edits and commands its rules don't already allow.
const CLAUDE_MODES = { ask: "default", auto: "acceptEdits", full: "bypassPermissions" };

// Claude Code prints this when --resume names a session it no longer has.
const MISSING_CONVERSATION = /No conversation found/i;

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

function userMessage(prompt, images = []) {
  const content = [{ type: "text", text: prompt }, ...images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mime, data: image.base64 } }))];
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
}

class ClaudeSession {
  constructor({ cwd, resumeId, command, emit, loadSdk = () => import("@anthropic-ai/claude-agent-sdk"), spawnImpl = spawn, interruptGraceMs = 3000 }) {
    Object.assign(this, { cwd, resumeId, command, emit, loadSdk, spawnImpl, interruptGraceMs });
    this.state = { sessionId: resumeId ?? null, turnId: null, hasText: false };
    this.query = null;
    this.inbox = null;
    this.child = null;
    this.stderr = "";
    this.turnActive = false;
    this.cancelRequested = false;
    this.closed = false;
    this.permissions = new PendingPermissions((event) => this.emit(event));
    // Settles once the running turn's own message is in Claude Code's input (or the turn failed to start).
    this.turnReady = Promise.resolve();
  }

  get nativeId() {
    return this.state.sessionId;
  }

  async startTurn(request) {
    if (this.closed) throw new Error("This Claude session is closed.");
    if (this.turnActive) return this.steer(request);
    if (!this.command) {
      this.emit({ type: "turn-failed", message: missingCliMessage("claude") });
      return { turnId: null, steered: false };
    }
    this.turnActive = true;
    this.cancelRequested = false;
    let markReady;
    this.turnReady = new Promise((resolve) => { markReady = resolve; });
    try {
      return await this.beginTurn(request);
    } finally {
      markReady();
    }
  }

  async beginTurn({ prompt, images = [], model, permissionMode, effort, ultracode = false }) {
    const turnId = randomUUID();
    Object.assign(this.state, { turnId, hasText: false });
    const mode = CLAUDE_MODES[permissionMode] ?? "default";
    try {
      if (!this.query) await this.start(model, mode, effort, ultracode);
      if (!this.closed) {
        if (model !== this.model) {
          await this.query.setModel(model);
          this.model = model;
        }
        if (mode !== this.mode) {
          await this.query.setPermissionMode(mode);
          this.mode = mode;
        }
        // A new effort level alone turns ultracode off, so both keys always travel together.
        if ((effort && effort !== this.effort) || ultracode !== this.ultracode) {
          await this.query.applyFlagSettings({ ...(effort ? { effortLevel: effort } : {}), ultracode });
          this.effort = effort;
          this.ultracode = ultracode;
        }
      }
    } catch (error) {
      this.finishTurn({ type: "turn-failed", message: error.message });
      return { turnId: null, steered: false };
    }
    // close() or interrupt() may have landed while the SDK was loading or the query starting.
    if (this.closed) {
      await this.close();
      this.finishTurn({ type: "turn-cancelled" });
      return { turnId: null, steered: false };
    }
    if (this.cancelRequested) {
      this.finishTurn({ type: "turn-cancelled" });
      return { turnId: null, steered: false };
    }
    this.inbox.push(userMessage(prompt, images));
    this.emit({ type: "turn-started", turnId });
    return { turnId, steered: false };
  }

  // A message for the running turn goes straight into Claude Code's input. Claude Code picks it up at
  // the next tool boundary; if the turn ends first, it starts a new turn for it (see readMessages).
  async steer(request) {
    await this.turnReady;
    if (!this.turnActive || !this.inbox || this.closed) return this.startTurn(request);
    this.inbox.push(userMessage(request.prompt, request.images));
    return { turnId: this.state.turnId, steered: true };
  }

  beginImplicitTurn() {
    const turnId = randomUUID();
    this.turnActive = true;
    this.cancelRequested = false;
    Object.assign(this.state, { turnId, hasText: false });
    this.turnReady = Promise.resolve();
    this.emit({ type: "turn-started", turnId });
  }

  async start(model, mode, effort, ultracode = false) {
    const { query } = await this.loadSdk();
    if (this.closed) return;
    this.stderr = "";
    this.child = null;
    this.inbox = new Inbox();
    this.model = model;
    this.mode = mode;
    this.effort = effort;
    this.ultracode = ultracode;
    this.query = query({
      prompt: this.inbox,
      options: {
        cwd: this.cwd,
        model,
        permissionMode: mode,
        ...(effort ? { effort } : {}),
        ...(ultracode ? { settings: { ultracode: true } } : {}),
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        pathToClaudeCodeExecutable: this.command,
        settingSources: ["user", "project", "local"],
        systemPrompt: { type: "preset", preset: "claude_code", append: MILAGRE_INSTRUCTIONS },
        canUseTool: (toolName, input, options) => this.askPermission(toolName, input, options),
        // Questions to the user are out of scope for now; Claude asks in its reply instead.
        disallowedTools: ["AskUserQuestion"],
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

  // Claude Code waits on this promise until the user answers in Milagre, the turn stops, or the SDK
  // aborts the request.
  askPermission(toolName, input, options = {}) {
    const request = claudeRequest(toolName, input, options);
    return new Promise((resolve) => {
      const abort = () => this.permissions.resolve(request.requestId, "cancelled");
      this.permissions.add(request, (decision) => {
        options.signal?.removeEventListener("abort", abort);
        resolve(claudeResult(decision, input, options.suggestions));
      });
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });
  }

  respondToPermission(requestId, decision) {
    return this.permissions.resolve(requestId, decision);
  }

  async readMessages(query) {
    try {
      for await (const message of query) {
        // Claude Code opens every turn with init. One arriving while no turn runs is a turn Claude Code
        // started by itself, for a steering message that came in just as the last turn ended.
        if (message.type === "system" && message.subtype === "init" && !this.turnActive && !this.closed) this.beginImplicitTurn();
        for (const event of mapClaudeMessage(message, this.state)) {
          if (!isTerminal(event)) this.emit(event);
          else if (this.cancelRequested) this.finishTurn({ type: "turn-cancelled" });
          else if (event.type === "turn-failed" && this.resumeGone(`${event.message}\n${message.errors ?? ""}\n${message.result ?? ""}`)) this.resumeFailed();
          else this.finishTurn(event);
        }
      }
      this.handleEnd(query, null);
    } catch (error) {
      this.handleEnd(query, error);
    }
  }

  // Only a "conversation is missing" failure may discard the saved id; spawn errors,
  // crashes and bad paths must keep it.
  resumeGone(text) {
    return Boolean(this.resumeId) && MISSING_CONVERSATION.test(`${text}\n${this.stderr}`);
  }

  handleEnd(query, error) {
    if (query !== this.query) return;
    this.query = null;
    this.closed = true;
    if (!this.turnActive) return;
    if (this.cancelRequested) this.finishTurn({ type: "turn-cancelled" });
    else if (this.resumeGone(error?.message ?? "")) this.resumeFailed();
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
    this.permissions.cancelAll();
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
    this.permissions.cancelAll();
    // interrupt() rejects with "Query closed before response received" when the query
    // closes first; that is expected during cancel and shutdown.
    await this.query?.interrupt().catch(() => {});
  }

  async close() {
    this.permissions.cancelAll();
    if (this.turnActive) this.cancelRequested = true;
    this.closed = true;
    this.inbox?.end();
    const query = this.query;
    this.query = null;
    // An async generator stuck on an await never settles return(), so don't wait forever.
    await Promise.race([query?.return?.().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await killTree(this.child);
    this.finishTurn({ type: "turn-cancelled" });
  }
}

module.exports = { ClaudeSession, CLAUDE_MODES };
