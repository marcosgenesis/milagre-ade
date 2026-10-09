// The phone's real relay transport against the daemon's real LAN host, over a loopback socket.
// It lives in the mobile tests because the transport is the side under test; the daemon's CommonJS loads through createRequire.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { b64url, boxKeyPair } from "@milagre/shared/relay-crypto";
import { createRelayTransport, RelayTransportError } from "./relay-transport.ts";

const require = createRequire(import.meta.url);
const { readIdentity } = require("../../daemon/src/relay-identity.cjs");
const { createDevices } = require("../../daemon/src/devices.cjs");
const { startLanHost } = require("../../daemon/src/lan-host.cjs");
const { startFakeBridge, TOKEN, until } = require("../../daemon/src/relay-test-kit.cjs");

const random = (n: number) => new Uint8Array(randomBytes(n));

/** A LAN host on 127.0.0.1 (port 0) behind a fake bridge, and a transport for a phone with `key`, known to it or not. */
async function lanPair(t: TestContext, { known, name }: { known: boolean; name?: string }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lan-interop-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const identity = await readIdentity(dir);
  const phones = createDevices(dir);
  await phones.load();
  const key = boxKeyPair(random);
  if (known) await phones.add(b64url(key.publicKey));
  const bridge = await startFakeBridge(t);
  const host = await startLanHost({ port: 0, hostname: "127.0.0.1", identity, phones, token: TOKEN, bridgeUrl: bridge.url });
  t.after(() => host.close());
  const transport = createRelayTransport({
    relay: `ws://127.0.0.1:${host.port}`,
    hostId: identity.hostId,
    key: b64url(identity.box.publicKey),
    token: TOKEN,
    identity: key,
    name,
  });
  t.after(() => transport.close());
  return { transport, bridge, phones, dir };
}

test("a known phone's transport finishes the hello and gets the bridge's answer to a POST /rpc", async (t) => {
  const { transport, bridge } = await lanPair(t, { known: true });
  await transport.ready();
  const body = '{"v":1,"method":"daemon:status","args":[]}';
  const response = await transport.request("POST", "/rpc", { "content-type": "application/json" }, body);
  assert.equal(response.status, 200);
  assert.equal(new TextDecoder().decode(response.body), '{"v":1,"result":"pong"}');
  assert.equal(bridge.seen.lastBody, body);
  assert.equal(bridge.seen.requests.at(-1).authorization, `Bearer ${TOKEN}`);
});

test("an unknown phone's transport is refused with the unknown-phone error", async (t) => {
  const { transport } = await lanPair(t, { known: false });
  await assert.rejects(transport.ready(), (error: unknown) => error instanceof RelayTransportError && error.code === "unknown-phone");
});

test("a phone that names itself over the LAN shows that name on the Mac", async (t) => {
  const { transport, phones, dir } = await lanPair(t, { known: true, name: "Victor's iPhone" });
  await transport.ready();
  await until(() => phones.list()[0]?.name === "Victor's iPhone", "the name from the hello");
  // The hello does not wait for the write, so wait for the file before the test's cleanup removes the directory.
  await until(
    async () => (await fs.readFile(path.join(dir, "devices.json"), "utf8").catch(() => "")).includes("Victor's iPhone"),
    "the name written to devices.json",
  );
});
