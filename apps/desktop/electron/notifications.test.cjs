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
      notification.show = () => {
        notification.visible = true;
      };
      notification.close = () => {
        notification.closed = true;
      };
      shown.push(notification);
      return notification;
    },
    isAppFocused: () => state.focused,
    openChat: (chatId) => opened.push(chatId),
    openPhoneSettings: () => opened.push("settings:phone"),
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
  assert.deepEqual(
    shown.map((item) => item.closed),
    [true, false],
  );
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

test("completion alerts use observed output, show once, and open the originating chat", () => {
  const { notifier, shown, opened } = setup();
  notifier.sync({ projectPath: "/shop", activeChatId: "/shop#2", unread: [], notifyOnCompletion: true, showDockBadge: true });
  notifier.observe("/shop#2", { type: "turn-started" });
  notifier.observe("/shop#2", { type: "text-delta", text: "Tests passed." });
  notifier.observe("/shop#2", { type: "turn-completed" });
  assert.equal(notifier.notifyCompletion({ chatId: "/shop#2", title: "shop", subtitle: "Fix login" }), true);
  assert.equal(shown[0].options.body, "Tests passed.");
  assert.equal(notifier.notifyCompletion({ chatId: "/shop#2" }), false);
  shown[0].emit("click");
  assert.deepEqual(opened, ["/shop#2"]);
});
test("completion alerts suppress the focused chat, cancellation, disabled preference and fabricated results", () => {
  const { notifier, shown } = setup({ focused: true });
  notifier.sync({ projectPath: "/shop", activeChatId: "/shop#2", unread: [], notifyOnCompletion: true });
  notifier.observe("/shop#2", { type: "turn-completed" });
  assert.equal(notifier.notifyCompletion({ chatId: "/shop#2" }), false);
  notifier.observe("/shop#3", { type: "turn-cancelled" });
  assert.equal(notifier.notifyCompletion({ chatId: "/shop#3" }), false);
  assert.equal(notifier.notifyCompletion({ chatId: "/shop#4" }), false);
  notifier.sync({ projectPath: "/shop", unread: [], notifyOnCompletion: false });
  notifier.observe("/shop#3", { type: "turn-failed", message: "Connection lost" });
  assert.equal(notifier.notifyCompletion({ chatId: "/shop#3" }), false);
  assert.equal(shown.length, 0);
});
test("another chat can notify while focused, with failure details and no stale preview on next turn", () => {
  const { notifier, shown } = setup({ focused: true });
  notifier.sync({ projectPath: "/shop", activeChatId: "/shop#2", unread: [], notifyOnCompletion: true });
  notifier.observe("/shop#3", { type: "turn-failed", message: "Connection lost" });
  assert.equal(notifier.notifyCompletion({ chatId: "/shop#3", title: "shop" }), true);
  assert.equal(shown[0].options.body, "Connection lost");
  assert.match(shown[0].options.title, /failed/);
  notifier.observe("/shop#3", { type: "turn-started" });
  notifier.observe("/shop#3", { type: "turn-completed" });
  notifier.notifyCompletion({ chatId: "/shop#3" });
  assert.equal(shown[1].options.body, "Turn completed.");
});
test("Dock counts distinct waiting or unread chats, survives project changes, and clears when disabled", () => {
  let badge;
  const notifier = new AttentionNotifier({
    setBadge: (value) => {
      badge = value;
    },
    isAppFocused: () => false,
  });
  notifier.sync({ projectPath: "/shop", unread: ["/shop#2"], showDockBadge: true });
  notifier.observe("/shop#2", question);
  notifier.observe("/shop#3", question);
  notifier.observe("/shop#3", { ...question, requestId: "q2" });
  assert.equal(badge, "2");
  notifier.sync({ projectPath: "/other", unread: ["/other#1"], showDockBadge: true });
  assert.equal(badge, "3");
  notifier.observe("/shop#3", { type: "turn-cancelled" });
  assert.equal(badge, "2");
  notifier.sync({ projectPath: "/shop", unread: [], showDockBadge: false });
  assert.equal(badge, "");
});

test("a first phone pairing is announced even while Milagre has focus, and its click opens Settings › Devices", () => {
  const { notifier, shown, opened } = setup({ focused: true });
  assert.equal(notifier.notifyDevicePaired(), true);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].visible, true);
  assert.equal(shown[0].options.title, "New phone paired");
  assert.match(shown[0].options.body, /If it wasn't you, remove it in Settings → Devices/);
  shown[0].emit("click");
  assert.deepEqual(opened, ["settings:phone"]);
  // A second pairing replaces the first notice.
  notifier.notifyDevicePaired();
  assert.equal(shown[0].closed, true);
  assert.equal(shown[1].visible, true);
});

test("a computer's first pairing says another Mac can now drive this one, and its click opens Settings › Devices", () => {
  const { notifier, shown, opened } = setup();
  assert.equal(notifier.notifyDevicePaired("computer"), true);
  assert.equal(shown[0].options.title, "New computer paired");
  assert.equal(shown[0].options.body, "Another Mac can now drive your agents on this Mac. If it wasn't you, remove it in Settings → Devices.");
  shown[0].emit("click");
  assert.deepEqual(opened, ["settings:phone"]);
  // One pairing notice at a time, whatever paired.
  notifier.notifyDevicePaired("phone");
  assert.equal(shown[0].closed, true);
  assert.equal(shown[1].options.title, "New phone paired");
});

test("a computer waiting for Allow is announced once while Milagre is in the background, and its click opens the window", () => {
  const { notifier, shown, opened, state } = setup();
  const studio = { key: "s".repeat(43), name: "studio", at: 1 };
  assert.equal(notifier.notifyComputerWaiting([studio]), true);
  assert.equal(shown[0].options.title, "studio wants to drive this Mac's chats");
  assert.equal(shown[0].options.body, "Open Milagre to allow or deny it.");
  shown[0].emit("click");
  assert.deepEqual(opened, ["settings:phone"]);
  // The same request again (another computer joined the list) says nothing more about it.
  const lab = { key: "l".repeat(43), name: null, at: 2 };
  assert.equal(notifier.notifyComputerWaiting([studio, lab]), true);
  assert.equal(shown[1].options.title, "A computer wants to drive this Mac's chats");
  assert.equal(shown[0].closed, true, "one notice at a time");
  assert.equal(notifier.notifyComputerWaiting([studio, lab]), false);
  // Answered: the notice goes.
  assert.equal(notifier.notifyComputerWaiting([]), false);
  assert.equal(shown[1].closed, true);
  // With the window focused the prompt is on screen; no notification.
  state.focused = true;
  assert.equal(notifier.notifyComputerWaiting([{ key: "x".repeat(43), name: "x", at: 3 }]), false);
});
