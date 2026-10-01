const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CANCELLED_MESSAGE,
  DENIED_MESSAGE,
  PendingPermissions,
  capText,
  claudeRequest,
  claudeResult,
  codexCommandRequest,
  codexDecision,
  codexFileRequest,
  unwrapShell,
} = require("./permissions.cjs");

function pending() {
  const events = [];
  const answers = [];
  const permissions = new PendingPermissions((event) => events.push(event));
  const ask = (requestId) => permissions.add({ requestId, kind: "other", tool: "T", title: "Allow?", allowForChat: false }, (decision) => answers.push({ requestId, decision }));
  return { permissions, events, answers, ask };
}

test("each request is announced, then answered exactly once", () => {
  const { permissions, events, answers, ask } = pending();
  ask("a");
  assert.equal(permissions.size, 1);
  assert.equal(permissions.resolve("a", "allow"), true);
  assert.equal(permissions.resolve("a", "deny"), false);
  assert.equal(permissions.resolve("missing", "allow"), false);
  assert.deepEqual(answers, [{ requestId: "a", decision: "allow" }]);
  assert.deepEqual(events, [
    { type: "permission-request", requestId: "a", kind: "other", tool: "T", title: "Allow?", allowForChat: false },
    { type: "permission-resolved", requestId: "a", decision: "allow" },
  ]);
  assert.equal(permissions.size, 0);
});

test("cancelAll answers every waiting request as cancelled", () => {
  const { permissions, events, answers, ask } = pending();
  ask("a");
  ask("b");
  permissions.cancelAll();
  assert.deepEqual(answers.map((answer) => answer.decision), ["cancelled", "cancelled"]);
  assert.deepEqual(events.filter((event) => event.type === "permission-resolved").map((event) => event.requestId), ["a", "b"]);
  assert.equal(permissions.size, 0);
});

test("always allowing in this chat can't exceed what the request offered", () => {
  const { permissions, events, answers, ask } = pending();
  ask("a");
  permissions.add({ requestId: "b", kind: "other", tool: "T", title: "Allow?", allowForChat: true }, (decision) => answers.push({ requestId: "b", decision }));
  permissions.resolve("a", "allow-for-chat");
  permissions.resolve("b", "allow-for-chat");
  assert.deepEqual(answers, [{ requestId: "a", decision: "allow" }, { requestId: "b", decision: "allow-for-chat" }]);
  assert.deepEqual(events.filter((event) => event.type === "permission-resolved").map((event) => event.decision), ["allow", "allow-for-chat"]);
});

test("forget drops a withdrawn request without answering it", () => {
  const { permissions, events, answers, ask } = pending();
  ask("a");
  assert.equal(permissions.forget("a"), true);
  assert.equal(permissions.forget("a"), false);
  assert.deepEqual(answers, []);
  assert.deepEqual(events.at(-1), { type: "permission-resolved", requestId: "a", decision: "cancelled" });
});

test("Claude: a shell command shows the command", () => {
  const request = claudeRequest("Bash", { command: "npm test", description: "Run tests" }, { requestId: "r1", toolUseID: "t1", suggestions: [{ type: "addRules" }] });
  assert.deepEqual(request, { requestId: "r1", kind: "command", tool: "Bash", title: "Run this command?", command: "npm test", allowForChat: true });
});

test("Claude: edits show the file and a diff", () => {
  const write = claudeRequest("Write", { file_path: "/repo/hello.txt", content: "hi\nthere" }, { requestId: "r1" });
  assert.deepEqual(write, { requestId: "r1", kind: "edit", tool: "Write", title: "Write hello.txt?", files: ["/repo/hello.txt"], diff: "+hi\n+there", allowForChat: false });
  const edit = claudeRequest("Edit", { file_path: "/repo/a.ts", old_string: "let a", new_string: "const a" }, { requestId: "r2" });
  assert.equal(edit.title, "Edit a.ts?");
  assert.equal(edit.diff, "-let a\n+const a");
  const multi = claudeRequest("MultiEdit", { file_path: "/repo/a.ts", edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] }, { requestId: "r3" });
  assert.equal(multi.diff, "-a\n+b\n@@\n-c\n+d");
});

test("Claude: other tools show their input, and the SDK's own wording wins", () => {
  const fetch = claudeRequest("WebFetch", { url: "https://example.com" }, { requestId: "r1" });
  assert.equal(fetch.kind, "other");
  assert.equal(fetch.title, "Use WebFetch?");
  assert.equal(fetch.detail, JSON.stringify({ url: "https://example.com" }, null, 2));
  const worded = claudeRequest("Read", { file_path: "/etc/hosts" }, { requestId: "r2", title: "Claude wants to read hosts", displayName: "Read file", description: "Outside the project", decisionReason: "Not in the allow list" });
  assert.equal(worded.title, "Claude wants to read hosts");
  assert.equal(worded.tool, "Read file");
  assert.equal(worded.description, "Outside the project");
  assert.equal(worded.reason, "Not in the allow list");
  const blocked = claudeRequest("Bash", { command: "cat ~/x" }, { requestId: "r3", blockedPath: "/Users/me/x" });
  assert.equal(blocked.reason, "Reaches outside this chat's folder: /Users/me/x");
});

