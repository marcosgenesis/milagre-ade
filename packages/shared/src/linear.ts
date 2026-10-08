// Linear connection copy, shared by desktop and phone (see docs/superpowers/specs/2026-10-08-linear-integration-design.md).

export type LinearViewer = { name: string; email: string };
export type LinearOrganization = { name: string; urlKey: string };
export type LinearStatus = { connected: false } | { connected: true; viewer: LinearViewer; organization: LinearOrganization };

export const LINEAR_TITLE = "Linear";
export const LINEAR_HINT = "Start chats from Linear issues and see each Worktree's issue.";
export const LINEAR_CONNECTING = "Finish signing in to Linear in your browser.";

/** Connecting happens on the Mac only, so a disconnected phone points there. */
export function linearStatusLine(status: LinearStatus, where: "mac" | "phone"): string {
  if (status.connected) return `Connected as ${status.viewer.name} to ${status.organization.name}`;
  return where === "mac" ? "Not connected" : "Connect Linear from Settings on your Mac";
}
