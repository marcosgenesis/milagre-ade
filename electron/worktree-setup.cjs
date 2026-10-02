const { spawn } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { killTree } = require("./agents/process-tree.cjs");
const { capOutput, code, formatDuration } = require("./agents/steps.cjs");

// A command a new worktree runs once, before its chat's first turn (`npm ci`, `uv sync`): the project's
// setting, or `setup` in .milagre/worktree.json at the repo root, which wins like .worktreeinclude does
// for the files to copy. A repo's command runs code the user didn't write, so it runs only once they
// approve that exact command for that repository; one they typed in Settings is approved by typing it.

const SETUP_FILE = ".milagre/worktree.json";
const SETUP_TIMEOUT_MS = 10 * 60 * 1000;
const NOTE_LINES = 40;
const BATCH_MS = 50;
// Shells that take `-l -c`; any other $SHELL runs the command in zsh, the macOS default.
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "ksh"]);
// Once the shell exits, output still in the pipes gets this long; a background process it left holding them doesn't hold the turn.
const DRAIN_MS = 500;

/**
 * The command new worktrees run: { source: "repo" | "setting" | "none", command, note? }. A repo file that
 * sets `setup` is in charge even when it sets it empty (the repo runs nothing). A file that isn't valid
 * JSON, or whose `setup` isn't a string, is ignored with a note, and the setting applies.
 */