test("Claude: always-allow is offered only with suggestions the SDK lets us keep", () => {
  const suggestions = [{ type: "setMode", mode: "acceptEdits", destination: "session" }];
  assert.equal(claudeRequest("Write", { file_path: "/a" }, { requestId: "r", suggestions }).allowForChat, true);
  assert.equal(claudeRequest("Write", { file_path: "/a" }, { requestId: "r", suggestions: [] }).allowForChat, false);
  assert.equal(claudeRequest("Write", { file_path: "/a" }, { requestId: "r", suggestions, suppressAlwaysAllowRule: true }).allowForChat, false);
});

test("Claude: answers become SDK permission results, and chat-wide rules stay in the session", () => {
  const input = { command: "npm test" };
  const suggestions = [
    { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "localSettings" },
    { type: "setMode", mode: "acceptEdits", destination: "userSettings" },
  ];
  assert.deepEqual(claudeResult("allow", input, suggestions), { behavior: "allow", updatedInput: input });
  assert.deepEqual(claudeResult("allow-for-chat", input, suggestions), {
    behavior: "allow",
    updatedInput: input,
    updatedPermissions: [
      { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "session" },
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ],
  });
  assert.deepEqual(claudeResult("deny", input, suggestions), { behavior: "deny", message: DENIED_MESSAGE });
  assert.deepEqual(claudeResult("cancelled", input, suggestions), { behavior: "deny", message: CANCELLED_MESSAGE, interrupt: true });
  assert.equal(DENIED_MESSAGE, "Denied in Milagre");
});

test("Codex: the shell wrapper is removed from commands", () => {
  assert.equal(unwrapShell("/bin/zsh -lc 'ls -la'"), "ls -la");
  assert.equal(unwrapShell("/bin/bash -lc 'echo '\\''hi'\\'''"), "echo 'hi'");
  assert.equal(unwrapShell("git status"), "git status");
  assert.equal(unwrapShell("/bin/zsh -lc ls"), "ls");
  assert.equal(unwrapShell("/usr/bin/bash -lc pwd"), "pwd");
  assert.equal(unwrapShell("/bin/zsh -lc ls -la"), "/bin/zsh -lc ls -la");
});

test("Codex: command requests", () => {
  assert.deepEqual(codexCommandRequest("srv-1", { itemId: "c", command: "/bin/zsh -lc 'rm -rf build'", cwd: "/repo", reason: "Clean the build" }), {
    requestId: "srv-1", kind: "command", tool: "Shell", title: "Run this command?", command: "rm -rf build", cwd: "/repo", reason: "Clean the build", allowForChat: true,
  });
  assert.deepEqual(codexCommandRequest(7, { command: "curl x", reason: null, networkApprovalContext: { host: "example.com", protocol: "https" } }), {
    requestId: "7", kind: "command", tool: "Shell", title: "Allow network access to example.com?", command: "curl x", allowForChat: true,
  });
});

test("Codex: file requests show the changes Codex reported when the edit started", () => {
  const changes = [{ path: "/repo/notes.txt", kind: { type: "add" }, diff: "+hello\n" }];
  assert.deepEqual(codexFileRequest("srv-2", { itemId: "p", reason: "Write notes" }, changes), {
    requestId: "srv-2", kind: "edit", tool: "Edit files", title: "Edit notes.txt?", files: ["/repo/notes.txt"], diff: "--- /repo/notes.txt\n+hello\n", reason: "Write notes", allowForChat: true,
  });
  assert.equal(codexFileRequest("s", {}, [changes[0], { path: "/repo/b", diff: "" }]).title, "Edit 2 files?");
  assert.deepEqual(codexFileRequest("s", { grantRoot: "/tmp/out" }, undefined), { requestId: "s", kind: "edit", tool: "Edit files", title: "Allow writing to /tmp/out?", files: [], allowForChat: true });
});

test("Codex: decisions", () => {
  assert.deepEqual(["allow", "allow-for-chat", "deny", "cancelled"].map(codexDecision), ["accept", "acceptForSession", "decline", "cancel"]);
});

test("long diffs and details are capped", () => {
  assert.equal(capText("short"), "short");
  const long = capText("x".repeat(25_000));
  assert.equal(long.length, 20_000 + "\n… truncated".length);
  assert.ok(long.endsWith("\n… truncated"));
});
