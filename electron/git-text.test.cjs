const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { DIFF_LIMIT, GENERATION_FAILED, buildGitTextPrompt, claudeModel, codexModel, generateGitText, parseGitText } = require("./git-text.cjs");

const INPUT = {
  diff: "diff --git a/cart.js b/cart.js\n-old\n+new\n",
  chatTitle: "Fix the cart total",
  firstMessage: "The cart total ignores discounts. Fix it.",
  recentMessages: ["Also round to cents.", "Looks good, run the tests."],
  testCommands: [{ command: "npm test", status: "done" }],
  recentSubjects: ["fix: keep the sidebar open", "feat: add usage bars"],
  branchCommits: [],
  branch: "milagre/fix-cart-total",
  base: "main",
  hasChanges: true,
};

const REPLY = JSON.stringify({ commitMessage: "fix: apply discounts to the cart total", prTitle: "fix: apply discounts to the cart total", prBody: "The total now subtracts discounts." });

test("the prompt carries the chat, the tests run, the recent subjects and the diff", () => {
  const prompt = buildGitTextPrompt(INPUT);
  assert.match(prompt, /<chat_title>\nFix the cart total\n<\/chat_title>/);
  assert.match(prompt, /The cart total ignores discounts\. Fix it\./);
  assert.match(prompt, /Also round to cents\./);
  assert.match(prompt, /Looks good, run the tests\./);
  assert.match(prompt, /npm test \(passed\)/);
  assert.match(prompt, /fix: keep the sidebar open\nfeat: add usage bars/);
  assert.match(prompt, /milagre\/fix-cart-total into main/);
  assert.match(prompt, /\+new/);
  assert.match(prompt, /JSON/);
  assert.match(prompt, /How was it verified\?/);
  assert.doesNotMatch(prompt, /truncated/i);
});

test("without tests in the chat, the prompt says so", () => {
  const prompt = buildGitTextPrompt({ ...INPUT, testCommands: [] });
  assert.match(prompt, /No tests were run in this chat\./);
});

test("the prompt caps the diff at 40,000 characters with a note, and caps the messages", () => {
  const diff = `${"+".repeat(DIFF_LIMIT)}TAIL-THAT-IS-CUT`;
  const prompt = buildGitTextPrompt({ ...INPUT, diff, firstMessage: "x".repeat(5000), recentMessages: ["message-1", "message-2", "message-3", "message-4", "message-5", "y".repeat(5000)] });
  assert.equal(DIFF_LIMIT, 40_000);
  assert.ok(!prompt.includes("TAIL-THAT-IS-CUT"));
  assert.ok(prompt.includes("[The diff is cut off here: 16 more characters are not shown.]"));
  assert.ok(!prompt.includes("x".repeat(2001)));
  assert.ok(!prompt.includes("y".repeat(1001)));
  // Only the last few messages.
  assert.ok(!prompt.includes("message-3"));
  assert.ok(prompt.includes("message-4"));
});

test("with nothing left to commit, the prompt describes the branch's commits", () => {
  const prompt = buildGitTextPrompt({ ...INPUT, hasChanges: false, branchCommits: ["feat: add checkout", "fix: typo"] });
  assert.match(prompt, /feat: add checkout\nfix: typo/);
  assert.match(prompt, /nothing left to commit/i);
});

test("parseGitText reads plain or fenced JSON, and fills missing fields with empty text", () => {
  const expected = { commitMessage: "fix: apply discounts to the cart total", prTitle: "fix: apply discounts to the cart total", prBody: "The total now subtracts discounts." };
  assert.deepEqual(parseGitText(REPLY), expected);
  assert.deepEqual(parseGitText(`\`\`\`json\n${REPLY}\n\`\`\``), expected);
  assert.deepEqual(parseGitText(`Here you go:\n${REPLY}\nThanks`), expected);
  assert.deepEqual(parseGitText('{"commitMessage": "fix: a"}'), { commitMessage: "fix: a", prTitle: "", prBody: "" });
  assert.deepEqual(parseGitText('{"commit_message": "fix: b", "pr_title": "Fix b\\nmore", "pr_body": "Body"}'), { commitMessage: "fix: b", prTitle: "Fix b", prBody: "Body" });
  assert.equal(parseGitText("I can't help with that."), null);
  assert.equal(parseGitText('{"answer": 42}'), null);
  assert.equal(parseGitText(""), null);
});

