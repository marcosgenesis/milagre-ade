const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Stops the given turns and waits until none of them is running any more (`remaining`), so each one's end
 * reaches its own project and the reply so far is saved there as cancelled. Gives up after `timeoutMs`, so a
 * turn that won't end can't hold a switch; true when every turn ended in time.
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
  await Promise.all(chatIds.map((chatId) => interrupt(chatId).catch(() => undefined)));
  for (let waited = 0; remaining().length > 0; waited += pollMs) {
    if (waited >= timeoutMs) return false;
    await sleep(pollMs);
  }
  return true;
}

/**
 * Replaces the open project. `load` opens the next one (the folder dialog, or a listed project) and resolves to
 * null when the dialog is cancelled. Only once it has loaded are the open project's turns stopped (`stop`), so a
 * cancelled dialog or a refused switch leaves them running; then the new project is shown (`adopt`). Opening the
 * project that is already open changes nothing.
 */
export async function changeProject<P extends { path: string }>({ currentPath, load, stop, adopt }: {
  currentPath: string | undefined;
  load: () => Promise<P | null>;
  stop: (projectPath: string) => Promise<unknown>;
  adopt: (project: P) => void;
}): Promise<P | null> {
  const next = await load();
  if (!next || next.path === currentPath) return null;
  if (currentPath !== undefined) await stop(currentPath);
  adopt(next);
  return next;
}
