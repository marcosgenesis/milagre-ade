// The single writer of each Project's in-memory state. Disk I/O has its own bounded,
// coalescing write-behind path, so a slow save cannot stall another Chat's events.
class ProjectStates {
  /** `compact(key, next, previous)` (optional) slims a state before it is kept, e.g. moving tool output to sidecars. */
  constructor({ read, save, compact, debounceMs = 250 }) {
    Object.assign(this, { read, save, compact, debounceMs });
    this.states = new Map();
    this.queues = new Map();
    this.dirty = new Map();
    this.writes = new Map();
    this.timers = new Map();
    this.due = new Map();
    this.transient = new Set();
  }
  has(projectPath) {
    return this.states.has(projectPath);
  }
  projects() {
    return [...this.states.keys()];
  }
  /** Reconciled Worktree folders; never starts a Git process. */
  worktreePaths() {
    return [...this.states.values()].flatMap((state) => Object.values(state.worktrees ?? {}).map((worktree) => worktree.path));
  }
  async get(projectPath) {
    return (await this.update(projectPath, (state) => state)).state;
  }

  /** Serializes mutations, including async changes, but never waits for a save. */
  update(projectPath, change, { persist = true } = {}) {
    if (this.closed) return Promise.reject(new Error("Project state is closed"));
    const run = (this.queues.get(projectPath) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        let state = this.states.get(projectPath);
        if (state === undefined) {
          state = await this.slim(projectPath, await this.read(projectPath), null);
          this.states.set(projectPath, state);
        }
        const changed = await change(state);
        if (changed === state) return { state, changed: false };
        const next = await this.slim(projectPath, changed, state);
        this.states.set(projectPath, next);
        if (persist) {
          this.transient.delete(projectPath);
          this.dirty.set(projectPath, next);
          this.due.set(projectPath, Date.now() + this.debounceMs);
          this.schedule(projectPath);
        } else this.transient.add(projectPath);
        return { state: next, changed: true };
      });
    this.queues.set(projectPath, run);
    const forget = () => {
      if (this.queues.get(projectPath) === run) this.queues.delete(projectPath);
    };
    run.then(forget, forget);
    return run;
  }

  /** The state compacted; as it is when there is no compaction or it fails (the save tries again). */
  async slim(projectPath, next, previous) {
    if (!this.compact || !next) return next;
    try {
      return await this.compact(projectPath, next, previous);
    } catch (error) {
      console.warn(`Milagre couldn't move tool output out of ${projectPath}'s state:`, error.message);
      return next;
    }
  }

  schedule(projectPath) {
    clearTimeout(this.timers.get(projectPath));
    const timer = setTimeout(
      () => {
        this.timers.delete(projectPath);
        void this.write(projectPath).catch((error) => console.warn(`Milagre couldn't save ${projectPath}:`, error.message));
      },
      Math.max(0, (this.due.get(projectPath) ?? 0) - Date.now()),
    );
    timer.unref?.();
    this.timers.set(projectPath, timer);
  }

  /** At most one save per Project in flight; newer edits remain dirty. */
  write(projectPath) {
    if (this.writes.has(projectPath)) return this.writes.get(projectPath);
    if (!this.dirty.has(projectPath)) return Promise.resolve();
    const state = this.dirty.get(projectPath);
    this.dirty.delete(projectPath);
    let failed = false;
    const writing = Promise.resolve()
      .then(() => this.save(projectPath, state))
      .catch((error) => {
        failed = true;
        if (!this.dirty.has(projectPath)) this.dirty.set(projectPath, state);
        throw error;
      })
      .finally(() => {
        this.writes.delete(projectPath);
        // A timer may have fired during the save. Do not lose that newer edit.
        if (!failed && this.dirty.has(projectPath) && !this.timers.has(projectPath)) this.schedule(projectPath);
      });
    this.writes.set(projectPath, writing);
    return writing;
  }

  async close() {
    this.closed = true;
    await Promise.all([...this.queues.values()].map((work) => work.catch(() => {})));
    for (const projectPath of this.transient) this.dirty.set(projectPath, this.states.get(projectPath));
    this.transient.clear();
    return this.flush();
  }

  /** Durability boundary for quit and accepted user messages. Failed writes stay dirty and reject. */
  async flush(projectPath) {
    const entries = (map) => (projectPath === undefined ? [...map.entries()] : map.has(projectPath) ? [[projectPath, map.get(projectPath)]] : []);
    await Promise.all(entries(this.queues).map(([, work]) => work.catch(() => {})));
    await Promise.all(entries(this.writes).map(([, work]) => work.catch(() => {})));
    while (entries(this.dirty).length) {
      const pending = entries(this.dirty).map(([key]) => {
        clearTimeout(this.timers.get(key));
        this.timers.delete(key);
        return this.write(key);
      });
      await Promise.all(pending);
    }
  }
}
module.exports = { ProjectStates };
