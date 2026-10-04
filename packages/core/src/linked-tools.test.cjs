const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createLinkedReads, inputSchema, linkedToolDefinitions, runTool } = require("./linked-tools.cjs");
const { createLinkedMcpServer } = require("./linked-mcp-server.cjs");

async function linkedRepo(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-linked-tools-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const web = path.join(dir, "web");
  const hidden = path.join(dir, "hidden");
  for (const folder of [web, hidden]) {
    await fs.mkdir(folder);
    execFileSync("git", ["init", "-b", "main", folder], { stdio: "ignore" });
  }
  await fs.writeFile(path.join(web, "client.ts"), "export const health = () => fetch('/health');\nexport const other = 1;\n");
  await fs.writeFile(path.join(hidden, "secret.txt"), "do not read");
  await fs.symlink(path.join(hidden, "secret.txt"), path.join(web, "escape.txt"));
  execFileSync("git", ["-C", web, "add", "client.ts"], { stdio: "ignore" });
  execFileSync("git", ["-C", web, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "Add client"], { stdio: "ignore" });
  await fs.appendFile(path.join(web, "client.ts"), "export const added = 2;\n");
  const state = {
    next_id: 4,
    worktrees: { 1: { id: 1, path: web, name: "main" } },
    sessions: { 2: { id: 2, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex" }, 3: { id: 3, worktree_id: 1, agent_name: "main", status: "Created", provider: "claude", archived: true } },
    messages: [
      { id: 4, session_id: 2, role: "user", body: "Add the health check", context: null },
      { id: 5, session_id: 2, role: "assistant", body: "Added it.", context: null },
      { id: 6, session_id: 3, role: "user", body: "Archived work", context: null },
    ],
  };
  const reads = createLinkedReads({
    sides: async chatId => (chatId === "api#1" ? [{ project_id: "web-id", worktree_path: web, link_id: "link", projectPath: web, projectName: "web", sourceWorktree: "/api" }] : []),
    state: async () => state,
    runs: () => ({ [`${web}#2`]: { approvals: [{}], questions: [] } }),
    receiveOnly: key => key === `${web}#2`,
    open: () => [],
  });
  return { web, hidden, reads };
}

test("the read tools serve the linked Worktree: overview, Chats (archived too), git, files and search", async (t) => {
  const { web, reads } = await linkedRepo(t);
  const overview = await reads.overview("api#1");
  assert.match(overview, new RegExp(`Chat ${web}#2 "Add the health check" · Codex · waiting on the user · receive-only · last reply: "Added it."`));
  assert.doesNotMatch(overview, /Archived work/, "the summary leaves archived Chats out");
  assert.match(await reads.readChat("api#1", `${web}#3`), /archived[\s\S]*Archived work/, "an archived Chat stays readable");
  assert.match(await reads.readChat("api#1", `${web}#2`, { start: 2 }), /## 2 · Assistant\n\nAdded it\./);
  assert.match(await reads.git("api#1", web, "status"), /M client\.ts/);
  assert.match(await reads.git("api#1", web, "diff"), /\+export const added = 2;/);
  assert.match(await reads.git("api#1", web, "log", { limit: 1 }), /Add client/);
  assert.equal(await reads.readFile("api#1", web, "client.ts", { start: 2, end: 2 }), "2\texport const other = 1;");
  assert.match(await reads.search("api#1", web, "fetch('/health')"), /client\.ts:1:/);
  assert.equal(await reads.search("api#1", web, "nowhere-to-be-found"), "No matches.");
});

test("every read is refused outside the Worktrees the Chat can see", async (t) => {
  const { web, hidden, reads } = await linkedRepo(t);
  for (const read of [() => reads.git("other#1", web, "status"), () => reads.readFile("other#1", web, "client.ts"), () => reads.search("other#1", web, "health"), () => reads.readChat("other#1", `${web}#2`), () => reads.git("api#1", hidden, "status")]) {
    await assert.rejects(read, /isn't linked to this Chat|isn't in a linked Worktree/);
  }
  assert.equal(await reads.overview("other#1"), "No Worktrees are linked to this Chat.");
  await assert.rejects(reads.readFile("api#1", web, "../hidden/secret.txt"), /outside the linked Worktree/);
  await assert.rejects(reads.readFile("api#1", web, "escape.txt"), /outside the linked Worktree/, "a symlink can't lead out");
  await assert.rejects(reads.readFile("api#1", web, path.join(hidden, "secret.txt")), /relative to the linked Worktree/);
  await assert.rejects(reads.git("api#1", web, "diff", { path: "--output=/tmp/x" }), /relative to the linked Worktree/);
  await assert.rejects(reads.git("api#1", web, "push"), /Choose status, diff or log/);
  await assert.rejects(reads.search("api#1", web, "health", "--open-files-in-pager=sh"), /Give a glob/);
});

test("the tool definitions are read-only except delegate and conclude_negotiation, and check their input", async () => {
  const calls = [];
  const definitions = linkedToolDefinitions("api#1", { reads: { git: async (...args) => { calls.push(args); return "ok"; } }, delegations: {} });
  assert.deepEqual(definitions.filter(tool => !tool.readOnly).map(tool => tool.name), ["delegate", "conclude_negotiation"]);
  assert.deepEqual(definitions.filter(tool => tool.readOnly).map(tool => tool.name), ["linked_overview", "read_linked_chat", "linked_git", "read_linked_file", "search_linked_files"]);
  const linkedGit = definitions.find(tool => tool.name === "linked_git");
  assert.deepEqual(inputSchema(linkedGit).properties.operation.enum, ["status", "diff", "log"]);
  const refused = await runTool(linkedGit, { worktree: "/web", operation: "reset" });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /^Invalid arguments: operation/);
  assert.deepEqual(await runTool(linkedGit, { worktree: "/web", operation: "status" }), { text: "ok", isError: false });
  assert.deepEqual(calls, [["api#1", "/web", "status", {}]]);
});

test("Codex reaches the tools over loopback MCP, one unguessable path per Chat", async (t) => {
  const tools = { "api#1": [{ name: "linked_overview", description: "Summary", input: {}, readOnly: true, run: async () => "summary of web" }] };
  const server = createLinkedMcpServer({ toolsFor: chatId => tools[chatId] ?? [] });
  t.after(() => server.close());
  const url = await server.url("api#1");
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mcp\/[a-f0-9]{48}$/);
  assert.equal(await server.url("api#1"), url);
  const call = (target, body) => fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const initialize = await (await call(url, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json();
  assert.equal(initialize.result.protocolVersion, "2025-06-18");
  assert.equal((await call(url, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const listed = await (await call(url, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  assert.deepEqual(listed.result.tools, [{ name: "linked_overview", description: "Summary", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } }]);
  const called = await (await call(url, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "linked_overview", arguments: {} } })).json();
  assert.deepEqual(called.result, { content: [{ type: "text", text: "summary of web" }], isError: false });
  assert.equal((await call(url.replace(/[a-f0-9]{48}$/, "0".repeat(48)), { jsonrpc: "2.0", id: 4, method: "tools/list" })).status, 404);
});