test("parseGitText drops an AI footer", () => {
  const reply = JSON.stringify({ commitMessage: "fix: a\n\nCo-Authored-By: Claude <noreply@anthropic.com>", prTitle: "Fix a", prBody: "Fixes a.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)" });
  assert.deepEqual(parseGitText(reply), { commitMessage: "fix: a", prTitle: "Fix a", prBody: "Fixes a." });
});

test("generateGitText asks the chat's own agent first", async () => {
  const calls = [];
  const model = (name) => async ({ system, prompt, signal }) => {
    calls.push({ name, system, prompt, signal });
    return REPLY;
  };
  const claude = await generateGitText(INPUT, { provider: "claude", models: { claude: model("claude"), codex: model("codex") } });
  assert.equal(claude.ok, true);
  assert.equal(claude.provider, "claude");
  assert.equal(claude.commitMessage, "fix: apply discounts to the cart total");
  assert.match(calls[0].prompt, /Fix the cart total/);
  assert.match(calls[0].system, /JSON/);
  assert.ok(calls[0].signal instanceof AbortSignal);
  const codex = await generateGitText(INPUT, { provider: "codex", models: { claude: model("claude"), codex: model("codex") } });
  assert.equal(codex.provider, "codex");
  assert.deepEqual(calls.map((call) => call.name), ["claude", "codex"]);
});

test("generateGitText falls back to the other agent when the first can't answer", async () => {
  const missing = async () => { throw new Error("Codex isn't installed."); };
  const result = await generateGitText(INPUT, { provider: "codex", models: { codex: missing, claude: async () => REPLY } });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "claude");
  // An unreadable reply counts as no answer.
  const reverse = await generateGitText(INPUT, { provider: "claude", models: { claude: async () => "Sure! Here's a message: fix stuff", codex: async () => REPLY } });
  assert.equal(reverse.provider, "codex");
});

test("generateGitText gives up on an agent that runs past the timeout", async () => {
  let aborted = false;
  const hang = ({ signal }) => new Promise(() => signal.addEventListener("abort", () => { aborted = true; }));
  const started = Date.now();
  const result = await generateGitText(INPUT, { provider: "claude", timeoutMs: 30, models: { claude: hang, codex: async () => REPLY } });
  assert.equal(aborted, true);
  assert.equal(result.provider, "codex");
  const failed = await generateGitText(INPUT, { provider: "claude", timeoutMs: 30, models: { claude: hang, codex: hang } });
  assert.deepEqual(failed, { ok: false, message: GENERATION_FAILED });
  assert.ok(Date.now() - started < 2000);
});

test("generateGitText fails with the note when neither agent answers", async () => {
  const result = await generateGitText(INPUT, { provider: "claude", models: { claude: async () => { throw new Error("signed out"); }, codex: null } });
  assert.deepEqual(result, { ok: false, message: GENERATION_FAILED });
  assert.equal(GENERATION_FAILED, "Couldn't write a message. Type one to continue.");
});

test("claudeModel makes one Haiku 4.5 turn with no tools, settings or saved session", async () => {
  const calls = [];
  const loadSdk = async () => ({
    query: (request) => {
      calls.push(request);
      return (async function* () {
        yield { type: "system", subtype: "init" };
        yield { type: "result", subtype: "success", result: REPLY };
      })();
    },
  });
  const call = claudeModel({ getCommand: async () => "/bin/claude", loadSdk });
  const text = await call({ system: "SYSTEM", prompt: "PROMPT", signal: new AbortController().signal });
  assert.equal(text, REPLY);
  const { prompt, options } = calls[0];
  assert.equal(prompt, "PROMPT");
  assert.equal(options.model, "claude-haiku-4-5");
  assert.equal(options.systemPrompt, "SYSTEM");
  assert.deepEqual(options.tools, []);
  assert.equal(options.maxTurns, 1);
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.persistSession, false);
  assert.equal(options.pathToClaudeCodeExecutable, "/bin/claude");
  assert.ok(options.abortController instanceof AbortController);

  await assert.rejects(claudeModel({ getCommand: async () => null, loadSdk })({ system: "", prompt: "", signal: new AbortController().signal }), /isn't installed/);
  const failing = async () => ({ query: () => (async function* () { yield { type: "result", subtype: "error_during_execution", errors: ["Not logged in"] }; })() });
  await assert.rejects(claudeModel({ getCommand: async () => "/bin/claude", loadSdk: failing })({ system: "", prompt: "", signal: new AbortController().signal }), /Not logged in/);
});

