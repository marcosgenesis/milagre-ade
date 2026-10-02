/** A project in the recent list, as the main process keeps it (most recent first). */
export type RecentProject = { path: string; name: string; openedAt: string };

/** One project row in the project menu. */
export type ProjectRow = { path: string; name: string; initial: string; current: boolean };

/**
 * What a click in the project menu asks for: another listed project, the folder dialog, or a project already
 * picked in the dialog while a turn started (the switch stopped to ask about it).
 */
export type SwitchTarget = { kind: "project"; path: string } | { kind: "open" } | { kind: "loaded"; path: string; name: string };

/** The chat a switch asks about, and whether it waits on an approval or a question rather than working. */
export type RunningChat = { title: string; waiting: boolean };

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
  return a.kind === b.kind && (a.kind === "open" || a.path === (b as { path: string }).path);
}

/**
 * What a click in the project menu does. With no turn running it goes at once. While one runs, the first click
 * asks (`armed` is what was asked about) and a second click on the same choice goes; a different choice asks again.
 */
export function switchStep(armed: SwitchTarget | null, target: SwitchTarget, turnRunning: boolean): { go: SwitchTarget } | { ask: SwitchTarget } {
  return !turnRunning || (armed !== null && sameTarget(armed, target)) ? { go: target } : { ask: target };
}

/** The chat a switch asks about: the first (most recent) one with a turn running or waiting on you, or null. */
export function runningChat(chats: Array<{ label: string; mark?: string }>): RunningChat | null {
  const chat = chats.find((item) => item.mark === "running" || item.mark === "waiting");
  return chat ? { title: chat.label, waiting: chat.mark === "waiting" } : null;
}

export function switchQuestion(chat: RunningChat): string {
  const name = chat.title.trim();
  // A chat named after a sentence ("Fix the login.") keeps its own end mark instead of gaining a second; as the
  // subject of "is waiting for you" it loses a final period.
  if (chat.waiting) return `${name.replace(/[.…]+$/, "")} is waiting for you. Switch anyway?`;
  return `A turn is running in ${name}${/[.!?…]$/.test(name) ? "" : "."} Switch anyway?`;
}
