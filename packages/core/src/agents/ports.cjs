// The TCP ports each chat's agent has opened: dev servers, Metro, a database it started.
// A port belongs to a chat when the process listening on it was started by one of the agent's
// command shells. The agent CLI's other children (MCP servers) share its process group, while
// each command shell leads its own, so only a child that is a shell or leads its own group
// counts. A server that outlived its shell (`server &`) keeps the shell's group, so a chat
// remembers the groups it has seen and keeps showing their ports after the shell exits, and
// after the agent's session closes, until nothing in them runs any more. A shell that exited
// before a poll saw it leaves an orphan group (launchd's child, its leader gone); such a group
// is adopted by the chats whose worktree holds its working directory.
const { execFile } = require("node:child_process");
const path = require("node:path");

const POLL_MS = 3000;
const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "sandbox-exec"]);

const basename = (command) => command.split("/").pop().replace(/^-/, "");
const inside = (dir, root) => dir === root || dir.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** `ps -axo pid=,ppid=,pgid=,comm=` as rows of { pid, ppid, pgid, command }. */
function parsePs(output) {
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), command: match[4].trim() }] : [];
  });
}

/** `lsof -F pcn` listing TCP listeners, as rows of { pid, command, port, address }, one per pid and port. */
function parseLsof(output) {
  const rows = [];
  const seen = new Set();
  let pid = 0;
  let command = "";
  for (const line of output.split("\n")) {
    const value = line.slice(1);
    if (line[0] === "p") pid = Number(value);
    else if (line[0] === "c") command = value;
    else if (line[0] === "n") {
      const match = /^(.*):(\d+)$/.exec(value);
      if (!match || !pid) continue;
      const port = Number(match[2]);
      if (seen.has(`${pid}:${port}`)) continue;
      seen.add(`${pid}:${port}`);
      rows.push({ pid, command, port, address: match[1].replace(/^\[|\]$/g, "") });
    }
  }
  return rows;
}

/** `lsof -d cwd -F pn` as a Map of pid to working directory. */
function parseCwds(output) {
  const result = new Map();
  let pid = 0;
  for (const line of output.split("\n")) {
    if (line[0] === "p") pid = Number(line.slice(1));
    else if (line[0] === "n" && pid) result.set(pid, line.slice(1));
  }
  return result;
}

/** Processes in groups whose leader is gone and that launchd adopted: what a shell left running after it exited. */
function orphans(processes) {
  const pids = new Set(processes.map((row) => row.pid));
  return processes.filter((row) => row.ppid === 1 && row.pgid !== row.pid && !pids.has(row.pgid));
}

/**
 * Adds each orphan group to the groups of the chats whose worktree holds its working directory.
 * `cwds` maps an orphan's pid to its working directory; `roots` maps a chat id to { pid, cwd }.
 */
function adoptOrphans(processes, cwds, roots, groups) {
  for (const row of orphans(processes)) {
    const dir = cwds.get(row.pid);
    if (!dir) continue;
    for (const [chatId, root] of roots) {
      if (!root.cwd || !inside(dir, root.cwd)) continue;
      if (!groups.has(chatId)) groups.set(chatId, new Set());
      groups.get(chatId).add(row.pgid);
    }
  }
}

/**
 * The pids that belong to each chat's commands. `roots` maps a chat id to its agent's { pid, cwd }
 * (absent once its session closed); `groups` maps a chat id to the process groups it has seen, and is
 * updated in place.
 */
function chatProcesses(processes, roots, groups) {
  const children = new Map();
  const byPid = new Map(processes.map((row) => [row.pid, row]));
  for (const row of processes) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row);
  }
  const result = new Map();
  const chats = new Set([...roots.keys(), ...groups.keys()]);
  for (const chatId of chats) {
    const known = groups.get(chatId) ?? new Set();
    const pids = new Set();
    const add = (row) => {
      const stack = [row];
      while (stack.length) {
        const next = stack.pop();
        if (pids.has(next.pid)) continue;
        pids.add(next.pid);
        stack.push(...(children.get(next.pid) ?? []));
      }
    };
    const root = byPid.get(roots.get(chatId)?.pid);
    if (root) {
      for (const child of children.get(root.pid) ?? []) {
        if (SHELLS.has(basename(child.command)) || child.pgid !== root.pgid) add(child);
      }
    }
    for (const row of processes) if (known.has(row.pgid) && row.pgid !== root?.pgid) add(row);
    const live = new Set();
    for (const pid of pids) live.add(byPid.get(pid).pgid);
    // A group is forgotten once nothing in it runs.
    if (live.size) groups.set(chatId, live);
    else groups.delete(chatId);
    if (pids.size) result.set(chatId, pids);
  }
  return result;
}

