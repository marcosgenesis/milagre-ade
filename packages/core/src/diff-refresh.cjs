const { isTurnEnd, projectOfKey, sessionIdFromKey } = require("@milagre/shared/agent-runs");
const { withDiffStats } = require("@milagre/shared/project-edits");

// A burst of edits makes one git call; focusing a window again re-reads at most this often.
const EDIT_DEBOUNCE = 1200;
const FOCUS_THROTTLE = 5000;
// Only these steps can change files; reads, searches, thinking, setup and image steps leave the stat as it was.
const FILE_STEP_KINDS = new Set(["edit", "shell", "other"]);

// Keeps each worktree's diff stat in its project's state, in every project, so a chat's hover card
// shows it at once. Re-read when a project is read, when a window regains focus (edits made outside
// Milagre), and after an agent's tool step or turn ends in one of the worktree's chats.
class DiffRefresher {
  /**
   * `readDiffStat(path, base)` reads a worktree's stat; `update(projectPath, change)` changes a project's
   * state as ProjectStates.update does, telling the windows.
   */
  constructor({ states, readDiffStat, update, debounceMs = EDIT_DEBOUNCE, throttleMs = FOCUS_THROTTLE, now = Date.now }) {
    Object.assign(this, { states, readDiffStat, update, debounceMs, throttleMs, now });
    this.timers = new Map();
    this.lastFocus = new Map();
    this.stepKinds = new Map();
    this.pending = [];
    this.active = 0;
  }

  /** Re-reads a chat's worktree shortly after one of its agent's tool steps or turns ends. */
  observe(chatId, event) {
    if (this.closed) return;
    // step-completed doesn't carry its kind; remember it from step-started. A step seen only at its end still refreshes.
    if (event.type === "step-started" && event.step) {
      if (!this.stepKinds.has(chatId)) this.stepKinds.set(chatId, new Map());
      this.stepKinds.get(chatId).set(event.step.id, event.step.kind);
    }
    if (event.type === "step-completed") {
      const kinds = this.stepKinds.get(chatId);
      const kind = kinds?.get(event.id);
      kinds?.delete(event.id);
      if (kind !== undefined && !FILE_STEP_KINDS.has(kind)) return;
    }
    if (isTurnEnd(event)) this.stepKinds.delete(chatId);
    if (event.type !== "step-completed" && !isTurnEnd(event)) return;
    clearTimeout(this.timers.get(chatId));
    const timer = setTimeout(() => {
      this.timers.delete(chatId);
      void this.refreshChat(chatId).catch(() => {});
    }, this.debounceMs);
    timer.unref?.();
    this.timers.set(chatId, timer);
  }

  /** Cancels queued reads; an already running Git process is allowed to finish. */
  close() {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.stepKinds.clear();
    for (const job of this.pending.splice(0)) job.resolve(null);
  }

  /** Refresh only the Project currently on screen. Switching Projects has its own throttle. */
  focused(projectPath) {
    if (this.closed || !projectPath || !this.states.has(projectPath)) return;
    if (this.now() - (this.lastFocus.get(projectPath) ?? -Infinity) < this.throttleMs) return;
    this.lastFocus.set(projectPath, this.now());
    void this.refresh(projectPath).catch(() => {});
  }

  read(worktree) {
    if (this.closed || !worktree) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.pending.push({ worktree, resolve });
      this.drain();
    });
  }

  drain() {
    while (!this.closed && this.active < 4 && this.pending.length) {
      const { worktree, resolve } = this.pending.shift();
      this.active++;
      Promise.resolve()
        .then(() => this.readDiffStat(worktree.path, worktree.base))
        .catch(() => null)
        .then(resolve)
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }

  async refreshChat(chatId) {
    const projectPath = projectOfKey(chatId);
    if (!this.states.has(projectPath)) return;
    const worktreeId = (await this.states.get(projectPath)).sessions[sessionIdFromKey(chatId)]?.worktree_id;
    if (worktreeId !== undefined) await this.refresh(projectPath, [worktreeId]);
  }

  /** Re-reads the given worktrees, or every worktree that has a chat, and saves their stats. */
  async refresh(projectPath, worktreeIds) {
    if (this.closed) return;
    const state = await this.states.get(projectPath);
    const ids = worktreeIds ?? [...new Set(state.messages.map((message) => state.sessions[message.session_id]?.worktree_id).filter((id) => id !== undefined))];
    const stats = await Promise.all(
      ids.map(async (id) => {
        const worktree = state.worktrees[id];
        return [id, await this.read(worktree)];
      }),
    );
    if (this.closed) return;
    // Applied to the latest state: turns may have finished while git ran.
    await this.update(projectPath, (latest) => withDiffStats(latest, Object.fromEntries(stats)));
  }
}

module.exports = { DiffRefresher };
