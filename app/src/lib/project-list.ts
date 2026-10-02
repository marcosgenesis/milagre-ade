/** A project in the recent list, as the main process keeps it (most recent first). */
export type RecentProject = { path: string; name: string; openedAt: string };

/** One project row in the project menu. */
export type ProjectRow = { path: string; name: string; initial: string; current: boolean };

/** What a click in the project menu asks for: another listed project, or the folder dialog. */
export type SwitchTarget = { kind: "project"; path: string } | { kind: "open" };

/** The letter shown for a project without an avatar. */
export function projectInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "M";
}

function folderName(projectPath: string): string {
  return projectPath.split("/").filter(Boolean).at(-1) ?? projectPath;
}

/**
 * The project menu's rows: the recent list in its order, with the open project checked. The open project is
 * always a row, first when the list doesn't have it (a plain folder isn't listed, or the list hasn't loaded).
 */
export function projectRows({ recent, currentPath, currentName }: { recent: RecentProject[]; currentPath: string; currentName?: string }): ProjectRow[] {
  const listed = recent.some((project) => project.path === currentPath);
  const projects = listed ? recent : [{ path: currentPath, name: currentName ?? folderName(currentPath), openedAt: "" }, ...recent];
  const seen = new Set<string>();
  return projects.flatMap((project) => {
    if (seen.has(project.path)) return [];
    seen.add(project.path);
    return [{ path: project.path, name: project.name, initial: projectInitial(project.name), current: project.path === currentPath }];
  });
}

export function sameTarget(a: SwitchTarget, b: SwitchTarget): boolean {
  return a.kind === "open" ? b.kind === "open" : b.kind === "project" && a.path === b.path;
}

/**
 * What a click in the project menu does. With no turn running it goes at once. While one runs, the first click
 * asks (`armed` is what was asked about) and a second click on the same choice goes; a different choice asks again.
 */
export function switchStep(armed: SwitchTarget | null, target: SwitchTarget, runningChat: string | null): { go: SwitchTarget } | { ask: SwitchTarget } {
  return runningChat === null || (armed !== null && sameTarget(armed, target)) ? { go: target } : { ask: target };
}

/** The chat a switch asks about: the first (most recent) one with a turn running or waiting on you, or null. */
export function runningChatTitle(chats: Array<{ label: string; mark?: string }>): string | null {
  return chats.find((chat) => chat.mark === "running" || chat.mark === "waiting")?.label ?? null;
}

export function switchQuestion(chat: string): string {
  return `A turn is running in ${chat}. Switch anyway?`;
}
