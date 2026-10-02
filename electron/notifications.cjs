const { isTerminal } = require("./agents/events.cjs");

const MAX_TITLE = 120;
const MAX_BODY = 240;

const capped = (value, max) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const keyOf = (chatId, requestId) => `${chatId}\n${requestId}`;

// System notifications for chats that wait on the user: an approval or a question. The main process
// sees every agent event first (observe), so it knows which requests are still open; the renderer
// names the chat and asks to notify. One shows only while no Milagre window has focus, once per
// request, and closes when its request is answered or its turn ends. Clicking it opens the chat.
class AttentionNotifier {
  constructor({ createNotification, isAppFocused, openChat }) {
    Object.assign(this, { createNotification, isAppFocused, openChat });
    // Requests the agents wait on, by key, with the notification shown for each (or null).
    this.open = new Map();
  }

  observe(chatId, event) {
    if (event.type === "permission-request" || event.type === "question-request") {
      const key = keyOf(chatId, event.requestId);
      if (!this.open.has(key)) this.open.set(key, null);
    } else if (event.type === "permission-resolved" || event.type === "question-resolved") {
      this.close(keyOf(chatId, event.requestId));
    } else if (isTerminal(event)) {
      for (const key of [...this.open.keys()]) if (key.startsWith(`${chatId}\n`)) this.close(key);
    }
  }

  // The renderer is untrusted input: it can only notify about a request an agent is waiting on.
  notify({ chatId, requestId, title, subtitle, body } = {}) {
    const key = keyOf(String(chatId), String(requestId));
    if (!this.open.has(key) || this.open.get(key) || this.isAppFocused()) return false;
    const notification = this.createNotification({ title: capped(title, MAX_TITLE) || "Milagre", subtitle: capped(subtitle, MAX_TITLE), body: capped(body, MAX_BODY) });
    notification.on("click", () => this.openChat(String(chatId)));
    this.open.set(key, notification);
    notification.show();
    return true;
  }

  close(key) {
    const notification = this.open.get(key);
    this.open.delete(key);
    notification?.close();
  }

  closeAll() {
    for (const key of [...this.open.keys()]) this.close(key);
  }
}

module.exports = { AttentionNotifier };
