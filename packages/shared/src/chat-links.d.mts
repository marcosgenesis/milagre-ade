/** One end of a canvas Link: a whole Project, or one of its Worktrees. */
export type LinkEnd = { project_id: string; worktree_path?: string };
export type CanvasLink = { id: string; a: LinkEnd; b: LinkEnd; created_at: string };
/** A Chat's Worktree as a Link sees it. */
export type LinkWorktree = { project_id: string; worktree_path: string };
/** "Só estas worktrees" (Worktree↔Worktree) or "Os projetos inteiros" (Project↔Project). */
export type LinkScope = "worktrees" | "projects";

export function endpointCovers(endpoint: LinkEnd | undefined, worktree: LinkWorktree | undefined): boolean;
export function linkBetween<L extends CanvasLink>(links: readonly L[], a: LinkWorktree, b: LinkWorktree): L | undefined;
export function linkedEnds<L extends CanvasLink>(links: readonly L[], worktree: LinkWorktree): Array<{ link: L; other: LinkEnd }>;
export function canLinkProjects(a: { project_id: string } | undefined, b: { project_id: string } | undefined): boolean;
export function linkEndpoints(a: LinkWorktree, b: LinkWorktree, scope?: LinkScope): [LinkEnd, LinkEnd];
export function findLink<L extends CanvasLink>(links: readonly L[], a: LinkEnd, b: LinkEnd): L | undefined;
export function linkAskMessage(
  text: string,
  target: { label: string; chatRef: string; worktreePath: string; projectName?: string; branch?: string },
): { body: string; prompt: string };
