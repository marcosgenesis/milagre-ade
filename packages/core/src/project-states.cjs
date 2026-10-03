// The latest state of every project Milagre has read this run, and the only way to change one. Chats
// in several projects can finish at once, and the renderer edits state too, so every change to a
// project runs one at a time against its latest state, and is saved before the next one starts.
// A change that leaves the state as it was saves nothing. A save that fails keeps the change in
// memory, so the next one retries it.

class ProjectStates {
  /** `read(projectPath)` loads a project's state the first time it's needed; `save(projectPath, state)` writes it. */
  constructor({ read, save }) {
    Object.assign(this, { read, save });
    this.states = new Map();
    this.queues = new Map();
  }

  /** Whether the project has been read this run. */
  has(projectPath) {
    return this.states.has(projectPath);
  }

  /** The paths of the projects read this run. */
  projects() {
    return [...this.states.keys()];
  }

  /** Active Worktree folders already reconciled by readProject; never starts a Git process. */
  worktreePaths() {
    return [...this.states.values()].flatMap(state => Object.values(state.worktrees ?? {}).map(worktree => worktree.path));
  }

  /** The project's latest state, read first if it hasn't been. */
  async get(projectPath) {
    return (await this.update(projectPath, (state) => state)).state;
  }

  /**
   * Runs `change(state)` once every earlier change to the project has finished. It returns the next
   * state, or the same object to change nothing, and may be async. Resolves with the state after the
   * change and whether it changed.
   */
  update(projectPath, change) {
    if (this.closed) return Promise.reject(new Error("Project state is closed"));
    const run = (this.queues.get(projectPath) ?? Promise.resolve()).catch(() => {}).then(async () => {
      let state = this.states.get(projectPath);
      if (state === undefined) {
        state = await this.read(projectPath);
        this.states.set(projectPath, state);
      }
      const next = await change(state);
      if (next === state) return { state, changed: false };
      this.states.set(projectPath, next);
      try {
        await this.save(projectPath, next);
      } catch (error) {
        console.warn(`Milagre couldn't save ${projectPath}:`, error.message);
      }
      return { state: next, changed: true };
    });
    this.queues.set(projectPath, run);
    const forget = () => {
      if (this.queues.get(projectPath) === run) this.queues.delete(projectPath);
    };
    run.then(forget, forget);
    return run;
  }

  close() {
    this.closed = true;
    return this.flush();
  }

  /** Waits for every change already asked for. */
  async flush() {
    await Promise.all([...this.queues.values()].map((run) => run.catch(() => {})));
  }
}

module.exports = { ProjectStates };