async function resolveSetupCommand(projectPath, setting) {
  const fallback = (note) => {
    const command = typeof setting === "string" ? setting.trim() : "";
    return { source: command ? "setting" : "none", command: command || null, ...(note ? { note } : {}) };
  };
  let text;
  try {
    text = await fs.readFile(path.join(projectPath, SETUP_FILE), "utf8");
  } catch {
    return fallback();
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fallback(`${SETUP_FILE} isn't valid JSON, so Milagre ignored it.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.setup === undefined) return fallback();
  if (typeof parsed.setup !== "string") return fallback(`"setup" in ${SETUP_FILE} must be a string, so Milagre ignored it.`);
  return { source: "repo", command: parsed.setup.trim() || null };
}

/** What an approval is remembered by: the repository and the exact command, so a changed command asks again. */
function trustKey(projectPath, command) {
  return createHash("sha256").update(JSON.stringify([path.resolve(projectPath), command])).digest("hex");
}

/** Approved repo commands, kept in Milagre's data folder. A file that can't be read approves nothing. */
function createSetupTrust(file) {
  let queue = Promise.resolve();
  async function read() {
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      return parsed && typeof parsed.approved === "object" && parsed.approved ? parsed : { approved: {} };
    } catch {
      return { approved: {} };
    }
  }
  return {
    async isApproved(projectPath, command) {
      return Object.hasOwn((await read()).approved, trustKey(projectPath, command));
    },
    approve(projectPath, command) {
      const save = queue.catch(() => {}).then(async () => {
        const data = await read();
        data.approved[trustKey(projectPath, command)] = Date.now();
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(data, null, 2));
        await fs.rename(temporary, file);
      });
      queue = save;
      return save;
    },
  };
}

function loginShell(env) {
  return env.SHELL && SHELLS.has(path.basename(env.SHELL)) ? env.SHELL : "/bin/zsh";
}

/**
 * Runs the command in `cwd` through the login shell, so npm, pnpm or uv resolve as in the user's terminal.
 * Resolves (never rejects) to { status: "done" | "failed" | "timed-out" | "cancelled", exitCode, signal,
 * error?, output, durationMs }. A timeout or an aborted `signal` stops the shell and everything it started.
 */
function runSetupCommand({ command, cwd, env = process.env, shell = loginShell(env), timeoutMs = SETUP_TIMEOUT_MS, signal, onOutput = () => {}, now = Date.now }) {
  const started = now();
  return new Promise((resolve) => {
    let output = "";
    let stopped = null;
    let killing = null;
    let settled = false;
    let child;
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (killing) await killing;
      resolve({ exitCode: null, signal: null, ...result, ...(stopped ? { status: stopped } : {}), output, durationMs: now() - started });
    };
    const stop = (why) => {
      if (settled || stopped) return;
      stopped = why;
      killing = killTree(child);
    };
    const onAbort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timed-out"), timeoutMs);
    try {
      child = spawn(shell, ["-l", "-c", command], { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    } catch (error) {
      void finish({ status: "failed", error: error.message });
      return;
    }
    const append = (chunk) => {
      const text = chunk.toString("utf8");
      output = capOutput(output + text);
      onOutput(text);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => void finish({ status: "failed", error: error.message }));
    child.on("exit", (exitCode, exitSignal) => {
      const result = { status: exitCode === 0 ? "done" : "failed", exitCode, signal: exitSignal };
      const drained = () => void finish(result);
      if (child.stdout.readableEnded && child.stderr.readableEnded) return drained();
      child.on("close", drained);
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        drained();
      }, DRAIN_MS).unref?.();
    });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** The last `lines` lines of command output, without colour codes or trailing blank lines. */
function outputTail(text, lines = NOTE_LINES) {
  const trimmed = String(text ?? "").replace(ANSI, "").replace(/\s+$/, "");
  return trimmed ? trimmed.split(/\r?\n/).slice(-lines).join("\n") : "";
}

function failureReason(result, timeoutMs) {
  if (result.status === "timed-out") return `timed out after ${formatDuration(timeoutMs)}`;
  if (result.error) return `couldn't start (${result.error})`;
  if (result.exitCode !== null && result.exitCode !== undefined) return `failed with exit code ${result.exitCode}`;
  return `was stopped by ${result.signal ?? "a signal"}`;
}

/** What the agent's first prompt gets after a setup that failed or timed out; nothing after one that worked or was stopped. */
function setupNote(command, result, timeoutMs = SETUP_TIMEOUT_MS) {
  if (result.status !== "failed" && result.status !== "timed-out") return "";
  const tail = outputTail(result.output);
  return `Note: the worktree setup command \`${command}\` ${failureReason(result, timeoutMs)}.${tail ? ` Last output:\n${tail}` : ""}`;
}

function setupStarted(id, command) {
  return { type: "step-started", step: { id, kind: "shell", title: `Set up worktree: ${code(command)}`, detail: `$ ${command}\n` } };
}

function setupCompleted(id, command, result, timeoutMs = SETUP_TIMEOUT_MS) {
  const took = formatDuration(result.durationMs);
  const failed = result.exitCode !== null && result.exitCode !== undefined ? `exited with code ${result.exitCode} after ${took}` : `failed after ${took}`;
  const end = { done: `in ${took}`, cancelled: `stopped after ${took}`, "timed-out": `timed out after ${formatDuration(timeoutMs)}` }[result.status] ?? failed;
  const why = result.status === "failed" ? `\n${result.error ?? (result.exitCode !== null ? `Exited with code ${result.exitCode}` : `Stopped by ${result.signal}`)}` : "";
  return { type: "step-completed", id, status: result.status === "done" ? "done" : "failed", title: `Set up worktree: ${code(command)} ${end}`, detail: capOutput(`$ ${command}\n${result.output}${why}`), durationMs: result.durationMs };
}

/**
 * The setup commands waiting for their worktree's first turn, and the ones running. `send(chatId, event)`
 * shows a run as a shell step at the start of the chat's reply, its output streamed in batches.
 */
class WorktreeSetups {
  constructor({ send, trust, run = runSetupCommand, timeoutMs = SETUP_TIMEOUT_MS, batchMs = BATCH_MS }) {
    Object.assign(this, { send, trust, run, timeoutMs, batchMs });
    this.pending = new Map();
    this.running = new Map();
  }

  /** Records what a new worktree runs before its first turn. Resolves to what the renderer asks about, or null. */
  async prepare({ worktreePath, projectPath, resolved }) {
    if (!resolved.command) return null;
    const approved = resolved.source === "setting" || (await this.trust.isApproved(projectPath, resolved.command));
    this.pending.set(worktreePath, { projectPath, command: resolved.command, source: resolved.source, approved });
    return { command: resolved.command, source: resolved.source, approved };
  }

  /** The user's answer to the trust dialog. "run" remembers the command for the repository; "skip" drops it for this worktree. */
  async decide(worktreePath, decision) {
    const entry = this.pending.get(worktreePath);
    if (!entry) return false;
    if (decision === "run") {
      await this.trust.approve(entry.projectPath, entry.command);
      entry.approved = true;
    } else {
      this.pending.delete(worktreePath);
    }
    return true;
  }

  forget(worktreePath) {
    this.pending.delete(worktreePath);
  }

  /**
   * Runs the worktree's approved setup before the chat's first turn and resolves to { cancelled, note }.
   * A message sent while it runs waits for the same run. A command nobody approved never runs.
   */
  async beforeTurn(chatId, cwd) {
    const active = this.running.get(chatId);
    if (active) return { cancelled: (await active.done).status === "cancelled", note: "" };
    const entry = this.pending.get(cwd);
    if (!entry) return { cancelled: false, note: "" };
    this.pending.delete(cwd);
    if (!entry.approved) return { cancelled: false, note: "" };
    const result = await this.start(chatId, cwd, entry.command);
    return { cancelled: result.status === "cancelled", note: setupNote(entry.command, result, this.timeoutMs) };
  }

  start(chatId, cwd, command) {
    const id = `setup-${randomUUID()}`;
    const controller = new AbortController();
    let buffered = "";
    let timer = null;
    const flush = () => {
      clearTimeout(timer);
      timer = null;
      if (buffered) this.send(chatId, { type: "step-output", id, text: buffered });
      buffered = "";
    };
    this.send(chatId, setupStarted(id, command));
    const done = this.run({
      command,
      cwd,
      timeoutMs: this.timeoutMs,
      signal: controller.signal,
      onOutput: (text) => {
        buffered = capOutput(buffered + text);
        timer ??= setTimeout(flush, this.batchMs);
      },
    }).then((result) => {
      flush();
      this.send(chatId, setupCompleted(id, command, result, this.timeoutMs));
      return result;
    }).finally(() => this.running.delete(chatId));
    this.running.set(chatId, { controller, done });
    return done;
  }

  /** Stops a chat's running setup (Escape, archive) and waits until it and what it started are gone. */
  async cancel(chatId) {
    const active = this.running.get(chatId);
    if (!active) return;
    active.controller.abort();
    await active.done.catch(() => {});
  }

  cancelAll() {
    return Promise.all([...this.running.keys()].map((chatId) => this.cancel(chatId)));
  }
}

module.exports = { SETUP_FILE, SETUP_TIMEOUT_MS, WorktreeSetups, createSetupTrust, outputTail, resolveSetupCommand, runSetupCommand, setupCompleted, setupNote, setupStarted, trustKey };
