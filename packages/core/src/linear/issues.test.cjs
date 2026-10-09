const assert = require("node:assert/strict");
const test = require("node:test");
const { createLinearIssues } = require("./issues.cjs");
const { LinearError } = require("./errors.cjs");

const node = (key, extra = {}) => ({
  identifier: key,
  title: `Title ${key}`,
  url: `https://linear.app/acme/issue/${key}`,
  branchName: `${key.toLowerCase()}-title`,
  description: null,
  state: { name: "Todo", type: "unstarted", color: "#aaa" },
  ...extra,
});

// A fake of the Mac's Linear connection: `answer` gets each document and returns its data or throws.
function fakeLinear({ enabled = true, connected = true, answer = () => ({}) } = {}) {
  const calls = [];
  return {
    calls,
    enabled: () => enabled,
    status: () => (connected ? { connected: true, viewer: { name: "V", email: "v@x" }, organization: { name: "A", urlKey: "a" } } : { connected: false }),
    query: async (document, variables = {}) => {
      calls.push({ document, variables });
      return answer(document, variables);
    },
  };
}

test("issues say why they can't load when the switch is off or Linear isn't connected", async () => {
  const off = fakeLinear({ enabled: false });
  assert.deepEqual(await createLinearIssues({ linear: off }).list(), {
    error: "Linear is off in Settings › Experimental.",
    notConnected: true,
  });
  const disconnected = fakeLinear({ connected: false });
  assert.deepEqual(await createLinearIssues({ linear: disconnected }).list("ENG-1"), { error: "Linear isn't connected.", notConnected: true });
  assert.equal(off.calls.length + disconnected.calls.length, 0, "No query while Linear is off or disconnected");
});

