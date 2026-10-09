const assert = require("node:assert/strict");
const test = require("node:test");
const { canLink, createLink, linkedWorktrees, pruneLinks } = require("./project-links.cjs");

// The reached Worktrees without the Link that reaches each one.
const visibleWorktrees = (...args) => linkedWorktrees(...args).map(({ project_id, worktree_path }) => ({ project_id, worktree_path }));

const projects = [{ id: "a" }, { id: "b" }, { id: "c" }];
const active = { a: ["/a/one", "/a/two"], b: ["/b/one"], c: ["/c/one"] };
const project = (project_id) => ({ project_id });
const worktree = (project_id, worktree_path) => ({ project_id, worktree_path });

test("Project and Worktree endpoints expand to current active Worktrees, one hop only", () => {
  const first = createLink([], project("a"), worktree("b", "/b/one"), projects, active);
  const second = createLink([first], worktree("b", "/b/one"), project("c"), projects, active);
  assert.deepEqual(visibleWorktrees(worktree("a", "/a/one"), [first, second], active), [worktree("b", "/b/one")]);
  assert.deepEqual(visibleWorktrees(worktree("a", "/a/two"), [first, second], active), [worktree("b", "/b/one")]);
  assert.deepEqual(visibleWorktrees(worktree("b", "/b/one"), [first, second], active), [
    worktree("a", "/a/one"),
    worktree("a", "/a/two"),
    worktree("c", "/c/one"),
  ]);
  assert.deepEqual(visibleWorktrees(worktree("a", "/a/one"), [first], { ...active, a: [...active.a, "/a/later"] }), [worktree("b", "/b/one")]);
  assert.deepEqual(visibleWorktrees(worktree("b", "/b/one"), [first], { ...active, a: [...active.a, "/a/later"] }), [
    worktree("a", "/a/one"),
    worktree("a", "/a/two"),
    worktree("a", "/a/later"),
  ]);
  assert.deepEqual(visibleWorktrees(worktree("a", "/gone"), [first], active), []);
});

test("Project to Project and Worktree to Worktree Links have symmetric reach", () => {
  const broad = createLink([], project("a"), project("b"), projects, active);
  const narrow = createLink([broad], worktree("a", "/a/one"), worktree("a", "/a/two"), projects, active);
  assert.deepEqual(visibleWorktrees(worktree("a", "/a/one"), [broad, narrow], active), [worktree("b", "/b/one"), worktree("a", "/a/two")]);
  assert.deepEqual(visibleWorktrees(worktree("a", "/a/two"), [narrow], active), [worktree("a", "/a/one")]);
  assert.deepEqual(visibleWorktrees(worktree("b", "/b/one"), [broad], active), [worktree("a", "/a/one"), worktree("a", "/a/two")]);
  assert.ok(!visibleWorktrees(worktree("a", "/a/one"), [broad, narrow], active).some((endpoint) => endpoint.worktree_path === "/a/one"));
});

test("self links, Project to its own Worktree, duplicates and inactive Worktrees are refused", () => {
  assert.equal(canLink(project("a"), project("a"), projects, active), false);
  assert.equal(canLink(project("a"), worktree("a", "/a/one"), projects, active), false);
  assert.equal(canLink(worktree("a", "/a/one"), worktree("a", "/a/one"), projects, active), false);
  assert.equal(canLink(worktree("a", "/missing"), project("b"), projects, active), false);
  assert.equal(canLink(worktree("a", "/a/one"), worktree("a", "/a/two"), projects, active), true);
  const link = createLink([], project("a"), project("b"), projects, active);
  assert.throws(() => createLink([link], project("b"), project("a"), projects, active), /already exists/);
});

test("inactive Worktree endpoints are pruned but Project endpoints remain", () => {
  const worktreeLink = createLink([], worktree("a", "/a/two"), project("b"), projects, active);
  const projectLink = createLink([worktreeLink], project("a"), project("c"), projects, active);
  assert.deepEqual(pruneLinks([worktreeLink, projectLink], projects, { ...active, a: ["/a/one"] }), [projectLink]);
});

test("each reached Worktree names the Link that reaches it", () => {
  const broad = createLink([], project("a"), project("b"), projects, active);
  const narrow = createLink([broad], worktree("a", "/a/one"), worktree("b", "/b/one"), projects, active);
  assert.deepEqual(linkedWorktrees(worktree("a", "/a/one"), [broad, narrow], active), [{ project_id: "b", worktree_path: "/b/one", link_id: broad.id }]);
  assert.deepEqual(linkedWorktrees(worktree("b", "/b/one"), [narrow], active), [{ project_id: "a", worktree_path: "/a/one", link_id: narrow.id }]);
});
