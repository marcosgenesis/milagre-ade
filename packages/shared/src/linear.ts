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

export type LinearIssueState = { name: string; type: "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled"; color: string };
export type LinearIssue = { key: string; title: string; url: string; branchName: string; description?: string; state: LinearIssueState };
export type LinearIssuesResult = { issues: LinearIssue[] } | { error: string; notConnected?: boolean };

/** First message of a Chat started from an issue; text the user had typed goes after the URL. */
export function issueFirstMessage(issue: LinearIssue, typed?: string): string {
  return (
    `Work on Linear issue ${issue.key}: ${issue.title}` +
    (issue.description ? `\n\n${issue.description}` : "") +
    `\n\n${issue.url}` +
    (typed?.trim() ? `\n\n${typed.trim()}` : "")
  );
}

export function issueChipLabel(issue: LinearIssue): string {
  return `${issue.key} · ${issue.state.name}`;
}

/** The composer text a failed send gives back: an issue's message is never restored, only what the user typed. */
export function restoredDraft(body: string, typed: string, fromIssue: boolean): string {
  return fromIssue ? typed : typed || body;
}
