const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { AttentionNotifier } = require("./notifications.cjs");

function setup({ focused = false } = {}) {
  const shown = [];
  const opened = [];
  const state = { focused };
  const notifier = new AttentionNotifier({
    createNotification: (options) => {
      const notification = Object.assign(new EventEmitter(), { options, visible: false, closed: false });
      notification.show = () => { notification.visible = true; };
      notification.close = () => { notification.closed = true; };
      shown.push(notification);
      return notification;
    },
    isAppFocused: () => state.focused,
    openChat: (chatId) => opened.push(chatId),
  });
  return { notifier, shown, opened, state };
}

const question = { type: "question-request", requestId: "q1", questions: [] };
const notice = { chatId: "/shop#2", requestId: "q1", title: "shop / main - Claude needs input", subtitle: "Fix login", body: "Which color?" };

test("notifies once about a request the agent waits on while Milagre is in the background", () => {
  const { notifier, shown } = setup();
  notifier.observe("/shop#2", question);
  assert.equal(notifier.notify(notice), true);
  assert.equal(notifier.notify(notice), false);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].visible, true);
  assert.deepEqual(shown[0].options, { title: "shop / main - Claude needs input", subtitle: "Fix login", body: "Which color?" });
});

test("stays quiet while a Milagre window has focus", () => {
  const { notifier, shown } = setup({ focused: true });
  notifier.observe("/shop#2", question);
  assert.equal(notifier.notify(notice), false);
  assert.equal(shown.length, 0);
});

test("ignores requests no agent is waiting on", () => {
  const { notifier, shown } = setup();
  assert.equal(notifier.notify(notice), false);
  notifier.observe("/shop#2", question);
  notifier.observe("/shop#2", { type: "question-resolved", requestId: "q1", outcome: "answered" });
  assert.equal(notifier.notify(notice), false);
  assert.equal(shown.length, 0);
});

test("closes the notification when the request is answered", () => {
  const { notifier, shown } = setup();
  notifier.observe("/shop#2", { type: "permission-request", requestId: "p1" });
  notifier.notify({ ...notice, requestId: "p1" });
  notifier.observe("/shop#2", { type: "permission-resolved", requestId: "p1", decision: "allow" });
  assert.equal(shown[0].closed, true);
});

test("closes a chat's notifications when its turn ends, and leaves other chats alone", () => {
  const { notifier, shown } = setup();
  notifier.observe("/shop#2", question);
  notifier.observe("/shop#3", question);
  notifier.notify(notice);
  notifier.notify({ ...notice, chatId: "/shop#3" });
  notifier.observe("/shop#2", { type: "turn-cancelled" });
  assert.deepEqual(shown.map((item) => item.closed), [true, false]);
  assert.equal(notifier.notify(notice), false);
});

test("clicking opens the chat", () => {
  const { notifier, shown, opened } = setup();
  notifier.observe("/shop#2", question);
  notifier.notify(notice);
  shown[0].emit("click");
  assert.deepEqual(opened, ["/shop#2"]);
});

test("caps long text and falls back to a title", () => {
  const { notifier, shown } = setup();
  notifier.observe("/shop#2", question);
  notifier.notify({ chatId: "/shop#2", requestId: "q1", title: " ", body: "x".repeat(500) });
  assert.equal(shown[0].options.title, "Milagre");
  assert.equal(shown[0].options.body.length, 240);
  assert.ok(shown[0].options.body.endsWith("…"));
});
