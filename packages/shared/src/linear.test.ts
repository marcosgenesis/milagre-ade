import assert from "node:assert/strict";
import { test } from "node:test";
import { linearStatusLine, type LinearStatus } from "./linear.ts";

const connected: LinearStatus = {
  connected: true,
  viewer: { name: "Victor", email: "victor@example.com" },
  organization: { name: "Acme", urlKey: "acme" },
};

test("a connected status names the user and the workspace on both platforms", () => {
  assert.equal(linearStatusLine(connected, "mac"), "Connected as Victor to Acme");
  assert.equal(linearStatusLine(connected, "phone"), "Connected as Victor to Acme");
});

test("a disconnected phone is told to connect on the Mac", () => {
  assert.equal(linearStatusLine({ connected: false }, "mac"), "Not connected");
  assert.equal(linearStatusLine({ connected: false }, "phone"), "Connect Linear from Settings on your Mac");
});
