import assert from "node:assert/strict";
import test from "node:test";
import { cliNotice, cliTabLabel, messageParts } from "./cli-status.ts";

test("a CLI with a problem gets a short tab label, and one that runs gets none", () => {
  assert.equal(cliTabLabel({ state: "missing", message: "m" }), "Not installed");
  assert.equal(cliTabLabel({ state: "outdated", message: "m" }), "Update");
  assert.equal(cliTabLabel({ state: "logged-out", message: "m" }), "Log in");
  assert.equal(cliTabLabel({ state: "broken", message: "m" }), "Not working");
  assert.equal(cliTabLabel({ state: "ready" }), null);
  assert.equal(cliTabLabel(null), null);
  assert.equal(cliTabLabel(undefined), null);
});

test("the notice is the CLI's own message, and only for a problem", () => {
  assert.equal(cliNotice({ state: "logged-out", message: "Codex isn't logged in." }), "Codex isn't logged in.");
  assert.equal(cliNotice({ state: "ready" }), null);
  assert.equal(cliNotice({ state: "missing" }), null);
  assert.equal(cliNotice(null), null);
});

test("backtick spans become code", () => {
  assert.deepEqual(messageParts("Run `codex login` in a terminal, then send your message again."), [
    { text: "Run ", code: false },
    { text: "codex login", code: true },
    { text: " in a terminal, then send your message again.", code: false },
  ]);
  assert.deepEqual(messageParts("Install it with `curl -fsSL https://claude.ai/install.sh | bash`"), [
    { text: "Install it with ", code: false },
    { text: "curl -fsSL https://claude.ai/install.sh | bash", code: true },
  ]);
  assert.deepEqual(messageParts("No code here."), [{ text: "No code here.", code: false }]);
});
