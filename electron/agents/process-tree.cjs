// Stops a child process and everything it started. Agents start shells and MCP servers;
// signalling the whole process group keeps them from outliving the session, even when the
// leader itself already exited (an idle CLI exits as soon as its stdin ends). Children
// spawned with `detached: true` lead their own group; others fall back to a plain kill.
const POLL_MS = 50;

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killTree(child, { graceMs = 2000 } = {}) {
  const pid = child?.pid;
  if (!pid) return;
  const exited = () => child.exitCode !== null || child.signalCode != null;
  const alive = () => groupAlive(pid) || !exited();
  const signal = (name) => {
    try {
      process.kill(-pid, name);
      return;
    } catch (error) {
      // No such group: it is already gone, unless the child never led one (not detached).
      if (error.code === "ESRCH" && exited()) return;
    }
    try {
      child.kill(name);
    } catch {
      // Already gone.
    }
  };
  if (!alive()) return;
  signal("SIGTERM");
  if (await waitForExit(alive, graceMs)) return;
  signal("SIGKILL");
  await waitForExit(alive, graceMs);
}

// Polls until alive() is false (true) or ms pass (false). No timer is left once it settles.
function waitForExit(alive, ms) {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const check = () => {
      if (!alive()) resolve(true);
      else if (Date.now() >= deadline) resolve(false);
      else setTimeout(check, POLL_MS);
    };
    check();
  });
}

module.exports = { killTree };
