const { isTurnEnd, projectOfKey, sessionIdFromKey } = require("@milagre/shared/agent-runs");
const { withDiffStats } = require("@milagre/shared/project-edits");

// A burst of edits makes one git call; focusing a window again re-reads at most this often.
const EDIT_DEBOUNCE = 1200;
const FOCUS_THROTTLE = 5000;

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
    this.lastFocus = -Infinity;
  }

  /** Re-reads a chat's worktree shortly after one of its agent's tool steps or turns ends. */
  observe(chatId, event) {
    if (this.closed) return;
    if (event.type !== "step-completed" && !isTurnEnd(event)) return;
    clearTimeout(this.timers.get(chatId));
    const timer = setTimeout(() => {
      this.timers.delete(chatId);
      void this.refreshChat(chatId).catch(() => {});
    }, this.debounceMs);
    timer.unref?.();
    this.timers.set(chatId, timer);
  }

  /** Re-reads every project read this run, at most once per throttle period. */
  close() {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  focused() {
    if (this.closed) return;
    if (this.now() - this.lastFocus < this.throttleMs) return;
    this.lastFocus = this.now();
    for (const projectPath of this.states.projects()) void this.refresh(projectPath).catch(() => {});
  }

  async refreshChat(chatId) {
    const projectPath = projectOfKey(chatId);
    if (!this.states.has(projectPath)) return;
    const worktreeId = (await this.states.get(projectPath)).sessions[sessionIdFromKey(chatId)]?.worktree_id;
    if (worktreeId !== undefined) await this.refresh(projectPath, [worktreeId]);
  }

  /** Re-reads the given worktrees, or every worktree that has a chat, and saves their stats. */
  async refresh(projectPath, worktreeIds) {
    const state = await this.states.get(projectPath);
    const ids = worktreeIds ?? [...new Set(state.messages.map((message) => state.sessions[message.session_id]?.worktree_id).filter((id) => id !== undefined))];
    const stats = await Promise.all(ids.map(async (id) => {
      const worktree = state.worktrees[id];
      return [id, worktree ? await this.readDiffStat(worktree.path, worktree.base).catch(() => null) : null];
    }));
    if (this.closed) return;
    // Applied to the latest state: turns may have finished while git ran.
    await this.update(projectPath, (latest) => withDiffStats(latest, Object.fromEntries(stats)));
  }
}

module.exports = { DiffRefresher };
