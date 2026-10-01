// Stops a child process and everything it started. Agents start shells and MCP servers;
// signalling the whole process group keeps them from outliving the session. Children
// spawned with `detached: true` lead their own group; others fall back to a plain kill.
function killTree(child, { graceMs = 2000 } = {}) {
  if (!child?.pid || child.exitCode !== null || child.signalCode != null) return Promise.resolve();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms, "timeout"));
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
    } catch {
      try {
        child.kill(name);
      } catch {
        // Already gone.
      }
    }
  };
  signal("SIGTERM");
  return Promise.race([exited, wait(graceMs)]).then((result) => {
    if (result !== "timeout") return undefined;
    signal("SIGKILL");
    return Promise.race([exited, wait(graceMs)]).then(() => undefined);
  });
}

module.exports = { killTree };
