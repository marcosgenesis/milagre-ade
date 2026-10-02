const assert = require("node:assert/strict");
const test = require("node:test");
const { registerGitHandlers } = require("./git-ipc.cjs");

function register(overrides = {}) {
  const handlers = new Map();
  const calls = [];
  const record = (name, result) => async (request) => {
    calls.push({ name, request });
    return result;
  };
  const actions = {
    readChanges: record("readChanges", { isRepo: true }),
    readTextContext: record("readTextContext", { diff: "+new\n", recentSubjects: ["fix: a"], branchCommits: [], branch: "milagre/x", base: "main", hasChanges: true }),
    commit: record("commit", { ok: true, sha: "abc", shortSha: "abc" }),
    push: record("push", { ok: true, branch: "milagre/x", remote: "origin" }),
    openPr: record("openPr", { ok: true, url: "https://github.com/a/b/pull/1", number: 1 }),
  };
  const prompts = [];
  const models = { claude: async ({ prompt }) => { prompts.push(prompt); return '{"commitMessage":"fix: x","prTitle":"Fix x","prBody":"Fixes x."}'; }, codex: null };
  registerGitHandlers({ handle: (channel, handler) => handlers.set(channel, handler) }, { executable: async () => null, actions, models, ...overrides });
  const invoke = (channel, ...args) => handlers.get(channel)({}, ...args);
  return { handlers, calls, invoke, prompts };
}

test("the dialog's channels reach the git actions", async () => {
  const { handlers, calls, invoke } = register();
  assert.deepEqual([...handlers.keys()].sort(), ["git:changes", "git:commit", "git:generate", "git:open-pr", "git:push"]);
  await invoke("git:changes", { cwd: "/repo/wt", base: "main" });
  await invoke("git:commit", { cwd: "/repo/wt", message: "fix: x" });
  await invoke("git:push", { cwd: "/repo/wt" });
  await invoke("git:open-pr", { cwd: "/repo/wt", base: "main", title: "Fix x", body: "Fixes x." });
  assert.deepEqual(calls, [
    { name: "readChanges", request: { cwd: "/repo/wt", base: "main" } },
    { name: "commit", request: { cwd: "/repo/wt", message: "fix: x" } },
    { name: "push", request: { cwd: "/repo/wt" } },
    { name: "openPr", request: { cwd: "/repo/wt", base: "main", title: "Fix x", body: "Fixes x." } },
  ]);
});

test("git:generate writes from the chat and the folder's diff", async () => {
  const { invoke, prompts } = register();
  const result = await invoke("git:generate", { cwd: "/repo/wt", base: "main", provider: "claude", chat: { chatTitle: "Fix x", firstMessage: "Please fix x", recentMessages: [], testCommands: [] } });
  assert.deepEqual(result, { ok: true, provider: "claude", commitMessage: "fix: x", prTitle: "Fix x", prBody: "Fixes x." });
  assert.match(prompts[0], /Please fix x/);
  assert.match(prompts[0], /\+new/);
  assert.match(prompts[0], /fix: a/);
});

test("the channels refuse a folder that isn't an absolute path", async () => {
  const { invoke } = register();
  await assert.rejects(async () => invoke("git:commit", { cwd: "relative/path", message: "x" }), /folder/);
  await assert.rejects(async () => invoke("git:changes", { cwd: 42 }), /folder/);
});
