// Linear issues for the Mac's Chat list, the issue picker and each Worktree's chip (see the Linear spec, Issues).
// Every method reads through the Mac's one connection; `linear` is that connection (query, status, enabled).
const { LinearError } = require("./errors.cjs");
const { isIssueKey, issueKeyInBranch } = require("./links.cjs");

const ISSUE_TTL_MS = 60_000;
const TEAMS_TTL_MS = 10 * 60_000;
const OFF = "Linear is off in Settings › Experimental.";
const DISCONNECTED = "Linear isn't connected.";
const ISSUE_FIELDS = "identifier title url branchName description state { name type color }";
const NOT_CONNECTED_CODES = new Set(["not-connected", "revoked"]);

const ASSIGNED = `query Assigned {
  viewer { assignedIssues(first: 50, orderBy: updatedAt, filter: { state: { type: { in: ["started", "unstarted"] } } }) { nodes { ${ISSUE_FIELDS} } } }
}`;
const SEARCH = `query Search($q: String!) { searchIssues(term: $q, first: 25) { nodes { ${ISSUE_FIELDS} } } }`;
const ONE = `query One($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`;
const TEAMS = "query Teams { teams(first: 100) { nodes { key } } }";

function toIssue(node) {
  if (!node || typeof node !== "object") return null;
  return {
    key: node.identifier,
    title: node.title,
    url: node.url,
    branchName: node.branchName,
    ...(node.description ? { description: node.description } : {}),
    state: { name: node.state?.name, type: node.state?.type, color: node.state?.color },
  };
}

// Linear reports a missing entity as a failed GraphQL query whose message or extensions say "not found".
function isNotFound(error) {
  if (error?.code !== "failed") return false;
  const extensions = error.extensions ?? {};
  return [error.message, extensions.type, extensions.code].some((text) => typeof text === "string" && /not[ _]?found/i.test(text));
}

function createLinearIssues({ linear, now = Date.now }) {
  const cache = new Map(); // key -> { at, issue }, the issue null when Linear has no such key
  let teams = null; // { at, keys }, the workspace's team keys in upper case

  // Why issues can't be read right now, or null when they can.
  function unavailable() {
    if (!linear.enabled()) return { error: OFF, notConnected: true };
    if (!linear.status().connected) return { error: DISCONNECTED, notConnected: true };
    return null;
  }

  // A key the workspace doesn't have is a missing issue, not a failed read. Any other failure is thrown.
  async function fetchOne(key) {
    try {
      const data = await linear.query(ONE, { id: key });
      return toIssue(data?.issue);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  // One query for every key. Linear fails the whole batch when one key is missing, so then each key is asked alone.
  async function fetchBatch(keys) {
    const aliases = keys.map((key, index) => `i${index}: issue(id: ${JSON.stringify(key)}) { ${ISSUE_FIELDS} }`).join("\n");
    try {
      const data = await linear.query(`query Issues {\n${aliases}\n}`);
      return new Map(keys.map((key, index) => [key, toIssue(data?.[`i${index}`])]));
    } catch (error) {
      if (error.code !== "failed") throw error;
    }
    const found = new Map();
    for (const key of keys) found.set(key, await fetchOne(key));
    return found;
  }

  async function readIssues(keys, { fresh = false } = {}) {
    const wanted = [...new Set(keys.filter(isIssueKey).map((key) => key.toUpperCase()))];
    const result = new Map();
    const missing = [];
    for (const key of wanted) {
      const hit = fresh ? null : cache.get(key);
      if (hit && now() - hit.at < ISSUE_TTL_MS) result.set(key, hit.issue);
      else missing.push(key);
    }
    if (missing.length) {
      const found = await fetchBatch(missing);
      for (const key of missing) {
        const issue = found.get(key) ?? null;
        cache.set(key, { at: now(), issue });
        result.set(key, issue);
      }
    }
    return result;
  }

  async function readIssue(key) {
    return (await readIssues([key], { fresh: true })).get(String(key).toUpperCase()) ?? null;
  }

  async function teamKeys() {
    if (teams && now() - teams.at < TEAMS_TTL_MS) return teams.keys;
    const data = await linear.query(TEAMS);
    const keys = new Set((data?.teams?.nodes ?? []).map((team) => String(team.key).toUpperCase()));
    teams = { at: now(), keys };
    return keys;
  }

  // The Chat list's picker: the issue picker shows the assigned issues, or the workspace matches for a query.
  async function list(query) {
    const unready = unavailable();
    if (unready) return unready;
    const text = typeof query === "string" ? query.trim() : "";
    try {
      if (!text) {
        const data = await linear.query(ASSIGNED);
        return { issues: (data?.viewer?.assignedIssues?.nodes ?? []).map(toIssue) };
      }
      const exact = isIssueKey(text) ? await fetchOne(text.toUpperCase()) : null;
      const data = await linear.query(SEARCH, { q: text });
      const matches = (data?.searchIssues?.nodes ?? []).map(toIssue).filter((issue) => issue && issue.key !== exact?.key);
      return { issues: exact ? [exact, ...matches] : matches };
    } catch (error) {
      return { error: error.message, ...(NOT_CONNECTED_CODES.has(error.code) ? { notConnected: true } : {}) };
    }
  }

  // Worktree path -> the issue it was started from or names in its branch. Never throws: a failed read shows no chips.
  async function worktreeIssues(worktrees) {
    if (unavailable()) return {};
    try {
      const named = [];
      let known = null;
      for (const worktree of worktrees) {
        if (worktree.linearIssue) {
          named.push([worktree.path, String(worktree.linearIssue).toUpperCase()]);
          continue;
        }
        // Best effort: without the team keys only the worktrees that store their issue still resolve.
        known ??= await teamKeys().catch(() => new Set());
        const key = issueKeyInBranch(worktree.name, known);
        if (key) named.push([worktree.path, key]);
      }
      const issues = await readIssues(named.map(([, key]) => key));
      const result = {};
      for (const [path, key] of named) {
        const issue = issues.get(key);
        if (issue) result[path] = issue;
      }
      return result;
    } catch {
      return {};
    }
  }

  return { list, readIssue, readIssues, worktreeIssues };
}

module.exports = { createLinearIssues };
