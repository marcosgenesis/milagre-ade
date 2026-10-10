const assert = require("node:assert/strict");
const test = require("node:test");
const { createDeviceNotices } = require("./device-notices.cjs");

const TAKE = "devices:take-notices";
const CONFIRM = "devices:confirm-notices";

function setup({ methods = [TAKE, CONFIRM], kept = [] } = {}) {
  const host = { methods, kept: [...kept], calls: [], fail: new Set(), claims: 0, confirmed: [] };
  const phones = [];
  const devices = [];
  const notices = createDeviceNotices({
    methods: () => host.methods,
    invoke: async (method, args) => {
      host.calls.push(method);
      if (host.fail.has(method)) throw new Error("Connection to the host was interrupted");
      if (method === CONFIRM) {
        host.confirmed.push(args[0]);
        return 1;
      }
      assert.equal(method, TAKE);
      const list = host.kept.splice(0);
      return list.length ? { claim: `n${++host.claims}`, devices: list } : { claim: null, devices: [] };
    },
    notifyPhones: (list, options) => phones.push({ list, options }),
    notifyDevice: (kind) => devices.push(kind),
  });
  return { notices, host, phones, devices };
}

const phone = (name) => ({ key: "k".repeat(43), kind: "phone", name, pairedAt: 1, lastSeen: 1, isNew: true });

test("on connect, phones that paired while Milagre was closed are announced, then confirmed to the host", async () => {
  const { notices, host, phones } = setup({ kept: [phone("Victor's iPhone"), phone(null)] });
  await notices.connected();
  assert.deepEqual(phones, [{ list: [{ name: "Victor's iPhone" }, { name: null }], options: { away: true } }]);
  assert.deepEqual(host.confirmed, ["n1"], "confirmed only after the notice was shown");
  assert.deepEqual(host.calls, [TAKE, CONFIRM]);
  // A reconnect asks again; nothing is left.
  await notices.connected();
  assert.equal(phones.length, 1);
  assert.deepEqual(host.calls, [TAKE, CONFIRM, TAKE]);
});

test("a pairing while Milagre is open is taken and confirmed, so it is not announced again on the next connect", async () => {
  const { notices, host, phones, devices } = setup();
  host.kept.push(phone("Pixel"));
  await notices.paired({ pairedPhones: 1, kind: "phone" });
  assert.deepEqual(phones, [{ list: [{ name: "Pixel" }], options: { away: false } }]);
  await notices.connected();
  assert.equal(phones.length, 1);
  // Another window took it first: nothing to show here, nothing to confirm.
  await notices.paired({ pairedPhones: 2, kind: "phone" });
  assert.equal(phones.length, 1);
  assert.deepEqual(host.confirmed, ["n1"]);
  assert.deepEqual(devices, []);
});

test("a host without devices:take-notices: its event is announced straight away, and a computer's never", async () => {
  const { notices, host, phones, devices } = setup({ methods: ["devices:list"] });
  await notices.connected();
  await notices.paired({ pairedPhones: 1, kind: "phone" });
  await notices.paired({ pairedPhones: 1, kind: "computer" });
  assert.deepEqual(host.calls, []);
  assert.deepEqual(phones, []);
  assert.deepEqual(devices, ["phone"]);
});

test("reconnected to an older host, the event is announced straight away again", async () => {
  const { notices, host, phones, devices } = setup();
  host.kept.push(phone("Pixel"));
  await notices.paired({ kind: "phone" });
  assert.equal(phones.length, 1);
  // The window's methods are the current host's: the older one has no take-notices.
  host.methods = ["devices:list"];
  await notices.paired({ kind: "phone" });
  assert.deepEqual(devices, ["phone"]);
  assert.deepEqual(host.calls, [TAKE, CONFIRM]);
});

test("nothing is taken before the window has its host; a failed take shows nothing; a failed confirm is left to the host", async () => {
  const { notices, host, phones, devices } = setup({ methods: null, kept: [phone("Pixel")] });
  await notices.paired({ kind: "phone" });
  await notices.connected();
  assert.deepEqual(host.calls, []);
  assert.equal(host.kept.length, 1, "kept for the launch's connect");
  host.methods = [TAKE, CONFIRM];
  host.fail.add(TAKE);
  await notices.connected();
  assert.deepEqual(phones, []);
  assert.deepEqual(devices, []);
  // The confirm's reply is lost: the notice was shown; the host offers it again once the claim ends (devices.cjs).
  host.fail = new Set([CONFIRM]);
  await notices.connected();
  assert.equal(phones.length, 1);
});
