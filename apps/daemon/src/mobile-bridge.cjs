const http = require("node:http");
const { once } = require("node:events");
const { timingSafeEqual } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { randomUUID, createHash } = require("node:crypto");
const zlib = require("node:zlib");
const { WebSocketServer, WebSocket } = require("ws");
const { applyAgentEvent, chatInProject, projectOfKey } = require("@milagre/shared/agent-runs");
const { applyStatePatch, diffState } = require("@milagre/shared/state-patch");
const { reconcileState } = require("@milagre/shared/reconcile");
const { isLinkScopeKey, scopeFromKey } = require("@milagre/shared/chat-scopes");
const { chatsNeedingAttention } = require("@milagre/shared/attention");
const { pullRequestRefs } = require("@milagre/shared/chats");
const { connect } = require("./client.cjs");
const { createConfinement } = require("./confine.cjs");

// Characters of a data URL the phone gets for a Project's icon (about 450 KB of image).
const MAX_PROJECT_IMAGE = 600_000;
const METHODS = new Set([
  "push:register",
  "push:unregister",
  "push:focus",
  "daemon:status",
  "project:recent",
  "project:open",
  "project:forget",
  "project:find",
  "project:image",
  "project:set-icon",
  "project:set-hidden",
  "chat:runs",
  "chat:ports",
  "agent:stop-port",
  "simulator:list",
  "simulator:attach",
  "simulator:detach",
  "simulator:open",
  "simulator:offer",
  "simulator:status",
  "simulator:control",
  "simulator:input",
  "simulator:close",
  "browser:list",
  "browser:attach",
  "browser:open",
  "browser:frame",
  "browser:status",
  "browser:control",
  "browser:input",
  "browser:close",
  "terminal:list",
  "terminal:open",
  "terminal:read",
  "terminal:input",
  "terminal:resize",
  "terminal:close",
  "artifact:get",
  "artifact:list",
  "artifact:add-comments",
  "artifact:comments",
  "project:registry",
  "link:list",
  "link:create",
  "link:update",
  "link:open",
  "link:send",
  "chat:send",
  "chat:resume",
  "agent:interrupt",
  "advisor:stop",
  "advisor:retry",
  "agent:respond-permission",
  "accounts:scopes",
  "accounts:scope",
  "accounts:assign",
  "accounts:list",
  "accounts:add",
  "accounts:select",
  "accounts:login",
  "accounts:cancel",
  "accounts:remove",
  "usage:read",
  "usage:cached",
  "agent:answer-question",
  "agent:set-permission-mode",
  "agent:models",
  "agent:cli-status",
  "chat:patch",
  "chat:archive-subagent",
  "chat:archive-finished-subagents",
  "attachment:preview",
  "worktree:pull-request",
  "worktree:pull-requests",
  "project:branches",
  "skills:list",
  "skills:read",
  "worktree:create",
  "git:diff-files",
  "git:diff-file",
  // Archive's confirm step: whether the Chat's worktree is Milagre's and what removing it would lose, then the removal,
  // which the daemon checks again against what the phone saw after closing the Chat's agent.
  "worktree:roots",
  "worktree:status",
  "worktree:remove",
]);
const MAX_BODY = 1024 * 1024;
// Subagent entries the phone shows under each agent.
const TRANSCRIPT_TAIL = 4;

// Characters of each subagent entry the phone shows (six lines at most).
const TRANSCRIPT_TEXT = 600;

/**
 * A Project as the phone lists it. Tool output and subagent transcripts make up most of a large Project's state (in
 * one, 6.8 of 8 MB) and the phone shows neither until asked: steps keep `hasDetail` and the full message comes from
 * /message. A reply keeps the detail of its last thinking step, which it can show in place of an answer; each subagent
 * keeps the start of its last few transcript entries.
 */
function projectPullRequestRefs(project) {
  const messages = new Map();
  for (const message of project.state.messages) {
    const list = messages.get(message.session_id) || [];
    list.push(message);
    messages.set(message.session_id, list);
  }
  // A Chat's summary has its refs; only a Chat without one (an older state) is read message by message.
  const refs = Object.fromEntries(
    [...messages].map(([id, list]) => [id, project.state.sessions?.[id]?.summary?.pullRequests ?? pullRequestRefs(list)]).filter(([, refs]) => refs.length),
  );
  // The same objects as last time where nothing changed, so a phone's patch carries only the Chats whose refs did.
  const stable = reconcileState(lastPullRequestRefs.get(project.path), refs);
  lastPullRequestRefs.delete(project.path);
  lastPullRequestRefs.set(project.path, stable);
  if (lastPullRequestRefs.size > 16) lastPullRequestRefs.delete(lastPullRequestRefs.keys().next().value);
  return stable;
}
const lastPullRequestRefs = new Map();