test("claudeModel stops the query when the call is aborted", async () => {
  let options;
  const loadSdk = async () => ({
    query: (request) => {
      options = request.options;
      return (async function* () {
        await new Promise((_, reject) => request.options.abortController.signal.addEventListener("abort", () => reject(new Error("aborted"))));
      })();
    },
  });
  const controller = new AbortController();
  const pending = claudeModel({ getCommand: async () => "/bin/claude", loadSdk })({ system: "", prompt: "", signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, /aborted/);
  assert.equal(options.abortController.signal.aborted, true);
});

// A codex app-server that answers initialize, thread/start and turn/start, then streams a reply.
function fakeRpc(reply, { failTurn = false } = {}) {
  const rpc = new EventEmitter();
  rpc.requests = [];
  rpc.notifications = [];
  rpc.closed = false;
  rpc.start = () => {};
  rpc.notify = (method) => rpc.notifications.push(method);
  rpc.respondError = () => {};
  rpc.close = async () => { rpc.closed = true; };
  rpc.request = async (method, params) => {
    rpc.requests.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "turn/start") {
      setImmediate(() => {
        if (failTurn) {
          rpc.emit("notification", { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "failed", error: { message: "model not found" } } } });
          return;
        }
        rpc.emit("notification", { method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "m1", delta: reply.slice(0, 10) } });
        rpc.emit("notification", { method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "m1", delta: reply.slice(10) } });
        rpc.emit("notification", { method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", item: { type: "agentMessage", id: "m1", text: reply } } });
        rpc.emit("notification", { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
      });
      return { turn: { id: "turn-1" } };
    }
    return {};
  };
  return rpc;
}

test("codexModel runs one turn of gpt-6-luna in a throwaway read-only thread", async () => {
  const rpc = fakeRpc(REPLY);
  const created = [];
  const call = codexModel({ getCommand: async () => "/bin/codex", createRpc: (options) => { created.push(options); return rpc; }, clientVersion: "1.2.3" });
  const text = await call({ system: "SYSTEM", prompt: "PROMPT", signal: new AbortController().signal });
  assert.equal(text, REPLY);
  assert.equal(created[0].command, "/bin/codex");
  assert.deepEqual(rpc.requests.map((request) => request.method), ["initialize", "thread/start", "turn/start"]);
  const thread = rpc.requests[1].params;
  assert.equal(thread.model, "gpt-6-luna");
  assert.equal(thread.ephemeral, true);
  assert.equal(thread.sandbox, "read-only");
  assert.equal(thread.approvalPolicy, "never");
  assert.equal(thread.baseInstructions, "SYSTEM");
  const turn = rpc.requests[2].params;
  assert.equal(turn.threadId, "thread-1");
  assert.deepEqual(turn.input, [{ type: "text", text: "PROMPT", text_elements: [] }]);
  assert.equal(rpc.closed, true);
});

test("codexModel fails when the turn fails or Codex is missing, and always closes Codex", async () => {
  const rpc = fakeRpc(REPLY, { failTurn: true });
  await assert.rejects(codexModel({ getCommand: async () => "/bin/codex", createRpc: () => rpc })({ system: "", prompt: "", signal: new AbortController().signal }), /model not found/);
  assert.equal(rpc.closed, true);
  await assert.rejects(codexModel({ getCommand: async () => null, createRpc: () => fakeRpc(REPLY) })({ system: "", prompt: "", signal: new AbortController().signal }), /isn't installed/);
});