test("with no query the list is the issues assigned to me, started or unstarted, newest first", async () => {
  const linear = fakeLinear({ answer: () => ({ viewer: { assignedIssues: { nodes: [node("ENG-1"), node("ENG-2", { description: "Details" })] } } }) });
  const result = await createLinearIssues({ linear }).list();
  assert.deepEqual(result.issues[0], {
    key: "ENG-1",
    title: "Title ENG-1",
    url: "https://linear.app/acme/issue/ENG-1",
    branchName: "eng-1-title",
    state: { name: "Todo", type: "unstarted", color: "#aaa" },
  });
  assert.equal(result.issues[1].description, "Details");
  assert.match(linear.calls[0].document, /assignedIssues\(first: ?50, orderBy: ?updatedAt/);
  assert.match(linear.calls[0].document, /type: \{ in: \["started", "unstarted"\] \}/);
});

test("the assigned list is kept for a minute, and fresh reads it again", async () => {
  let clock = 0;
  const linear = fakeLinear({ answer: () => ({ viewer: { assignedIssues: { nodes: [node("ENG-1")] } } }) });
  const issues = createLinearIssues({ linear, now: () => clock });
  await issues.list();
  clock = 59_000;
  assert.deepEqual(
    (await issues.list()).issues.map((issue) => issue.key),
    ["ENG-1"],
  );
  assert.equal(linear.calls.length, 1, "A reopen within the minute asks Linear nothing");
  await issues.list(undefined, { fresh: true });
  assert.equal(linear.calls.length, 2, "Refresh asks Linear again");
  clock = 120_000;
  await issues.list();
  assert.equal(linear.calls.length, 3, "An old list is read again");
});

test("a search asks the workspace for 25 matches, and a key lookup comes first without duplicates", async () => {
  const linear = fakeLinear({
    answer: (document, variables) => {
      if (document.includes("searchIssues")) return { searchIssues: { nodes: [node("ENG-1"), node("ENG-9")] } };
      if (variables.id === "ENG-1") return { issue: node("ENG-1") };
      throw new Error("unexpected");
    },
  });
  const result = await createLinearIssues({ linear }).list("eng-1");
  assert.deepEqual(
    result.issues.map((issue) => issue.key),
    ["ENG-1", "ENG-9"],
  );
  assert.match(linear.calls.find((call) => call.document.includes("searchIssues")).document, /searchIssues\(term: ?\$q, first: ?25\)/);
});

test("a key that doesn't exist is not an error for a search, but a failed search is", async () => {
  const missing = fakeLinear({
    answer: (document) => {
      if (document.includes("searchIssues")) return { searchIssues: { nodes: [node("ENG-4")] } };
      throw new LinearError("Entity not found", "failed");
    },
  });
  assert.deepEqual(
    (await createLinearIssues({ linear: missing }).list("ENG-77")).issues.map((issue) => issue.key),
    ["ENG-4"],
  );
  const broken = fakeLinear({
    answer: () => {
      throw new LinearError("Linear is limiting requests.", "rate-limited");
    },
  });
  assert.deepEqual(await createLinearIssues({ linear: broken }).list("fix"), { error: "Linear is limiting requests." });
  const revoked = fakeLinear({
    answer: () => {
      throw new LinearError("Linear isn't connected.", "revoked");
    },
  });
  assert.deepEqual(await createLinearIssues({ linear: revoked }).list(), { error: "Linear isn't connected.", notConnected: true });
});

test("readIssue fetches several keys in one query and treats a missing one as null", async () => {
  const linear = fakeLinear({
    answer: (document, variables) => {
      if (document.includes("i0:")) {
        // One missing key fails the batch as a whole, so each key is then asked alone.
        throw new LinearError("Entity not found", "failed");
      }
      if (variables.id === "ENG-2") return { issue: node("ENG-2") };
      throw new LinearError("Entity not found", "failed");
    },
  });
  const issues = createLinearIssues({ linear });
  const batch = await issues.readIssues(["ENG-1", "ENG-2"], { fresh: true });
  assert.equal(batch.get("ENG-2").key, "ENG-2");
  assert.equal(batch.get("ENG-1"), null);
  assert.match(linear.calls[0].document, /i0: issue\(id: "ENG-1"\)/);
  assert.match(linear.calls[0].document, /i1: issue\(id: "ENG-2"\)/);
});

test("readIssues never sends a key that isn't key-shaped to Linear", async () => {
  const linear = fakeLinear({ answer: () => ({ issue: null }) });
  const found = await createLinearIssues({ linear }).readIssues(['ENG-1") { x } #', "ENG-3"], { fresh: true });
  assert.deepEqual([...found.keys()], ["ENG-3"]);
  assert.doesNotMatch(linear.calls[0].document, /#/);
});

test("worktrees name their issue by the stored key or by the team key in their branch", async () => {
  const linear = fakeLinear({
    answer: (document) => {
      if (document.includes("teams(")) return { teams: { nodes: [{ key: "ENG" }, { key: "WEB" }] } };
      return { i0: node("ENG-12"), i1: node("WEB-3") };
    },
  });
  const issues = createLinearIssues({ linear, now: () => 0 });
  const found = await issues.worktreeIssues([
    { name: "eng-12-fix-login", path: "/wt/a" },
    { name: "milagre/fix-x-ab12", path: "/wt/b", linearIssue: "WEB-3" },
    { name: "milagre/plain-cd34", path: "/wt/c" },
  ]);
  assert.deepEqual(Object.keys(found).sort(), ["/wt/a", "/wt/b"]);
  assert.equal(found["/wt/a"].key, "ENG-12");
  assert.equal(found["/wt/b"].key, "WEB-3");
});

test("worktree issues are cached for a minute, team keys for ten, and empty when they can't be read", async () => {
  let clock = 0;
  const linear = fakeLinear({
    answer: (document) => (document.includes("teams(") ? { teams: { nodes: [{ key: "ENG" }] } } : { i0: node("ENG-12") }),
  });
  const issues = createLinearIssues({ linear, now: () => clock });
  const worktrees = [{ name: "eng-12-fix", path: "/wt/a" }];
  await issues.worktreeIssues(worktrees);
  await issues.worktreeIssues(worktrees);
  assert.equal(linear.calls.length, 2, "one teams query and one issue query");
  clock = 61_000;
  await issues.worktreeIssues(worktrees);
  assert.equal(linear.calls.filter((call) => call.document.includes("teams(")).length, 1, "team keys still fresh at 61 s");
  assert.equal(linear.calls.length, 3);

  const broken = fakeLinear({
    answer: () => {
      throw new LinearError("Couldn't reach Linear", "offline");
    },
  });
  assert.deepEqual(await createLinearIssues({ linear: broken }).worktreeIssues(worktrees), {});
  assert.deepEqual(await createLinearIssues({ linear: fakeLinear({ enabled: false }) }).worktreeIssues(worktrees), {});
  assert.deepEqual(await createLinearIssues({ linear: fakeLinear({ connected: false }) }).worktreeIssues(worktrees), {});
});

test("only Linear's not-found reads as a missing issue; any other failure is thrown", async () => {
  const notFound = fakeLinear({
    answer: (document) => {
      if (document.includes("i0:")) throw new LinearError("Entity not found", "failed");
      throw Object.assign(new LinearError("Something odd", "failed"), { extensions: { type: "entity not found" } });
    },
  });
  assert.equal(await createLinearIssues({ linear: notFound }).readIssue("ENG-5"), null);

  const broken = fakeLinear({
    answer: () => {
      throw Object.assign(new LinearError("Field 'x' doesn't exist", "failed"), { extensions: { code: "GRAPHQL_VALIDATION_FAILED" } });
    },
  });
  await assert.rejects(createLinearIssues({ linear: broken }).readIssue("ENG-5"), { code: "failed", message: "Field 'x' doesn't exist" });
  await assert.rejects(createLinearIssues({ linear: broken }).readIssues(["ENG-5", "ENG-6"], { fresh: true }), { code: "failed" });
});

test("a failed team-key lookup still resolves the worktrees that store their issue", async () => {
  const linear = fakeLinear({
    answer: (document) => {
      if (document.includes("teams(")) throw new LinearError("Couldn't reach Linear", "offline");
      return { i0: node("ENG-12") };
    },
  });
  const found = await createLinearIssues({ linear, now: () => 0 }).worktreeIssues([
    { name: "milagre/fix-x-ab12", path: "/wt/a", linearIssue: "ENG-12" },
    { name: "eng-13-plain", path: "/wt/b" },
  ]);
  assert.deepEqual(Object.keys(found), ["/wt/a"]);
  assert.equal(found["/wt/a"].key, "ENG-12");
});