function forPhone(project) {
  const state = project?.state;
  if (!state) return project;
  const messages = state.messages.map(phoneMessage);
  const sessions = Object.fromEntries(Object.entries(state.sessions).map(([id, session]) => [id, phoneSession(session)]));
  return { ...project, pullRequestRefs: projectPullRequestRefs(project), state: { ...state, messages, sessions } };
}
// The slim copy of each message and session is kept for as long as the state holds it. A new state shares what didn't
// change with the one before, so its phone copy does too: two snapshots then differ only where the state changed, and
// the second can go to the phone as a patch (see /snapshot).
const phoneMessages = new WeakMap();
const phoneSessions = new WeakMap();
const phoneAgents = new WeakMap();
const clip = (text) => (typeof text === "string" && text.length > TRANSCRIPT_TEXT ? `${text.slice(0, TRANSCRIPT_TEXT)}…` : text);
function phoneMessage(message) {
  if (!message.steps?.some((step) => step.detail)) return message;
  let slim = phoneMessages.get(message);
  if (!slim) {
    const thought = message.steps.findLastIndex((step) => step.kind === "thinking" && step.detail?.trim());
    const steps = message.steps.map((step, index) => (step.detail && index !== thought ? { ...step, detail: undefined, hasDetail: true } : step));
    slim = { ...message, steps };
    phoneMessages.set(message, slim);
  }
  return slim;
}
function phoneSession(session) {
  if (!session.subagents?.length) return session;
  let slim = phoneSessions.get(session);
  if (!slim) {
    slim = { ...session, subagents: session.subagents.map(phoneAgent) };
    phoneSessions.set(session, slim);
  }
  return slim;
}
function phoneAgent(agent) {
  let slim = phoneAgents.get(agent);
  if (!slim) {
    slim = {
      ...agent,
      latestActivity: clip(agent.latestActivity),
      transcript: (agent.transcript || [])
        .slice(-TRANSCRIPT_TAIL)
        .map((item) => ({ ...item, text: agent.source === "milagre-advisor" ? item.text.slice(0, 40_000) : clip(item.text) })),
    };
    phoneAgents.set(agent, slim);
  }
  return slim;
}
/** A Project cut down to one new worktree and its Chats, without messages: what a phone needs from worktree:create. */
function forNewWorktree(project, worktreeId) {
  const state = project.state;
  const worktree = state.worktrees?.[worktreeId];
  const sessions = Object.fromEntries(Object.entries(state.sessions ?? {}).filter(([, session]) => session.worktree_id === worktreeId));
  return { ...project, state: { ...state, worktrees: worktree ? { [worktreeId]: worktree } : {}, sessions, messages: [] } };
}
/** A drawer-only projection. Empty message bodies are metadata, never a readable transcript. */
function forChatList(project, runs) {
  const byChat = new Map();
  for (const message of project.state.messages) {
    let row = byChat.get(message.session_id);
    if (!row) {
      row = { first: message };
      byChat.set(message.session_id, row);
    }
    row.last = message;
    if (message.role !== "assistant") {
      row.lastInput = message;
    }
  }
  const sessions = Object.fromEntries(
    Object.entries(project.state.sessions).map(([id, session]) => {
      const { subagents, ...metadata } = session;
      return [id, metadata];
    }),
  );
  // Keep listing/order and failure metadata, plus every input identity: an acknowledgement may still
  // be outstanding when another user or linked Chat sends a later message. Preserve source order.
  const boundaries = new Set([...byChat.values()].flatMap((row) => [row.first, row.lastInput, row.last]));
  const messages = project.state.messages
    .filter((message) => message.clientMessageId || boundaries.has(message))
    .map(({ id, session_id, role, outcome, clientMessageId }) => ({ id, session_id, role, outcome, clientMessageId, body: "", context: null }));
  const marks = Object.fromEntries(
    Object.entries(runs.runs || {}).map(([key, run]) => [
      key,
      {
        model: run.model,
        startedAt: run.startedAt,
        approvals: run.approvals,
        questions: run.questions,
        answered: {},
        text: "",
        steps: [],
      },
    ]),
  );
  return {
    previewOnly: true,
    project: { ...project, pullRequestRefs: projectPullRequestRefs(project), state: { ...project.state, sessions, messages, tasks: {} } },
    runs: { ...runs, runs: marks },
  };
}

