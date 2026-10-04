const { randomUUID } = require("node:crypto");

function sameEndpoint(a, b) {
  return a.project_id === b.project_id && a.worktree_path === b.worktree_path;
}

function validEndpoint(endpoint, projects, active) {
  if (!endpoint || typeof endpoint.project_id !== "string" || !projects.some(project => project.id === endpoint.project_id)) return false;
  if (endpoint.worktree_path === undefined) return true;
  return typeof endpoint.worktree_path === "string" && active[endpoint.project_id]?.includes(endpoint.worktree_path);
}

function canLink(a, b, projects, active) {
  return validEndpoint(a, projects, active) && validEndpoint(b, projects, active)
    && !sameEndpoint(a, b)
    && !(a.project_id === b.project_id && (a.worktree_path === undefined || b.worktree_path === undefined));
}

function hasEndpoint(link, endpoint) {
  return sameEndpoint(link.a, endpoint) || sameEndpoint(link.b, endpoint);
}

function createLink(links, a, b, projects, active, now = () => new Date()) {
  if (!canLink(a, b, projects, active)) throw new Error("These endpoints cannot be linked.");
  if (links.some(link => hasEndpoint(link, a) && hasEndpoint(link, b))) throw new Error("Link already exists.");
  return { id: randomUUID(), a, b, created_at: now().toISOString() };
}

function pruneLinks(links, projects, active) {
  return links.filter(link => canLink(link.a, link.b, projects, active));
}

function visibleWorktrees(source, links, active) {
  if (!active[source.project_id]?.includes(source.worktree_path)) return [];
  const found = new Map();
  for (const link of links) {
    const sourceSide = [link.a, link.b].find(endpoint => endpoint.project_id === source.project_id
      && (endpoint.worktree_path === undefined || endpoint.worktree_path === source.worktree_path));
    if (!sourceSide) continue;
    const target = sourceSide === link.a ? link.b : link.a;
    const paths = target.worktree_path === undefined ? active[target.project_id] ?? [] : [target.worktree_path];
    for (const worktree_path of paths) {
      if (!active[target.project_id]?.includes(worktree_path)) continue;
      if (target.project_id === source.project_id && worktree_path === source.worktree_path) continue;
      found.set(`${target.project_id}\0${worktree_path}`, { project_id: target.project_id, worktree_path });
    }
  }
  return [...found.values()];
}

module.exports = { canLink, createLink, pruneLinks, visibleWorktrees };
