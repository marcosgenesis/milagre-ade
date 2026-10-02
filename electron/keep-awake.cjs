const { isTerminal } = require("./agents/events.cjs");

// Keeps the Mac from suspending Milagre while an agent turn runs, in any chat. One
// `prevent-app-suspension` blocker holds from the first running turn to the last one's end;
// the display can still sleep. A closed or crashed chat releases its turn, turning the setting
// off releases at once, and quitting releases for good.
class KeepAwake {
  constructor({ powerSaveBlocker, enabled = true }) {
    this.blocker = powerSaveBlocker;
    this.enabled = enabled;
    this.quitting = false;
    this.running = new Set();
    this.blockerId = null;
  }

  get isHolding() {
    return this.blockerId !== null;
  }

  turnStarted(chatId) {
    this.running.add(chatId);
    this.sync();
  }

  turnEnded(chatId) {
    if (this.running.delete(chatId)) this.sync();
  }

  chatClosed(chatId) {
    this.turnEnded(chatId);
  }

  // Follows the agents' event stream: a turn starts with turn-started and ends with a terminal event.
  observe(chatId, event) {
    if (event.type === "turn-started") this.turnStarted(chatId);
    else if (isTerminal(event)) this.turnEnded(chatId);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.sync();
  }

  quit() {
    this.quitting = true;
    this.running.clear();
    this.sync();
  }

  sync() {
    const want = this.enabled && !this.quitting && this.running.size > 0;
    if (want && this.blockerId === null) {
      this.blockerId = this.blocker.start("prevent-app-suspension");
    } else if (!want && this.blockerId !== null) {
      const id = this.blockerId;
      this.blockerId = null;
      if (this.blocker.isStarted(id)) this.blocker.stop(id);
    }
  }
}

module.exports = { KeepAwake };
