const { isTurnEnd: isTerminal } = require("@milagre/shared/agent-runs");

const MAX_TITLE = 120;
const MAX_BODY = 240;

const capped = (value, max) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const keyOf = (chatId, requestId) => `${chatId}\n${requestId}`;

// System notifications for chats that wait on the user: an approval or a question. Every agent event
// is observed, so the notifier knows which requests are still open, and notify names the chat. One shows only while no Milagre window has focus, once per
// request, and closes when its request is answered or its turn ends. Clicking it opens the chat.
class AttentionNotifier {
  /** @param {{ createNotification: (notice: {title: string; subtitle: string; body: string}) => Electron.Notification; isAppFocused: () => boolean; openChat: (chatId: string) => void; openPhoneSettings?: () => void; setBadge?: (badge: string) => void }} options */
  constructor({ createNotification, isAppFocused, openChat, openPhoneSettings = () => {}, setBadge = () => {} }) {
    this.createNotification = createNotification;
    this.isAppFocused = isAppFocused;
    this.openChat = openChat;
    this.openPhoneSettings = openPhoneSettings;
    this.setBadge = setBadge;
    /** @type {Electron.Notification | null} */
    this.phonePaired = null;
    this.previews = new Map();
    this.completed = new Map();
    this.completionNotifications = new Map();
    this.unread = new Set();
    /** @type {string | null} */
    this.activeChatId = null;
    this.notifyOnCompletion = true;
    this.showDockBadge = true;
    // Requests the agents wait on, by key, with the notification shown for each (or null).
    this.open = new Map();
  }

  /** @param {{ projectPath?: string; activeChatId?: string | null; unread?: string[]; notifyOnCompletion?: boolean; showDockBadge?: boolean }} [state] */
  sync({ projectPath, activeChatId = null, unread = [], notifyOnCompletion = true, showDockBadge = true } = {}) {
    this.activeChatId = typeof activeChatId === "string" ? activeChatId : null;
    this.notifyOnCompletion = notifyOnCompletion === true;
    this.showDockBadge = showDockBadge === true;
    if (typeof projectPath === "string") {
      const prefix = `${projectPath}#`;
      for (const id of this.unread) if (id.startsWith(prefix)) this.unread.delete(id);
      if (Array.isArray(unread)) for (const id of unread) if (typeof id === "string" && id.startsWith(prefix)) this.unread.add(id);
      for (const [id, notification] of this.completionNotifications) {
        if (id.startsWith(prefix) && !this.unread.has(id)) {
          notification.close();
          this.completionNotifications.delete(id);
        }
      }
    }
    this.updateBadge();
  }

  updateBadge() {
    const chats = new Set(this.unread);
    for (const key of this.open.keys()) chats.add(key.slice(0, key.lastIndexOf("\n")));
    this.setBadge(this.showDockBadge && chats.size ? String(chats.size) : "");
  }

  observe(chatId, event) {
    if (event.type === "turn-started") {
      this.previews.delete(chatId);
      this.completed.delete(chatId);
    } else if (event.type === "text-delta") {
      this.previews.set(chatId, ((this.previews.get(chatId) || "") + event.text).slice(-MAX_BODY));
    }
    if (isTerminal(event)) {
      if (event.type !== "turn-cancelled")
        this.completed.set(chatId, {
          failed: event.type === "turn-failed",
          body: event.type === "turn-failed" ? event.message : this.previews.get(chatId) || "Turn completed.",
        });
      else this.completed.delete(chatId);
      this.previews.delete(chatId);
      if (this.completed.size > 100) this.completed.delete(this.completed.keys().next().value);
    }
    if (event.type === "permission-request" || event.type === "question-request") {
      const key = keyOf(chatId, event.requestId);
      if (!this.open.has(key)) this.open.set(key, null);
    } else if (event.type === "permission-resolved" || event.type === "question-resolved") {
      this.close(keyOf(chatId, event.requestId));
    } else if (isTerminal(event)) {
      for (const key of [...this.open.keys()]) if (key.startsWith(`${chatId}\n`)) this.close(key);
    }
    this.updateBadge();
  }

  // Only a request an agent still waits on is notified about.
  /** @param {{ chatId?: string; requestId?: string; title?: string; subtitle?: string; body?: string }} [notice] */
  notify({ chatId, requestId, title, subtitle, body } = {}) {
    const key = keyOf(String(chatId), String(requestId));
    if (!this.open.has(key) || this.open.get(key) || this.isAppFocused()) return false;
    const notification = this.createNotification({
      title: capped(title, MAX_TITLE) || "Milagre",
      subtitle: capped(subtitle, MAX_TITLE),
      body: capped(body, MAX_BODY),
    });
    notification.on("click", () => this.openChat(String(chatId)));
    this.open.set(key, notification);
    notification.show();
    return true;
  }

  /** @param {{ chatId?: string; title?: string; subtitle?: string }} [notice] */
  notifyCompletion({ chatId, title, subtitle } = {}) {
    if (typeof chatId !== "string") return false;
    const result = this.completed.get(chatId);
    this.completed.delete(chatId);
    if (!result || !this.notifyOnCompletion || (this.isAppFocused() && this.activeChatId === chatId)) return false;
    const notification = this.createNotification({
      title: `${capped(title, MAX_TITLE) || "Milagre"} - ${result.failed ? "Turn failed" : "Turn completed"}`,
      subtitle: capped(subtitle, MAX_TITLE),
      body: capped(result.body, MAX_BODY),
    });
    this.completionNotifications.get(chatId)?.close();
    this.completionNotifications.set(chatId, notification);
    notification.on("click", () => this.openChat(chatId));
    notification.show();
    return true;
  }

  // A device paired with this Mac for the first time: a phone, or ("computer") another Mac that can now drive this one.
  // Shown even while Milagre has focus: it is about who can reach the agents, and the pairing window opens just by
  // looking at Settings → Devices. Clicking it opens that page.
  notifyDevicePaired(kind = "phone") {
    const computer = kind === "computer";
    const notification = this.createNotification({
      title: computer ? "New computer paired" : "New phone paired",
      subtitle: "",
      body: computer
        ? "Another Mac can now drive your agents on this Mac. If it wasn't you, remove it in Settings → Devices."
        : "A phone can now reach your agents on this Mac. If it wasn't you, remove it in Settings → Devices.",
    });
    this.phonePaired?.close();
    this.phonePaired = notification;
    notification.on("click", () => this.openPhoneSettings());
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
    for (const notification of this.completionNotifications.values()) notification.close();
    this.completionNotifications.clear();
    this.completed.clear();
    this.previews.clear();
    this.setBadge("");
  }
}

module.exports = { AttentionNotifier };
