const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { CodexRpc } = require("./codex-rpc.cjs");
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, isTerminal, mapCodexNotification, missingCliMessage } = require("./events.cjs");
const { PendingPermissions, codexCommandRequest, codexDecision, codexFileRequest } = require("./permissions.cjs");

// Milagre permission mode -> Codex policy. Ask asks before any command Codex doesn't already trust,
// Auto only when Codex wants to go beyond the workspace sandbox, and Full never asks.
function codexPolicy(permissionMode, cwd) {
  if (permissionMode === "full") return { approvalPolicy: "never", sandbox: "danger-full-access", sandboxPolicy: { type: "dangerFullAccess" } };
  return {
    approvalPolicy: permissionMode === "auto" ? "on-request" : "untrusted",
    sandbox: "workspace-write",
    sandboxPolicy: { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
  };
}

async function writeImages(images) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "milagre-images-"));
  const paths = [];
  for (const [index, image] of images.entries()) {
    const file = path.join(directory, `${index}.${image.mime.split("/")[1]}`);
    await fs.writeFile(file, image.bytes, { mode: 0o600 });
    paths.push(file);
  }
  return { paths, cleanup: () => fs.rm(directory, { recursive: true, force: true }) };
}

const turnInput = (prompt, files) => [{ type: "text", text: prompt, text_elements: [] }, ...(files?.paths ?? []).map((file) => ({ type: "localImage", path: file }))];

class CodexSession {
  constructor({ cwd, resumeId, command, emit, clientVersion = "0.0.0", interruptGraceMs = 3000, createRpc = (options) => new CodexRpc(options) }) {
    Object.assign(this, { cwd, resumeId, command, emit, clientVersion, interruptGraceMs, createRpc });
    this.state = { threadId: resumeId ?? null, turnId: null, lastItemId: null, hasText: false };
    this.rpc = null;
    this.starting = null;
    this.turnActive = false;
    this.cancelRequested = false;
    // Image files written for this turn's messages; removed when the turn ends.
    this.imageSets = [];
    // Settle once the running turn has its id (or failed to start), and once it has ended.
    this.turnReady = Promise.resolve();
    this.turnEnded = Promise.resolve();
    this.ready = false;
    this.closed = false;
    this.permissions = new PendingPermissions((event) => this.emit(event));
    // fileChange items by id, from item/started: their approval requests carry no diff of their own.
    this.fileChanges = new Map();
  }

  get nativeId() {
    return this.state.threadId;
  }

  async startTurn(request) {
    if (this.turnActive) return this.steer(request);
    if (!this.command) {
      this.emit({ type: "turn-failed", message: missingCliMessage("codex") });
      return { turnId: null, steered: false };
    }
    this.turnActive = true;
    this.cancelRequested = false;
    Object.assign(this.state, { turnId: null, lastItemId: null, hasText: false });
    let markReady;
    this.turnReady = new Promise((resolve) => { markReady = resolve; });
    this.turnEnded = new Promise((resolve) => { this.markTurnEnded = resolve; });
    try {
      return await this.beginTurn(request);
    } finally {
      markReady();
    }
  }

  async beginTurn({ prompt, images = [], model, permissionMode, effort }) {
    const policy = codexPolicy(permissionMode, this.cwd);
    try {
      this.starting ??= this.start(model, policy);
      await this.starting;
      if (this.cancelRequested) {
        await this.finishTurn([{ type: "turn-cancelled" }]);
        return { turnId: null, steered: false };
      }
      const files = images.length ? await writeImages(images) : null;
      if (files) this.imageSets.push(files);
      const { turn } = await this.rpc.request("turn/start", {
        threadId: this.state.threadId,
        input: turnInput(prompt, files),
        model,
        ...(effort ? { effort } : {}),
        approvalPolicy: policy.approvalPolicy,
        sandboxPolicy: policy.sandboxPolicy,
      }, { timeoutMs: 90_000 });
      this.state.turnId ??= turn?.id ?? null;
      if (this.cancelRequested) void this.interrupt();
      return { turnId: this.state.turnId, steered: false };
    } catch (error) {
      if (error.resumeFailed) {
        await this.finishTurn([{ type: "session-reset" }, { type: "turn-failed", message: RESUME_FAILED_MESSAGE }]);
        await this.close();
      } else {
        await this.finishTurn([this.cancelRequested ? { type: "turn-cancelled" } : { type: "turn-failed", message: error.message }]);
        // A session that never finished starting is unusable; closing it lets the manager start over.
        if (!this.ready) await this.close();
      }
      return { turnId: null, steered: false };
    }
  }

  // A message for the running turn joins it through turn/steer, once the turn has an id. If Codex
  // refuses because the turn already ended, the message starts the next turn instead.
  async steer(request) {
    await this.turnReady;
    if (!this.turnActive) return this.startTurn(request);
    // Without a turn id Codex can't be steered; send the message as the next turn once this one ends.
    if (!this.state.turnId) {
      await this.turnEnded;
      return this.startTurn(request);
    }
    const turnId = this.state.turnId;
    const files = request.images?.length ? await writeImages(request.images) : null;
    if (files) this.imageSets.push(files);
    try {
      await this.rpc.request("turn/steer", { threadId: this.state.threadId, expectedTurnId: turnId, input: turnInput(request.prompt, files) });
      return { turnId, steered: true };
    } catch (error) {
      if (!error.rpcError) throw error;
      await this.turnEnded;
      return this.startTurn(request);
    }
  }

