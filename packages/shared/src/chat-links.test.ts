import assert from "node:assert/strict";
import test from "node:test";
import { canLinkProjects, endpointCovers, findLink, linkAskMessage, linkBetween, linkedEnds, linkEndpoints } from "./chat-links.mjs";

const alpha = { project_id: "p1", worktree_path: "/p1/alpha" };
const bravo = { project_id: "p1", worktree_path: "/p1/bravo" };
const web = { project_id: "p2", worktree_path: "/p2/web" };
const links = [
  { id: "w", a: alpha, b: bravo, created_at: "" },
  { id: "p", a: { project_id: "p2" }, b: { project_id: "p3" }, created_at: "" },
];

test("endpointCovers: a Worktree end covers itself, a Project end covers every Worktree of its Project", () => {
  assert.equal(endpointCovers(alpha, alpha), true);
  assert.equal(endpointCovers(alpha, bravo), false);
  assert.equal(endpointCovers({ project_id: "p1" }, bravo), true);
  assert.equal(endpointCovers({ project_id: "p2" }, bravo), false);
  assert.equal(endpointCovers(undefined, alpha), false);
});

test("linkBetween finds a Link either way round, Project ends included", () => {
  assert.equal(linkBetween(links, alpha, bravo)?.id, "w");
  assert.equal(linkBetween(links, bravo, alpha)?.id, "w");
  assert.equal(linkBetween(links, { project_id: "p3", worktree_path: "/p3/x" }, web)?.id, "p");
  assert.equal(linkBetween(links, alpha, web), undefined);
});

test("linkedEnds lists each Link that reaches a Worktree with its other end", () => {
  assert.deepEqual(
    linkedEnds(links, alpha).map(({ link, other }) => [link.id, other]),
    [["w", bravo]],
  );
  assert.deepEqual(
    linkedEnds(links, web).map(({ link, other }) => [link.id, other]),
    [["p", { project_id: "p3" }]],
  );
  assert.deepEqual(linkedEnds(links, { project_id: "p9", worktree_path: "/x" }), []);
});

test("linkEndpoints: Worktrees by default, whole Projects only across two Projects", () => {
  assert.equal(canLinkProjects(alpha, bravo), false);
  assert.equal(canLinkProjects(alpha, web), true);
  assert.deepEqual(linkEndpoints(alpha, web), [alpha, web]);
  assert.deepEqual(linkEndpoints(alpha, web, "projects"), [{ project_id: "p1" }, { project_id: "p2" }]);
  assert.deepEqual(linkEndpoints(alpha, bravo, "projects"), [alpha, bravo], "one Project falls back to its Worktrees");
});

test("findLink finds the exact Link made between two endpoints", () => {
  assert.equal(findLink(links, bravo, alpha)?.id, "w");
  assert.equal(findLink(links, { project_id: "p3" }, { project_id: "p2" })?.id, "p");
  assert.equal(findLink(links, { project_id: "p1" }, { project_id: "p2" }), undefined);
});

test("linkAskMessage names the destination in the body and gives the agent its Chat ref and Worktree", () => {
  const { body, prompt } = linkAskMessage("  Wire the new endpoint into the form \n", {
    label: "Login form",
    chatRef: "/p2#4",
    worktreePath: "/p2/web",
    projectName: "web",
    branch: "login-form",
  });
  assert.equal(body, "Wire the new endpoint into the form\n\nDestination: “Login form” (web / login-form), in a linked Worktree.");
  assert.ok(prompt.startsWith(body));
  assert.match(prompt, /\/p2#4/);
  assert.match(prompt, /\/p2\/web/);
  assert.match(prompt, /Delegation/);
});
