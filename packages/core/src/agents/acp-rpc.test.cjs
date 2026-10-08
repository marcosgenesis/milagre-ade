const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { AcpRpc } = require("./acp-rpc.cjs");
const { signInUrl } = require("./antigravity-acp.cjs");
const { waitUntil } = require("./test-helpers.cjs");

const FAKE = path.join(__dirname, "fixtures", "fake-acp-agent.cjs");

function client(t, scenario = "reply", { command = process.execPath, onLine } = {}) {
  const rpc = new AcpRpc({ command, args: [FAKE], env: { ...process.env, FAKE_SCENARIO: scenario }, name: "Fake", onLine });
  rpc.start();
  t.after(() => rpc.close());
  return rpc;
}

test("sends JSON-RPC 2.0 requests and matches their responses", async (t) => {
  const rpc = client(t);
  const updates = [];
  rpc.on("notification", ({ method, params }) => updates.push([method, params.update.sessionUpdate]));
  const init = await rpc.request("initialize", { protocolVersion: 1 });
  assert.equal(init.agentInfo.name, "antigravity-acp");
  const { sessionId } = await rpc.request("session/new", { cwd: "/", mcpServers: [] });
  assert.deepEqual(await rpc.request("session/prompt", { sessionId, prompt: [] }, { timeoutMs: 0 }), { stopReason: "end_turn" });
  assert.deepEqual(updates, [
    ["session/update", "agent_message_chunk"],
    ["session/update", "agent_message_chunk"],
  ]);
  rpc.notify("session/cancel", { sessionId });
  const { received } = await rpc.request("fake/received");
  assert.ok(received.every((message) => message.jsonrpc === "2.0"));
  assert.deepEqual(
    received.find((message) => message.method === "session/cancel"),
    { jsonrpc: "2.0", method: "session/cancel", params: { sessionId } },
  );
});

test("rejects with the agent's error and keeps its code", async (t) => {
  const rpc = client(t);
  const error = await rpc.request("nope/nope").catch((caught) => caught);
  assert.match(error.message, /unknown method nope\/nope/);
  assert.equal(error.rpcError.code, -32601);
});

test("delivers agent requests and sends the reply back", async (t) => {
  const rpc = client(t, "permission");
  rpc.on("request", ({ id, method, params }) => {
    assert.equal(method, "session/request_permission");
    assert.equal(params.toolCall.toolCallId, "cmd-1");
    rpc.respond(id, { outcome: { outcome: "selected", optionId: "deny" } });
  });
  const texts = [];
  rpc.on("notification", ({ params }) => {
    if (params.update.sessionUpdate === "agent_message_chunk") texts.push(params.update.content.text);
  });
  const { sessionId } = await rpc.request("session/new", { cwd: "/", mcpServers: [] });
  await rpc.request("session/prompt", { sessionId, prompt: [] }, { timeoutMs: 0 });
  assert.deepEqual(texts, ["picked:deny"]);
});

test("passes lines that aren't JSON-RPC to onLine, from stdout and stderr", async (t) => {
  const lines = [];
  const rpc = client(t, "sign-in-line", { onLine: (line, stream) => lines.push([stream, signInUrl(line)]) });
  await rpc.request("initialize", {});
  await waitUntil(() => lines.length === 2);
  assert.deepEqual(lines.toSorted(), [
    ["stderr", "https://accounts.example/auth?x=2"],
    ["stdout", "https://accounts.example/auth?x=1"],
  ]);
});

test("times out a request the agent doesn't answer", async (t) => {
  const rpc = client(t, "stubborn");
  const { sessionId } = await rpc.request("session/new", { cwd: "/", mcpServers: [] });
  const error = await rpc.request("session/prompt", { sessionId, prompt: [] }, { timeoutMs: 50 }).catch((caught) => caught);
  assert.match(error.message, /Fake did not answer session\/prompt/);
  assert.equal(error.timedOut, true);
});

test("rejects pending requests when the agent exits, and keeps its stderr", async (t) => {
  const rpc = client(t, "crash");
  const exits = [];
  rpc.on("exit", (exit) => exits.push(exit));
  const { sessionId } = await rpc.request("session/new", { cwd: "/", mcpServers: [] });
  const error = await rpc.request("session/prompt", { sessionId, prompt: [] }, { timeoutMs: 0 }).catch((caught) => caught);
  assert.equal(error.exited, true);
  await waitUntil(() => exits.length === 1);
  assert.equal(exits[0].code, 1);
  assert.match(rpc.stderr, /boom: model unavailable/);
  await assert.rejects(rpc.request("initialize", {}), /Fake is not running/);
});

test("explains an agent that can't be started", async (t) => {
  const rpc = client(t, "reply", { command: "milagre-definitely-missing-agent" });
  await assert.rejects(rpc.request("initialize", {}), /milagre-definitely-missing-agent isn't installed or isn't on your PATH/);
});