  async start(model, policy) {
    const rpc = this.createRpc({ command: this.command, cwd: this.cwd });
    this.rpc = rpc;
    rpc.on("notification", ({ method, params }) => this.handleNotification(method, params));
    rpc.on("request", ({ id, method, params }) => this.handleServerRequest(id, method, params));
    rpc.on("exit", ({ detail }) => this.handleExit(detail));
    rpc.start();
    await rpc.request("initialize", { clientInfo: { name: "milagre", title: "Milagre", version: this.clientVersion }, capabilities: null });
    rpc.notify("initialized");
    const threadParams = { cwd: this.cwd, model, approvalPolicy: policy.approvalPolicy, sandbox: policy.sandbox, developerInstructions: MILAGRE_INSTRUCTIONS };
    const thread = this.resumeId ? await this.resume(threadParams) : (await rpc.request("thread/start", threadParams, { timeoutMs: 60_000 })).thread;
    if (thread?.id && thread.id !== this.state.threadId) {
      this.state.threadId = thread.id;
      this.emit({ type: "session-started", nativeId: thread.id });
    }
    this.ready = true;
  }

  async resume(threadParams) {
    const params = { ...threadParams, threadId: this.resumeId };
    try {
      return (await this.rpc.request("thread/resume", params, { timeoutMs: 60_000 })).thread;
    } catch (first) {
      // Only an answer from Codex itself means the thread is gone; timeouts and exits keep the saved id.
      if (!first.rpcError) throw first;
      try {
        await this.rpc.request("thread/unarchive", { threadId: this.resumeId });
        return (await this.rpc.request("thread/resume", params, { timeoutMs: 60_000 })).thread;
      } catch (second) {
        if (!second.rpcError) throw second;
        throw Object.assign(new Error(RESUME_FAILED_MESSAGE), { resumeFailed: true });
      }
    }
  }

  handleNotification(method, params) {
    if (method === "item/started" && params.item?.type === "fileChange") this.fileChanges.set(params.item.id, params.item.changes ?? []);
    if (method === "serverRequest/resolved") this.permissions.forget(String(params.requestId));
    if (method === "turn/started" && params.threadId === this.state.threadId) this.state.turnId ??= params.turn?.id ?? null;
    const events = mapCodexNotification(method, params, this.state);
    if (!events.some(isTerminal)) {
      events.forEach((event) => this.emit(event));
      return;
    }
    void this.finishTurn(this.cancelRequested ? events.map((event) => (isTerminal(event) ? { type: "turn-cancelled" } : event)) : events);
  }

  handleServerRequest(id, method, params = {}) {
    const answer = (decision) => this.reply(id, { decision: codexDecision(decision) });
    if (method === "item/commandExecution/requestApproval") this.permissions.add(codexCommandRequest(id, params), answer);
    else if (method === "item/fileChange/requestApproval") this.permissions.add(codexFileRequest(id, params, this.fileChanges.get(params.itemId)), answer);
    // Granting extra sandbox permissions is out of scope: grant none, for this turn only.
    else if (method === "item/permissions/requestApproval") this.reply(id, { permissions: {}, scope: "turn" });
    else {
      try {
        this.rpc.respondError(id, `Milagre does not support ${method} yet.`);
      } catch {}
    }
  }

  // Codex may already have exited; then there is nobody left to answer.
  reply(id, result) {
    try {
      this.rpc?.respond(id, result);
    } catch {}
  }

  respondToPermission(requestId, decision) {
    return this.permissions.resolve(requestId, decision);
  }

  handleExit(detail) {
    this.closed = true;
    void this.finishTurn([this.cancelRequested ? { type: "turn-cancelled" } : { type: "turn-failed", message: `Codex stopped: ${detail}` }]);
  }

  async finishTurn(events) {
    if (!this.turnActive) return;
    this.turnActive = false;
    clearTimeout(this.interruptTimer);
    this.permissions.cancelAll();
    this.fileChanges.clear();
    const imageSets = this.imageSets;
    this.imageSets = [];
    await Promise.all(imageSets.map((files) => files.cleanup().catch(() => {})));
    events.forEach((event) => this.emit(event));
    this.markTurnEnded?.();
  }

  async interrupt() {
    if (!this.turnActive) return;
    this.cancelRequested = true;
    clearTimeout(this.interruptTimer);
    this.interruptTimer = setTimeout(() => void this.stopNow(), this.interruptGraceMs);
    this.permissions.cancelAll();
    if (!this.state.turnId || !this.rpc) return;
    try {
      await this.rpc.request("turn/interrupt", { threadId: this.state.threadId, turnId: this.state.turnId }, { timeoutMs: this.interruptGraceMs });
    } catch {
      await this.close();
    }
  }

  // Fallback for an interrupt Codex doesn't honour: kill the process, and end the turn
  // ourselves in case nothing was spawned yet (or the exit event never comes).
  async stopNow() {
    await this.close();
    await this.finishTurn([{ type: "turn-cancelled" }]);
  }

  async close() {
    this.permissions.cancelAll();
    if (this.turnActive) this.cancelRequested = true;
    this.closed = true;
    await this.rpc?.close();
  }
}

module.exports = { CodexSession, codexPolicy };