// Steps at the end of a streaming turn, and any still running, keep this much of the end of their output.
const LIVE_STEPS = 3;
const LIVE_DETAIL = 4096;

/**
 * The turns streaming now, as the phone fetches them on every live "runs" signal. A turn that has run for a while holds
 * hundreds of steps of tool output (one measured 290 steps, 600 KB), so like forPhone this drops each step's `detail`
 * and sets `hasDetail`. What the phone watches live is kept: the end of the output of the last few steps and of any
 * running one, clipped to its tail since output grows at the end, and the latest thinking step whole, which a reply
 * shows in place of an answer. Text, approvals, questions and the rest of each run are unchanged.
 */
function runsForPhone(runs) {
  if (!runs?.runs) return runs;
  const slimSteps = (steps) => {
    const thought = steps.findLastIndex((step) => step.kind === "thinking" && step.detail?.trim());
    return steps.map((step, index) => {
      if (!step.detail || index === thought) return step;
      if (index >= steps.length - LIVE_STEPS || step.status === "running") {
        return step.detail.length > LIVE_DETAIL ? { ...step, detail: `…${step.detail.slice(-LIVE_DETAIL)}` } : step;
      }
      return { ...step, detail: undefined, hasDetail: true };
    });
  };
  return {
    ...runs,
    runs: Object.fromEntries(
      Object.entries(runs.runs).map(([key, run]) => [key, run?.steps?.some((step) => step.detail) ? { ...run, steps: slimSteps(run.steps) } : run]),
    ),
  };
}
const MAX_MEDIA = 15 * MAX_BODY;
const MEDIA_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heic",
};
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
// Decide by content too, so a renamed non-image never leaves the Mac as an image.
function sniffsAs(type, head) {
  if (type === "image/png") return head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg") return head[0] === 255 && head[1] === 216 && head[2] === 255;
  if (type === "image/gif") return /^GIF8[79]a$/.test(head.subarray(0, 6).toString("latin1"));
  if (type === "image/webp") return head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP";
  return head.subarray(4, 8).toString("latin1") === "ftyp" && HEIC_BRANDS.has(head.subarray(8, 12).toString("latin1"));
}
// React Native's WebSocket always sends an Origin (Android derives one from the URL, iOS's SocketRocket too) and only
// lets the app replace it, so the phone sends this one. No web page has it, and a browser cannot set the bearer header
// on a WebSocket anyway.
const LIVE_ORIGIN = "milagre-app://phone";
const MAX_LIVE = 8;
// A turn's events arrive many times a second; one signal per window is enough for the phone to fetch once.
const LIVE_DELAY = { runs: 150, project: 400 };
/** The turns streaming now in one Project's Chats; the daemon holds every Project's. */
const projectRuns = ({ runs, seq }, projectPath) => ({
  runs: Object.fromEntries(Object.entries(runs ?? {}).filter(([key]) => chatInProject(projectPath, key))),
  seq,
});
const realOrNull = async (file) => {
  try {
    return await fs.realpath(file);
  } catch {
    return null;
  }
};
const failure = (status, message) => Object.assign(new Error(message), { status });
const ATTACHMENT_QUOTA = 200 * 1024 * 1024;
/** Bytes of regular files under `folder`, symlinks not followed; 0 when it does not exist yet. */
async function folderBytes(folder) {
  let entries;
  try {
    entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  let total = 0;
  for (const entry of entries) if (entry.isFile()) total += (await fs.lstat(path.join(entry.parentPath, entry.name))).size;
  return total;
}

// A native-client bridge behind loopback or an explicitly configured TLS proxy. All state stays in the Unix-socket
// daemon; closing this listener must never stop that runtime or its turns.
// `allowedRoot` (the review demo sets it): every path a request names must resolve inside that folder, or it is a 403.
// Confined, the phone's uploads may take up `attachmentQuota` bytes in all; past that /attachments answers 507.
async function startMobileBridge({
  dataDir,
  port = 8787,
  token,
  compressAbove = 1024,
  pingMs = 25000,
  allowedRoot,
  attachmentQuota = ATTACHMENT_QUOTA,
  phoneRoutes,
}) {
  if (!/^[a-f0-9]{64}$/.test(token ?? "")) throw new Error("Bridge token must be 32 random bytes encoded as hex");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid bridge port");
  const confine = allowedRoot === undefined ? null : createConfinement({ allowedRoot, uploadsDir: path.join(dataDir, "mobile-attachments") });
  if (!Number.isSafeInteger(attachmentQuota) || attachmentQuota < 0) throw new Error("Invalid attachment quota");
  await confine?.root();
  // Confined, the paths handed back must be canonical, or the phone could not attach what it uploaded.
  const uploads = path.join(confine ? await fs.realpath(dataDir) : dataDir, "mobile-attachments");
  // Confined: the bytes already uploaded, read once, then counted as uploads land. Uploads take turns, so two at once
  // cannot both fit in the room that is left for one.
  let uploadedBytes = null;
  let uploadTurn = Promise.resolve();
  const expected = Buffer.from(`Bearer ${token}`);
  const client = await connect({ dataDir });
  // The bridge only needs to know a state changed, so it takes patches: the host then encodes no whole state for it.
  await client.call("daemon:state-patches").catch(() => {});
  const validScope = (owner) => typeof owner === "string" && (isLinkScopeKey(owner) || path.isAbsolute(owner));
  // The Projects phones opened lately, kept current from the host's state patches (and subagent updates, which carry
  // none), so a phone's snapshot doesn't read and parse the whole state from the host each time. A missed patch drops
  // the Project, and the next snapshot reads it again.
  const HELD_PROJECTS = 4;
  const heldProjects = new Map();
  async function heldProject(owner) {
    let held = heldProjects.get(owner);
    if (!held) {
      const { state, version, epoch, ...rest } = await client.call("state:read", [owner]);
      held = { epoch, version, project: { ...rest, state } };
      heldProjects.set(owner, held);
      if (heldProjects.size > HELD_PROJECTS) heldProjects.delete(heldProjects.keys().next().value);
    } else {
      heldProjects.delete(owner);
      heldProjects.set(owner, held);
    }
    return held.project;
  }
  function followState(channel, payload) {
    const owner =
      channel === "project:state" ? payload?.path : channel === "agent:event" && typeof payload?.chatId === "string" ? projectOfKey(payload.chatId) : null;
    const held = typeof owner === "string" ? heldProjects.get(owner) : undefined;
    if (!held) return;
    const state = held.project.state;
    if (typeof payload.version === "number") {
      if (payload.resync || payload.epoch !== held.epoch || payload.base !== held.version) heldProjects.delete(owner);
      else Object.assign(held, { version: payload.version, project: { ...held.project, state: applyStatePatch(state, payload.patch) } });
    } else if (payload.state) heldProjects.delete(owner);
    else if (payload.event?.type === "subagent-update")
      held.project = { ...held.project, state: applyAgentEvent(state, {}, owner, payload.chatId, payload.event).state };
  }
  // The last snapshots sent for each Project, by number, so the next one can go as a patch on the one a phone holds
  // (X-Milagre-Snapshot-Since: "<epoch>:<number>", or "none"). The numbers start again with each bridge.
  const SNAPSHOT_HISTORY = 8;
  const snapshotEpoch = randomUUID();
  const sentSnapshots = new Map();
  function numberSnapshot(owner, result, since) {
    let sent = sentSnapshots.get(owner);
    if (!sent) sentSnapshots.set(owner, (sent = { last: 0, versions: new Map() }));
    const version = ++sent.last;
    sent.versions.set(version, result);
    if (sent.versions.size > SNAPSHOT_HISTORY) sent.versions.delete(sent.versions.keys().next().value);
    const [epoch, held] = since.split(":");
    const base = epoch === snapshotEpoch ? sent.versions.get(Number(held)) : undefined;
    if (base) {
      const patch = diffState(base, result, 6);
      // A patch that rewrites most of it (a reconnect after many changes) is no smaller than the snapshot.
      if (JSON.stringify(patch ?? null).length < 64 * 1024 || JSON.stringify(patch).length < JSON.stringify(result).length / 2)
        return { epoch: snapshotEpoch, version, base: Number(held), patch };
    }
    return { epoch: snapshotEpoch, version, snapshot: result };
  }
  async function readScope(owner) {
    await confine?.check(owner);
    if (!validScope(owner)) throw failure(400, "Choose a valid Project or Link");
    if (!isLinkScopeKey(owner)) return { project: await heldProject(owner) };
    const id = scopeFromKey(owner).linkId;
    const [link, projects] = await Promise.all([client.call("link:snapshot", [id]), client.call("project:registry")]);
    return {
      link: {
        ...link,
        projects: link.link.projectIds.map((id) => projects.find((project) => project.id === id) ?? { id, path: "", name: "Unavailable Project" }),
      },
    };
  }
  async function scopeRoots(owner) {
    if (!isLinkScopeKey(owner)) return client.call("project:worktree-paths", [owner]);
    const { link } = await readScope(owner);
    return [
      path.join(dataDir, "links", link.link.id, ".milagre", "images"),
      ...Object.values(link.state.sessions).flatMap((chat) => [chat.workspacePath, ...chat.worktrees.map((member) => member.worktreePath)]),
    ];
  }
  let active = 0;
  let closed;
  let url;
  // Every route, the live socket included, checks the token, a loopback Host and no web Origin before anything else.
  function admit(req, allowedOrigin) {
    const received = Buffer.from(req.headers.authorization ?? "");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw failure(401, "Connection token is missing or incorrect");
    const address = new URL(url);
    // Android's emulator maps 10.0.2.2 to this host's loopback interface.
    if ((req.headers.origin && req.headers.origin !== allowedOrigin) || ![address.host, `10.0.2.2:${address.port}`].includes(req.headers.host))
      throw failure(403, "Only a native localhost client is supported");
    if (closed) throw failure(503, "Bridge is closing");
  }
  // Live sockets carry no state, only "fetch again" signals, so the phone stops polling a Project that is not changing.
  const live = new Set();
  const wss = new WebSocketServer({ noServer: true, clientTracking: false, perMessageDeflate: false, maxPayload: 4096 });
  function signal(entry, type, delay = LIVE_DELAY[type]) {
    entry.kinds.add(type);
    // Later events join the pending signal instead of pushing it back, so a busy turn still signals every window.
    const due = Date.now() + delay;
    if (entry.timer && entry.due <= due) return;
    clearTimeout(entry.timer);
    entry.due = due;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      // A snapshot carries the runs too, so "project" covers "runs".
      const types = [];
      if (entry.kinds.has("accounts")) types.push("accounts");
      if (entry.kinds.has("project")) types.push("project");
      else if (entry.kinds.has("runs")) types.push("runs");
      entry.kinds.clear();
      if (entry.socket.readyState === WebSocket.OPEN) for (const type of types) entry.socket.send(JSON.stringify({ type }));
    }, delay);
  }
  function drop(entry) {
    live.delete(entry);
    clearTimeout(entry.timer);
    clearInterval(entry.heartbeat);
  }
  function accept(socket, projectPath) {
    if (closed) {
      socket.close(1001, "Mobile host stopped");
      return;
    }
    // The newest socket is the one someone is looking at; the oldest is likely a phone that changed networks.
    if (live.size >= MAX_LIVE) {
      const [oldest] = live;
      drop(oldest);
      oldest.socket.close(1013, "Too many live connections");
    }
    const entry = { socket, projectPath, kinds: new Set(), timer: null, due: 0, alive: true };
    // A ping finds sockets whose phone vanished (the server ends them); the JSON one lets the phone notice a dead
    // socket too, as React Native does not show protocol pings.
    entry.heartbeat = setInterval(() => {
      if (!entry.alive) {
        drop(entry);
        socket.terminate();
        return;
      }
      entry.alive = false;
      socket.ping();
      socket.send(JSON.stringify({ type: "ping" }));
    }, pingMs);
    socket.on("pong", () => {
      entry.alive = true;
    });
    socket.on("error", () => {});
    socket.on("close", () => drop(entry));
    live.add(entry);
  }
  client.on("event", ({ channel, payload } = {}) => {
    followState(channel, payload);
    for (const entry of live) {
      if (channel === "accounts:changed" && !confine) signal(entry, "accounts", 0);
      if (
        (channel === "project:state" && payload?.path === entry.projectPath) ||
        (channel === "link:state" && isLinkScopeKey(entry.projectPath) && payload?.linkId === scopeFromKey(entry.projectPath).linkId)
      )
        signal(entry, "project");
      else if (channel === "agent:event" && typeof payload?.chatId === "string" && chatInProject(entry.projectPath, payload.chatId)) {
        // A turn's end (or a steer) saves its reply as the run goes away: one prompt snapshot shows both, where a runs
        // fetch first would hide the reply until the Project caught up. Subagents live only in the Project state.
        // The state can come whole, as a patch (version), or left out (stateTooLarge); the turn's end needs the snapshot.
        if (payload.state || payload.stateTooLarge || typeof payload.version === "number") signal(entry, "project", LIVE_DELAY.runs);
        else signal(entry, payload.event?.type === "subagent-update" ? "project" : "runs");
      }
    }
  });
  // Images the paired app may show: the Project's Worktrees, its persisted attachments (<Project>/.milagre/images),
  // files uploaded from mobile, and the folders where agents save generated images. Everything is checked after
  // realpath, so a symlink cannot lead out.
  async function serveMedia(target, res) {
    const projectPath = target.searchParams.get("projectPath");
    const requested = target.searchParams.get("path");
    if (!validScope(projectPath) || !requested || !path.isAbsolute(requested)) throw failure(400, "Choose a valid Project or Link and absolute image path");
    if (confine) {
      await confine.check(projectPath);
      await confine.check(requested, { uploads: true });
    }
    const type = MEDIA_TYPES[path.extname(requested).toLowerCase()];
    if (!type) throw failure(415, "Only png, jpeg, gif, webp and heic images are served");
    // Only the worktree folders: a big Project's whole state would be read in pages for every image.
    const worktreePaths = await scopeRoots(projectPath);
    const candidates = [
      ...(Array.isArray(worktreePaths) ? worktreePaths : []),
      path.join(projectPath, ".milagre", "images"),
      path.join(dataDir, "mobile-attachments"),
      path.join(os.tmpdir(), "milagre-generated-images"),
      path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "generated_images"),
    ].filter((candidate) => typeof candidate === "string" && path.isAbsolute(candidate));
    const roots = (await Promise.all(candidates.map(realOrNull))).filter(Boolean);
    let real = await realOrNull(requested);
    if (!real || !roots.some((root) => inside(root, real))) {
      // A screenshot in /tmp must be explicitly shared in this Project's assistant reply.
      // The runtime validates that reference and returns a durable Project attachment, never arbitrary bytes.
      const stored = await client.call("project:chat-image", [projectPath, requested]).catch(() => null);
      if (stored) real = await realOrNull(stored);
    }
    if (!real) {
      // Missing files are only reported as missing inside an allowed folder, so paths elsewhere are not probed.
      const lexical = path.resolve(requested);
      throw roots.some((root) => inside(root, lexical)) || candidates.some((root) => inside(path.resolve(root), lexical))
        ? failure(404, "Image not found")
        : failure(403, "This file is not available to the mobile app");
    }
    if (!roots.some((root) => inside(root, real))) throw failure(403, "This file is not available to the mobile app");
    if (MEDIA_TYPES[path.extname(real).toLowerCase()] !== type) throw failure(415, "Only png, jpeg, gif, webp and heic images are served");
    const handle = await fs.open(real, "r").catch((error) => {
      throw failure(error.code === "ENOENT" ? 404 : 403, error.code === "ENOENT" ? "Image not found" : "This file is not available to the mobile app");
    });
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw failure(403, "This file is not available to the mobile app");
      if (info.size > MAX_MEDIA) throw failure(413, "Images must be 15 MiB or smaller");
      const head = Buffer.alloc(12);
      const { bytesRead } = await handle.read(head, 0, 12, 0);
      if (!sniffsAs(type, head.subarray(0, bytesRead))) throw failure(415, "The file is not a supported image");
      res.writeHead(200, { "content-type": type, "content-length": info.size, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" });
      // Bounded by the size checked above, so a file that grows afterwards cannot exceed Content-Length.
      await pipeline(handle.createReadStream({ start: 0, end: Math.max(info.size - 1, 0), autoClose: true }), res);
    } catch (error) {
      await handle.close().catch(() => {});
      if (res.headersSent) {
        res.destroy();
        return;
      }
      throw error;
    }
  }
  const server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 }, (req, res) => {
    // A Project's state runs to megabytes, and a phone polls it every few seconds over cellular: snapshots carry an
    // ETag so an unchanged one costs a 304, and large bodies go out gzipped.
    const reply = (status, value, { etag = false } = {}) => {
      const body = JSON.stringify({ v: 1, ...value });
      const headers = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" };
      if (etag && status === 200) {
        headers.etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
        if (req.headers["if-none-match"] === headers.etag) {
          res.writeHead(304, headers);
          res.end();
          return;
        }
      }
      if (body.length < compressAbove || !/\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
        res.writeHead(status, headers);
        res.end(body);
        return;
      }
      zlib.gzip(body, { level: 6 }, (error, zipped) => {
        if (res.destroyed) return;
        if (error) {
          res.writeHead(status, headers);
          res.end(body);
          return;
        }
        res.writeHead(status, { ...headers, "content-encoding": "gzip", vary: "accept-encoding" });
        res.end(zipped);
      });
    };
    void (async () => {
      admit(req);
      if (active >= 16) throw failure(429, "Too many pending requests");
      active++;
      try {
        const target = new URL(req.url, url);
        let result;
        if (req.method === "GET" && target.pathname === "/media") {
          await serveMedia(target, res);
          return;
        }
        if (req.method === "GET" && target.pathname === "/snapshot") {
          const projectPath = target.searchParams.get("projectPath");
          const [scope, runs] = await Promise.all([readScope(projectPath), client.call("chat:runs")]);
          const slim = scope.link ? { link: forPhone(scope.link) } : { project: forPhone(scope.project) };
          if (!scope.link && target.searchParams.get("view") === "chats") {
            reply(200, { result: forChatList(scope.project, projectRuns(runs, projectPath)) }, { etag: true });
            return;
          }
          const result = { ...slim, runs: runsForPhone(projectRuns(runs, projectPath)) };
          // An app that says what it holds gets the snapshot numbered, and as a patch on that one when it can.
          const since = req.headers["x-milagre-snapshot-since"];
          if (typeof since !== "string") reply(200, { result }, { etag: true });
          else reply(200, { result: numberSnapshot(projectPath, result, since) });
          return;
        }
        // What a live "runs" signal fetches: a few kilobytes, where the snapshot can run to megabytes.
        if (req.method === "GET" && target.pathname === "/runs") {
          const projectPath = target.searchParams.get("projectPath");
          if (!validScope(projectPath)) throw failure(400, "Choose a valid Project or Link");
          await confine?.check(projectPath);
          reply(200, { result: runsForPhone(projectRuns(await client.call("chat:runs"), projectPath)) }, { etag: true });
          return;
        }
        // The chat keys, in every Project, whose turn waits on the user: a few bytes the phone polls for its attention dots.
        // A confined phone only opens its one Project, so it gets none.
        if (req.method === "GET" && target.pathname === "/attention") {
          reply(200, { result: confine ? [] : chatsNeedingAttention((await client.call("chat:runs")).runs) }, { etag: true });
          return;
        }
        if (req.method === "GET" && target.pathname === "/message") {
          // One message with its tool output read back from its sidecar, without encoding the whole state to find it.
          const owner = target.searchParams.get("projectPath");
          await confine?.check(owner);
          if (!validScope(owner)) throw failure(400, "Choose a valid Project or Link");
          let message;
          try {
            message = await client.call("chat:message", [owner, Number(target.searchParams.get("id"))]);
          } catch (error) {
            if (/no longer in this Project/.test(error.message)) throw failure(404, "That message is no longer in this Project.");
            throw error;
          }
          reply(200, { result: message });
          return;
        } else if (req.method === "POST" && ["/rpc", "/attachments"].includes(target.pathname)) {
          if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw failure(415, "Use application/json");
          const limit = target.pathname === "/attachments" ? 7 * MAX_BODY : MAX_BODY;
          if (Number(req.headers["content-length"]) > limit) throw failure(413, "Request exceeds the upload limit");
          let size = 0;
          const chunks = [];
          // Reading through data events lets us return 413 without destroying the socket.
          const body = await new Promise((resolve, reject) => {
            req.on("data", (chunk) => {
              size += chunk.length;
              if (size > limit) {
                reject(failure(413, "Request exceeds the upload limit"));
                return;
              }
              chunks.push(chunk);
            });
            req.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            req.once("error", reject);
            req.once("aborted", () => reject(failure(400, "Request was interrupted")));
          });
          let request;
          try {
            request = JSON.parse(body);
          } catch {
            throw failure(400, "Invalid JSON");
          }
          if (target.pathname === "/attachments") {
            const { projectPath, name, base64 } = request || {};
            if (typeof projectPath !== "string" || typeof name !== "string" || typeof base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
              throw failure(400, "Invalid attachment");
            const bytes = Buffer.from(base64, "base64");
            if (bytes.length > 5 * MAX_BODY) throw failure(413, "Each file must be 5 MiB or smaller");
            if (!bytes.length || bytes.toString("base64") !== base64) throw failure(400, "Invalid attachment data");
            await confine?.check(projectPath);
            await scopeRoots(projectPath);
            const folder = path.join(uploads, randomUUID());
            const filename = path
              .basename(name.replaceAll("\\", "/"))
              // oxlint-disable-next-line no-control-regex -- strips control characters from an uploaded file name
              .replace(/[\x00-\x1f\x7f]/g, "_")
              .slice(0, 180);
            if (!filename || filename === "." || filename === "..") throw failure(400, "Choose a file with a name");
            const save = async () => {
              if (confine) {
                uploadedBytes ??= await folderBytes(uploads);
                if (uploadedBytes + bytes.length > attachmentQuota) throw failure(507, "This demo computer is full.");
              }
              await fs.mkdir(folder, { recursive: true, mode: 0o700 });
              const destination = path.join(folder, filename);
              try {
                await fs.writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
              } catch (error) {
                await fs.rm(folder, { recursive: true, force: true });
                throw error;
              }
              if (confine) uploadedBytes += bytes.length;
              return { path: destination, name: filename };
            };
            if (confine) {
              const turn = uploadTurn.then(save);
              uploadTurn = turn.catch(() => {});
              result = await turn;
            } else result = await save();
          } else {
            if (request?.v !== 1 || typeof request.method !== "string" || !Array.isArray(request.args))
              throw failure(400, "Expected version 1, method and args array");
            if (request.method === "phone:routes") {
              // Answered by the phone setting that runs this bridge, not by the daemon. A confined demo has no LAN to offer.
              if (!phoneRoutes || confine) throw failure(403, "Command is not available from mobile");
              result = await phoneRoutes(request.args[0]?.phoneKey);
            } else {
              if (!METHODS.has(request.method)) throw failure(403, "Command is not available from mobile");
              if (confine) {
                const decided = await confine.checkCall(request.method, request.args);
                result = "result" in decided ? decided.result : await confine.filterResult(request.method, await client.call(request.method, decided.args));
              } else result = await client.call(request.method, request.args);
            }
            // The phone reads a Project through /snapshot right after opening it; the opened state would double the download.
            if (request.method === "project:open" && result && typeof result === "object") result = { path: result.path, name: result.name };
            if (request.method === "link:open" && result?.link) result = { id: result.link.id, name: result.link.name };
            // The phone only looks up the new worktree's Chat; a large Project's whole state is tens of MB, past what a LAN socket buffers.
            if (request.method === "worktree:create" && result?.project?.state)
              result = { ...result, project: forNewWorktree(result.project, result.worktreeId) };
            // A Project's icon can be a full-size app icon; past this size the phone keeps its folder glyph.
            if (
              (request.method === "project:image" || request.method === "project:set-icon") &&
              typeof result === "string" &&
              result.length > MAX_PROJECT_IMAGE
            )
              result = null;
          }
        } else throw failure(404, "Unknown endpoint");
        reply(200, { result: result ?? null });
      } finally {
        active--;
      }
    })().catch((error) => {
      if (!res.headersSent && !res.destroyed) reply(error.status ?? 409, { error: { message: error.message } });
    });
  });
  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => {});
    let projectPath;
    const refuse = (error) => {
      const status = error.status ?? 400;
      const body = JSON.stringify({ v: 1, error: { message: error.message } });
      socket.end(
        `HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`,
      );
    };
    try {
      admit(req, LIVE_ORIGIN);
      const target = new URL(req.url, url);
      if (target.pathname !== "/live") throw failure(404, "Unknown endpoint");
      projectPath = target.searchParams.get("projectPath");
      if (!validScope(projectPath)) throw failure(400, "Choose a valid Project or Link");
    } catch (error) {
      refuse(error);
      return;
    }
    if (!confine) {
      wss.handleUpgrade(req, socket, head, (ws) => accept(ws, projectPath));
      return;
    }
    confine
      .check(projectPath)
      .then(() => {
        if (closed) throw failure(503, "Bridge is closing");
        wss.handleUpgrade(req, socket, head, (ws) => accept(ws, projectPath));
      })
      .catch(refuse);
  });
  async function close() {
    closed ??= new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
      // Upgraded sockets are no longer the HTTP server's to close; one that ignores the close frame is cut after a second.
      const sockets = [...live].map((entry) => {
        drop(entry);
        entry.socket.close(1001, "Mobile host stopped");
        return entry.socket;
      });
      if (sockets.length) setTimeout(() => sockets.forEach((socket) => socket.terminate()), 1000).unref();
      client.close();
    });
    return closed;
  }
  // The daemon connection dropping (daemon restarted or stopped) ends this bridge; `lost` tells the owner to restart it.
  let lostConnection;
  const lost = new Promise((resolve) => {
    lostConnection = resolve;
  });
  client.once("close", () => {
    lostConnection();
    void close();
  });
  try {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    url = `http://127.0.0.1:${server.address().port}`;
  } catch (error) {
    await close();
    throw error;
  }
  return { url, close, lost };
}
module.exports = { startMobileBridge, forPhone, forChatList, runsForPhone, METHODS };
