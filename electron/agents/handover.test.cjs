const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { renderTranscript, transcriptPath, writeTranscript, generateBrief, TRANSCRIPT_LIMIT } = require("./handover.cjs");

const state = {
  worktrees: { 1: { id: 1, name: "main", path: "/repo" } },
  sessions: { 3: { id: 3, worktree_id: 1, agent_name: "main", status: "Created", provider: "claude", generatedTitle: "Fix login redirect" } },
  messages: [
    { id: 4, session_id: 3, role: "user", body: "fix the login redirect", context: null },
    { id: 5, session_id: 3, role: "assistant", model: "claude-opus-5-5", body: "Fixed it in `auth.ts`.", context: null, steps: [
      { id: "s1", kind: "thinking", title: "Thought", status: "done" },
      { id: "s2", kind: "shell", title: "Ran `npm test`", status: "failed", note: "exited with code 1 after 4s" },
      { id: "s3", kind: "edit", title: "Edited auth.ts", status: "done", file: "src/auth.ts" },
    ] },
    { id: 6, session_id: 9, role: "user", body: "another chat", context: null },
  ],
};

test("the transcript has a header, both roles and one line per tool step, without thinking or other chats", () => {
  const text = renderTranscript(state, 3);
  assert.match(text, /^# Chat transcript: Fix login redirect\n/);
  assert.match(text, /Provider: Claude · Worktree: \/repo/);
  assert.match(text, /## User\n\nfix the login redirect/);
  assert.match(text, /## Assistant \(claude-opus-5-5\)\n\n- Ran `npm test` \(failed, exited with code 1 after 4s\)\n- Edited auth.ts \(src\/auth.ts\)\n\nFixed it in `auth.ts`\./);
  assert.doesNotMatch(text, /Thought|another chat/);
});

test("transcripts are filed by a hash of the project and the session id", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "handover-"));
  const file = transcriptPath(dir, "/projects/alpha", 3);
  assert.match(file, new RegExp(`^${dir}/[0-9a-f]{12}/3\\.md$`));
  assert.equal(await writeTranscript({ dir, projectPath: "/projects/alpha", sessionId: 3, markdown: "hello" }), file);
  assert.equal(await fs.readFile(file, "utf8"), "hello");
});

test("the brief comes from the source provider, treats the transcript as data and ends with the transcript line", async () => {
  const calls = [];
  const brief = await generateBrief(
    { transcript: "T", transcriptPath: "/x/3.md", provider: "codex", lastUserMessage: "go", changedFiles: async () => { throw new Error("not on success"); } },
    { models: { codex: async (input) => { calls.push(input); return '{"brief":"## Goal\\nShip it"}'; }, claude: async () => { throw new Error("wrong provider"); } } },
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].system, /data/);
  assert.match(calls[0].prompt, /<transcript>\nT\n<\/transcript>/);
  assert.equal(brief, "You're taking over a chat that ran on Codex.\n\n## Goal\nShip it\n\nFull transcript of the previous chat: /x/3.md. Read it if you need details the brief leaves out.");
});

test("a long transcript is cut to its most recent part for the model", async () => {
  let prompt = "";
  const long = `${"a".repeat(TRANSCRIPT_LIMIT)}TAIL`;
  await generateBrief({ transcript: long, transcriptPath: "/x", provider: "claude", lastUserMessage: "", changedFiles: async () => [] }, { models: { claude: async (input) => { prompt = input.prompt; return '{"brief":"b"}'; } } });
  assert.match(prompt, /\[Earlier messages are cut off; read the transcript file for them\.\]/);
  assert.match(prompt, /TAIL\n<\/transcript>/);
  assert.ok(prompt.length < TRANSCRIPT_LIMIT + 2000);
});

for (const [name, model] of [["throws", async () => { throw new Error("signed out"); }], ["times out", () => new Promise(() => {})], ["returns junk", async () => "not json"]]) {
  test(`the brief falls back when the model ${name}`, async () => {
    const brief = await generateBrief(
      { transcript: "T", transcriptPath: "/x/3.md", provider: "claude", lastUserMessage: "fix the login redirect", changedFiles: async () => ["src/auth.ts", "src/auth.test.ts"] },
      { models: { claude: model }, timeoutMs: 20 },
    );
    assert.equal(brief, "You're taking over a chat that ran on Claude. Its summary couldn't be written, so here is the minimum.\n\nLast request:\nfix the login redirect\n\nChanged files:\n- src/auth.ts\n- src/auth.test.ts\n\nFull transcript of the previous chat: /x/3.md. Read it if you need details the brief leaves out.");
  });
}