/** Each chat's ports, sorted, from the listeners and each chat's pids. Chats with no ports are left out. */
function chatPorts(listeners, processesByChat) {
  const result = {};
  for (const [chatId, pids] of processesByChat) {
    const ports = new Map();
    for (const row of listeners) {
      if (!pids.has(row.pid) || ports.has(row.port)) continue;
      ports.set(row.port, { port: row.port, pid: row.pid, command: row.command, address: row.address });
    }
    if (ports.size) result[chatId] = [...ports.values()].sort((a, b) => a.port - b.port);
  }
  return result;
}

const run = (command, args) => new Promise((resolve) => {
  execFile(command, args, { maxBuffer: 8 * 1024 * 1024, timeout: 10_000 }, (_error, stdout) => resolve(stdout ?? ""));
});

/**
 * Polls while any chat has an agent running or a group it has seen. `roots()` returns a Map of chat id
 * to its agent's { pid, cwd }; `publish(ports)` gets every chat's ports, { [chatId]: [{ port, pid, command, address }] },
 * whenever they change.
 */
class PortWatcher {
  constructor({ roots, publish, pollMs = POLL_MS, idlePollMs = 15_000, isRunning = () => true, exec = run, kill = (pid, signal) => process.kill(pid, signal), graceMs = 2000 }) {
    Object.assign(this, { roots, publish, pollMs, idlePollMs, isRunning, exec, kill, graceMs });
    this.groups = new Map();
    this.processes = new Map();
    this.ports = {};
    this.timer = null;
    this.polling = false;
  }

  /** Every chat's ports now. */
  snapshot() {
    return this.ports;
  }

  /** Starts polling, if it isn't already; call when an agent's turn starts. */
  wake() {
    if (this.closed || this.polling) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), 0);
    this.timer.unref?.();
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Stops what listens on one of a chat's ports: the whole command it belongs to (its process group,
   * so `npm run dev` goes with its server), or the process alone when its group is the agent's own.
   * Only a pid the chat's list shows is stopped. SIGTERM first, SIGKILL if it is still there after
   * the grace period. Resolves with whether there was something to stop.
   */
  async stopPort(chatId, pid) {
    if (!this.ports[chatId]?.some((port) => port.pid === pid)) return false;
    const pgid = this.processes.get(pid)?.pgid;
    const target = pgid && this.groups.get(chatId)?.has(pgid) ? -pgid : pid;
    const signal = (name) => {
      try {
        this.kill(target, name);
        return true;
      } catch {
        return false;
      }
    };
    if (!signal("SIGTERM")) return false;
    const deadline = Date.now() + this.graceMs;
    while (Date.now() < deadline && signal(0)) await new Promise((resolve) => setTimeout(resolve, 50));
    if (signal(0)) signal("SIGKILL");
    await this.poll();
    return true;
  }

  async poll() {
    if (this.closed || this.polling) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.polling = true;
    try {
      const roots = this.roots();
      if (roots.size || this.groups.size) {
        const processes = parsePs(await this.exec("ps", ["-axo", "pid=,ppid=,pgid=,comm="]));
        this.processes = new Map(processes.map((row) => [row.pid, row]));
        const known = new Set([...this.groups.values()].flatMap((set) => [...set]));
        const strays = [...roots.values()].some((root) => root.cwd) ? orphans(processes).filter((row) => !known.has(row.pgid)) : [];
        if (strays.length) adoptOrphans(processes, parseCwds(await this.exec("lsof", ["-a", "-d", "cwd", "-p", strays.map((row) => row.pid).join(","), "-F", "pn"])), roots, this.groups);
        const byChat = chatProcesses(processes, roots, this.groups);
        const pids = [...new Set([...byChat.values()].flatMap((set) => [...set]))];
        const listeners = pids.length ? parseLsof(await this.exec("lsof", ["-nP", "-a", "-p", pids.join(","), "-iTCP", "-sTCP:LISTEN", "-F", "pcn"])) : [];
        this.set(chatPorts(listeners, byChat));
      } else this.set({});
      if (!this.closed && (this.roots().size || this.groups.size)) {
        this.timer = setTimeout(() => void this.poll(), this.isRunning() ? this.pollMs : this.idlePollMs);
        this.timer.unref?.();
      }
    } finally {
      this.polling = false;
    }
  }

  set(ports) {
    if (this.closed) return;
    if (JSON.stringify(ports) === JSON.stringify(this.ports)) return;
    this.ports = ports;
    this.publish(ports);
  }
}

module.exports = { PortWatcher, adoptOrphans, chatPorts, chatProcesses, orphans, parseCwds, parseLsof, parsePs };
