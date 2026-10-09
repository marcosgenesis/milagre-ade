const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLinearTools, formatIssue, linearToolDefinitions } = require("./tools.cjs");

const full = {
  identifier: "ENG-12",
  title: "Fix the login redirect",
  url: "https://linear.app/acme/issue/ENG-12",
  description: "See ![shot](https://uploads.linear.app/a/b/c)",
  priorityLabel: "High",
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-02T10:00:00Z",
  state: { name: "Todo" },
  assignee: null,
  creator: { name: "Liz" },
  team: { name: "Engineering" },
  labels: { nodes: [{ name: "Bug" }] },
  project: null,
  cycle: null,
  parent: { identifier: "ENG-1", title: "Auth", state: { name: "Started" } },
  children: { nodes: [] },
  relations: { nodes: [{ type: "blocks", relatedIssue: { identifier: "ENG-13", title: "Ship", state: { name: "Todo" } } }] },
  inverseRelations: { nodes: [{ type: "blocks", issue: { identifier: "ENG-9", title: "Tokens", state: { name: "Done" } } }] },
  attachments: { nodes: [{ title: "PR #4", subtitle: null, url: "https://github.com/a/b/pull/4" }] },
  comments: {
    nodes: [
      { id: "2", body: "Second", createdAt: "2026-10-03T00:00:00Z", user: null, externalUser: null, botActor: { name: "GitHub" }, parent: { id: "1" } },
      { id: "1", body: "First", createdAt: "2026-10-02T00:00:00Z", user: { name: "Jordan" }, externalUser: null, botActor: null, parent: null },
    ],
  },
};

function fakes({ workspaces = ["acme"], enabled = true, download } = {}) {
  const calls = [];
  const linear = {
    enabled: () => enabled,
    workspaces: () => workspaces.map((id) => ({ id })),
    query: async (workspace, _document, variables) => (calls.push([workspace, variables.id]), { issue: full }),
    download: download ?? (async () => ({ type: "image/png", bytes: Buffer.from("png") })),
  };
  const issues = {
    readIssue: async (key, workspace) => (key === "ENG-12" ? { key, workspace: workspace ?? workspaces[0] } : null),
    list: async (query, { workspace }) => ({
      issues: query === "login" ? [{ key: "ENG-12", title: "Fix", url: full.url, state: { name: "Todo" } }] : [],
      workspace,
    }),
  };
  return { linear, issues, calls };
}

test("an issue reads as markdown with comments in order, relations both ways and a hint for uploads", () => {
  const text = formatIssue(full);
  assert.match(text, /^# ENG-12: Fix the login redirect/);
  assert.match(text, /State: Todo · Priority: High · Assignee: nobody · Team: Engineering · Labels: Bug/);
  assert.match(text, /Parent: ENG-1 Auth \(Started\)/);
  assert.match(text, /- blocks: ENG-13 Ship \(Todo\)\n- blocked by: ENG-9 Tokens \(Done\)/);
  assert.match(text, /- PR #4: https:\/\/github.com\/a\/b\/pull\/4/);
  assert.ok(text.indexOf("### Jordan, 2026-10-02") < text.indexOf("### GitHub, 2026-10-03 (reply in a thread)"));
  assert.match(text, /download them with linear_file/);
});

test("an issue URL picks its workspace; a workspace that isn't connected says how to add it", async () => {
  const f = fakes({ workspaces: ["acme", "beta"] });
  const tools = createLinearTools(f);
  await tools.issue("https://linear.app/beta/issue/ENG-12/fix-login");
  assert.deepEqual(f.calls, [["beta", "ENG-12"]]);
  await assert.rejects(
    tools.issue("https://linear.app/arketa/issue/ENG-12/x"),
    /isn't connected to the "arketa" Linear workspace \(connected: acme, beta\).*Add workspace/,
  );
  await assert.rejects(tools.issue("ENG-404"), /ENG-404 isn't in any connected Linear workspace/);
  await assert.rejects(tools.issue("hello"), /issue key such as ENG-12/);
});

test("the tools explain when Linear is off or not connected", async () => {
  await assert.rejects(createLinearTools(fakes({ enabled: false })).issue("ENG-12"), /Linear is off/);
  await assert.rejects(createLinearTools(fakes({ workspaces: [] })).search("x"), /isn't connected to Linear/);
});

test("search lists matches, and says which other workspaces exist when none match", async () => {
  const tools = createLinearTools(fakes({ workspaces: ["acme", "beta"] }));
  assert.equal(await tools.search("login"), `- ENG-12 Fix (Todo) ${full.url}`);
  assert.equal(await tools.search("nothing"), "No issues match in acme. Other connected workspaces: beta.");
});

test("a Linear upload is saved under the temp folder; other URLs are refused", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "milagre-linear-files-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const tried = [];
  const download = async (workspace) => {
    tried.push(workspace);
    if (workspace === "acme") throw Object.assign(new Error("no such file"), { code: "not-found" });
    return { type: "image/png; charset=binary", bytes: Buffer.from("png") };
  };
  const tools = createLinearTools({ ...fakes({ workspaces: ["acme", "beta"], download }), dir });
  const saved = await tools.file("https://uploads.linear.app/a/b/c");
  assert.deepEqual(tried, ["acme", "beta"]);
  const file = saved.match(/to (.+)$/)[1];
  assert.equal(path.dirname(file), dir);
  assert.equal(path.extname(file), ".png");
  assert.equal(await fs.readFile(file, "utf8"), "png");
  await assert.rejects(tools.file("https://example.com/x.png"), /uploads\.linear\.app/);
});

test("the definitions are read-only and named for MCP", () => {
  const definitions = linearToolDefinitions(createLinearTools(fakes()));
  assert.deepEqual(
    definitions.map((definition) => definition.name),
    ["linear_issue", "linear_search", "linear_file"],
  );
  assert.ok(definitions.every((definition) => definition.readOnly));
});
