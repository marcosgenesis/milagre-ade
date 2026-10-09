const LINK_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PREFIX = "milagre-link:";

export function validLinkId(id) {
  return typeof id === "string" && LINK_ID.test(id);
}
export function isLinkScopeKey(key) {
  return typeof key === "string" && key.startsWith(PREFIX) && validLinkId(key.slice(PREFIX.length));
}

export function scopeKey(scope) {
  if (scope?.kind === "link" && validLinkId(scope.linkId)) return PREFIX + scope.linkId;
  if (scope?.kind === "project" && typeof scope.projectPath === "string" && (scope.projectPath.startsWith("/") || /^[a-z]:[\\/]/i.test(scope.projectPath)))
    return scope.projectPath;
  throw new Error("Choose a valid Project or Link.");
}

export function scopeFromKey(key) {
  return isLinkScopeKey(key) ? { kind: "link", linkId: key.slice(PREFIX.length) } : { kind: "project", projectPath: key };
}

export function chatKeyForScope(scope, sessionId) {
  if (!Number.isSafeInteger(sessionId) || sessionId < 1) throw new Error("Invalid Chat ID.");
  return `${scopeKey(scope)}#${sessionId}`;
}

export function scopeFromChatKey(key) {
  if (typeof key !== "string" || !/#\d+$/.test(key)) throw new Error("Invalid Chat key.");
  const owner = key.slice(0, key.lastIndexOf("#"));
  const scope = scopeFromKey(owner);
  scopeKey(scope);
  return scope;
}
