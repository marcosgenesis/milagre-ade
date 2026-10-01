// Stand-in for `codex app-server` in tests. It speaks the JSON-RPC subset Milagre uses.
// FAKE_SCENARIO picks how a turn behaves: reply (default), fail, slow, crash, approval,
// stubborn (turn never ends, interrupt unanswered), hang-init (initialize unanswered),
// resume-exit (exits on thread/resume).
const fs = require("node:fs");
const { createInterface } = require("node:readline");

const scenario = process.env.FAKE_SCENARIO || "reply";
const received = [];
let threadStarts = 0;
let pendingTurn = null;

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const notify = (method, params) => send({ method, params });
const completeTurn = (threadId, turnId, status, error = null) => notify("turn/completed", { threadId, turn: { id: turnId, items: [], status, error } });

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  received.push(message);
  const { id, method, params = {} } = message;
  if (method === undefined) {
    if (pendingTurn && pendingTurn.approvalId === id) {
      notify("item/agentMessage/delta", { threadId: pendingTurn.threadId, turnId: pendingTurn.turnId, itemId: "msg-1", delta: `decision:${message.result && message.result.decision}` });
      completeTurn(pendingTurn.threadId, pendingTurn.turnId, "completed");
      pendingTurn = null;
    }
    return;
  }
  switch (method) {
    case "initialize":
      if (scenario === "hang-init") return undefined;
      return send({ id, result: { userAgent: "fake/0.158.0" } });
    case "initialized":
      return undefined;
    case "fake/received":
      return send({ id, result: { received, threadStarts } });
    case "thread/start":
      threadStarts += 1;
      return send({ id, result: { thread: { id: `thread-${threadStarts}` }, model: params.model } });
    case "thread/resume":
      if (scenario === "resume-exit") {
        process.stderr.write("resume exploded\n");
        process.exit(4);
      }
      if (params.threadId === "missing") return send({ id, error: { code: -32600, message: "no rollout found for thread id missing" } });
      return send({ id, result: { thread: { id: params.threadId }, model: params.model } });
    case "thread/unarchive":
      return send({ id, error: { code: -32600, message: "thread is not archived" } });
    case "turn/start": {
      const { threadId } = params;
      const turnId = `turn-${received.filter((item) => item.method === "turn/start").length}`;
      message.imagesExist = (params.input || []).filter((input) => input.type === "localImage").map((input) => fs.existsSync(input.path));
      send({ id, result: { turn: { id: turnId, items: [], status: "inProgress", error: null } } });
      notify("turn/started", { threadId, turn: { id: turnId, status: "inProgress" } });
      notify("mcpServer/startupStatus/updated", { name: "noise", status: "ready" });
      if (scenario === "crash") {
        process.stderr.write("boom: model unavailable\n");
        process.exit(3);
      }
      if (scenario === "stubborn") return undefined;
      if (scenario === "slow") {
        pendingTurn = { threadId, turnId };
        return undefined;
      }
      if (scenario === "approval") {
        pendingTurn = { threadId, turnId, approvalId: "srv-1" };
        return send({ id: "srv-1", method: "item/commandExecution/requestApproval", params: { threadId, turnId, itemId: "cmd-1", command: "rm -rf build" } });
      }
      notify("item/agentMessage/delta", { threadId, turnId, itemId: "msg-1", delta: "Hel" });
      notify("item/agentMessage/delta", { threadId, turnId, itemId: "msg-1", delta: "lo" });
      if (scenario === "fail") return completeTurn(threadId, turnId, "failed", { message: "The model gpt-x is not supported." });
      return completeTurn(threadId, turnId, "completed");
    }
    case "turn/interrupt":
      if (scenario === "stubborn") return undefined;
      send({ id, result: {} });
      if (pendingTurn) {
        completeTurn(pendingTurn.threadId, pendingTurn.turnId, "interrupted");
        pendingTurn = null;
      }
      return undefined;
    default:
      return send({ id, error: { code: -32601, message: `unknown method ${method}` } });
  }
});
