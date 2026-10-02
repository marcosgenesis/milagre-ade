const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Stops the given turns and waits until none is running any more (`remaining`), so each one's end reaches its
 * own project and the reply so far is saved there as cancelled. A turn that starts during the wait (one the agent
 * began itself) is stopped too. Gives up after `timeoutMs`, so a turn that won't end can't hold a switch; true
 * when every turn ended in time.
 */
export async function stopTurns({ chatIds, interrupt, remaining, timeoutMs = 5000, pollMs = 100, sleep = wait }: {
  chatIds: string[];
  interrupt: (chatId: string) => Promise<unknown>;
  remaining: () => string[];
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  if (!chatIds.length) return true;
  const interrupted = new Set<string>();
  const stop = (ids: string[]) => Promise.all(ids.filter((chatId) => !interrupted.has(chatId)).map((chatId) => {
    interrupted.add(chatId);
    return interrupt(chatId).catch(() => undefined);
  }));
  await stop(chatIds);
  for (let waited = 0; remaining().length > 0; waited += pollMs) {
    if (waited >= timeoutMs) return false;
    await sleep(pollMs);
    await stop(remaining());
  }
  return true;
}

export type ChangeOptions<P> = {
  currentPath: string | undefined;
  /** Opens the next project (the folder dialog, or a listed project); null when the dialog is cancelled. */
  load: () => Promise<P | null>;
  /** Whether the open project's turns may be stopped now: the user said so in the menu, or none is running. */
  mayStop: () => boolean;
  /** A turn started while `load` ran and nobody asked about it: the switch stops here so the menu can ask. */
  ask: (project: P) => void;
  stop: (projectPath: string) => Promise<unknown>;
  adopt: (project: P) => void;
};

/**
 * Replaces the open project. Only once the next one has loaded are the open project's turns stopped, so a cancelled
 * dialog or a refused switch leaves them running. The folder dialog isn't modal, so a turn can start while it is
 * open: if one did and the user wasn't asked, nothing is stopped and `ask` takes over. Opening the project that is
 * already open changes nothing.
 */
export async function changeProject<P extends { path: string }>({ currentPath, load, mayStop, ask, stop, adopt }: ChangeOptions<P>): Promise<P | null> {
  const next = await load();
  if (!next || next.path === currentPath) return null;
  if (!mayStop()) {
    ask(next);
    return null;
  }
  if (currentPath !== undefined) await stop(currentPath);
  adopt(next);
  return next;
}

/**
 * One switch at a time (another while it runs resolves to undefined). From the moment the open project's turns
 * start stopping until the new project shows, or the switch fails, `canSend` is false: a message sent then would
 * start a turn behind the stop. While the dialog is open, messages still go; a turn started then makes the switch
 * ask instead (`mayStop`).
 */
export function createProjectSwitcher() {
  let busy = false;
  let stopping = false;
  return {
    canSend: () => !stopping,
    async change<P extends { path: string }>(options: ChangeOptions<P>): Promise<P | null | undefined> {
      if (busy) return undefined;
      busy = true;
      try {
        return await changeProject({
          ...options,
          stop: (projectPath) => {
            stopping = true;
            return options.stop(projectPath);
          },
        });
      } finally {
        busy = false;
        stopping = false;
      }
    },
  };
}
