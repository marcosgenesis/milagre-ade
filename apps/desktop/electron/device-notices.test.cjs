const assert = require("node:assert/strict");
const test = require("node:test");
const { createDeviceNotices } = require("./device-notices.cjs");

const TAKE = "devices:take-notices";

function setup({ methods = [TAKE], kept = [] } = {}) {
  const host = { methods, kept: [...kept], calls: 0, fail: false };
  const phones = [];
  const devices = [];
  const notices = createDeviceNotices({
    methods: () => host.methods,
    invoke: async (method) => {
      assert.equal(method, TAKE);
      host.calls++;
      if (host.fail) throw new Error("Connection to the host was interrupted");
      return host.kept.splice(0);
    },
    notifyPhones: (list, options) => phones.push({ list, options }),
    notifyDevice: (kind) => devices.push(kind),
  });
  return { notices, host, phones, devices };
}

const phone = (name) => ({ key: "k".repeat(43), kind: "phone", name, pairedAt: 1, lastSeen: 1, isNew: true });

test("on connect, phones that paired while Milagre was closed are announced once, as paired while it was closed", async () => {
  const { notices, host, phones } = setup({ kept: [phone("Victor's iPhone"), phone(null)] });
  await notices.connected();
  assert.deepEqual(phones, [{ list: [{ name: "Victor's iPhone" }, { name: null }], options: { away: true } }]);
  // A reconnect asks again, but the host handed them out already.
  await notices.connected();
  assert.equal(host.calls, 2);
  assert.equal(phones.length, 1);
});

test("a pairing while Milagre is open is taken from the host, so it is not announced again on the next connect", async () => {
  const { notices, host, phones, devices } = setup();
  host.kept.push(phone("Pixel"));
  await notices.paired({ pairedPhones: 1, kind: "phone" });
  assert.deepEqual(phones, [{ list: [{ name: "Pixel" }], options: { away: false } }]);
  await notices.connected();
  assert.equal(phones.length, 1);
  // Another window took it first: nothing to show here.
  await notices.paired({ pairedPhones: 2, kind: "phone" });
  assert.equal(phones.length, 1);
  assert.deepEqual(devices, []);
});

test("a host from before devices:take-notices: its event is announced straight away, and a computer's never", async () => {
  const { notices, host, phones, devices } = setup({ methods: ["devices:list"] });
  await notices.connected();
  await notices.paired({ pairedPhones: 1, kind: "phone" });
  await notices.paired({ pairedPhones: 1, kind: "computer" });
  assert.equal(host.calls, 0);
  assert.deepEqual(phones, []);
  assert.deepEqual(devices, ["phone"]);
});

test("nothing is taken before the window has its host, or when notifications can't show; a failed take shows nothing", async () => {
  const { notices, host, phones, devices } = setup({ methods: null, kept: [phone("Pixel")] });
  await notices.paired({ kind: "phone" });
  await notices.connected();
  assert.equal(host.calls, 0);
  assert.equal(host.kept.length, 1, "kept for the launch's connect");
  host.methods = [TAKE];
  host.fail = true;
  await notices.connected();
  assert.deepEqual(phones, []);
  assert.deepEqual(devices, []);
});
