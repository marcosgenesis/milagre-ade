const assert = require("node:assert/strict");
const test = require("node:test");
const { suggestWorktreeName } = require("./worktree-name.cjs");

// An SDK whose query yields the given messages, recording the options it was called with.
function fakeSdk(messages, calls = []) {
  return async () => ({
    query: (request) => {
      calls.push(request);
      return (async function* () {
        for (const message of messages) yield message;
      })();
    },
  });
}

const PROMPT = "worktrees names arent being created with useful names";

test("suggestWorktreeName asks Haiku, with no tools or settings, for a branch-safe name", async () => {
  const calls = [];
  const name = await suggestWorktreeName(PROMPT, {
    command: "/bin/claude",
    loadSdk: fakeSdk([{ type: "result", subtype: "success", result: "`Descriptive-Worktree-Names`.\n" }], calls),
  });
  assert.equal(name, "descriptive-worktree-names");
  assert.match(calls[0].prompt, new RegExp(`<task>\\n${PROMPT}\\n</task>`));
  assert.equal(calls[0].options.model, "haiku");
  assert.deepEqual(calls[0].options.tools, []);
  assert.deepEqual(calls[0].options.settingSources, []);
  assert.equal(calls[0].options.persistSession, false);
  assert.equal(calls[0].options.pathToClaudeCodeExecutable, "/bin/claude");
});

test("suggestWorktreeName falls back to the prompt's first words", async () => {
  const fallback = "worktrees-names-arent-being-created";
  assert.equal(await suggestWorktreeName(PROMPT, { command: null, loadSdk: fakeSdk([]) }), fallback);
  assert.equal(await suggestWorktreeName(PROMPT, { command: "claude", loadSdk: fakeSdk([{ type: "result", subtype: "error_during_execution" }]) }), fallback);
  assert.equal(await suggestWorktreeName(PROMPT, { command: "claude", loadSdk: fakeSdk([{ type: "result", subtype: "success", result: "?!" }]) }), fallback);
  // Haiku answering the task instead of naming it.
  assert.equal(
    await suggestWorktreeName(PROMPT, {
      command: "claude",
      loadSdk: fakeSdk([{ type: "result", subtype: "success", result: "I'd be happy to help with the README." }]),
    }),
    fallback,
  );
  assert.equal(
    await suggestWorktreeName(PROMPT, { command: "claude", loadSdk: fakeSdk([{ type: "result", subtype: "success", result: "readme" }]) }),
    fallback,
  );
  assert.equal(
    await suggestWorktreeName(PROMPT, {
      command: "claude",
      loadSdk: async () => {
        throw new Error("no sdk");
      },
    }),
    fallback,
  );
  assert.equal(await suggestWorktreeName("", { command: "claude", loadSdk: fakeSdk([{ type: "result", subtype: "success", result: "x" }]) }), "");
});

test("suggestWorktreeName gives up when Haiku runs past the timeout", async () => {
  const loadSdk = async () => ({
    query: ({ options }) =>
      // oxlint-disable-next-line require-yield -- async generator stub that throws or never settles on purpose to simulate a failing or idle stream
      (async function* () {
        await new Promise((resolve, reject) => options.abortController.signal.addEventListener("abort", () => reject(new Error("aborted"))));
      })(),
  });
  assert.equal(await suggestWorktreeName(PROMPT, { command: "claude", loadSdk, timeoutMs: 10 }), "worktrees-names-arent-being-created");
});
