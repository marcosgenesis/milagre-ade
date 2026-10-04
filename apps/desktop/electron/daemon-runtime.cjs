const { ensureDaemon, compatibleClient } = require('@milagre/daemon/bootstrap');
const { projectOfKey } = require('@milagre/shared/agent-runs');

// A host from before result pages still works; it only fails on very large Projects, as it always did. The window
// offers to restart it (see restartHost).
const RESULT_PAGES = 'result-pages-v1';
const OUTDATED_HOST = "Restart Milagre's background host to load large projects.";
// Events waiting behind one Project's state read. Past this the connection is dropped, and the reconnect re-reads every state.
const MAX_HELD = 10_000;

// The Project an event belongs to, when it names one.
function projectOfEvent({ channel, payload }) {
  if (!payload || typeof payload !== 'object') return null;
  if (channel === 'project:state') return typeof payload.path === 'string' ? payload.path : null;
  if (typeof payload.chatId === 'string') return projectOfKey(payload.chatId);
  return typeof payload.projectPath === 'string' ? payload.projectPath : null;
}
const carriesState = payload => Boolean(payload && typeof payload === 'object' && (payload.stateTooLarge || (payload.state && typeof payload.state === 'object')));

async function connectDesktopRuntime(options) {
  const { emit = () => {}, dataDir, reconnectMs = 1000 } = options;
  /** @type {import('@milagre/daemon/bootstrap').DaemonClient | null} */
  let client = await ensureDaemon(options);
  const status = client.status ?? await client.call('daemon:status');
  const methods = [...status.methods];
  let hostOutdated = !status.capabilities?.includes(RESULT_PAGES);
  let closed = false;
  let restarting = false;
  let timer;
  let currentProject = null;
  let currentChat = null;
  let focused = false;
  let recovering = false;
  let capturingSnapshot = false;
  let buffered = [];
  let bufferedBytes = 0;
  const projects = new Set();

  function forward({ channel, payload }) { emit(channel, payload); }
  const connectedState = () => (hostOutdated ? { connected: true, hostOutdated: true, message: OUTDATED_HOST } : { connected: true });
  function adopt(next) {
    for (const method of next.methods ?? []) if (!methods.includes(method)) methods.push(method);
    hostOutdated = !next.capabilities?.includes(RESULT_PAGES);
  }

  // The host leaves a state over a quarter of a frame out of an event (`stateTooLarge`). It is read in pages and put
  // back before the window sees the event, so a turn's end and its saved reply still arrive together. Each Project
  // waits on its own: other Projects' events, and other chats' streaming, keep flowing. Everything waiting when a read
  // starts was sent before it, so one read answers them all: a burst of state events costs one read, and only the last
  // project:state of a burst is passed on. A reconnect drops what is waiting: its snapshot holds every state.
  const holds = new Map();
  function deliver(connection, event) {
    const project = projectOfEvent(event);
    const hold = project ? holds.get(project) : undefined;
    if (hold && hold.connection === connection) {
      const chatId = event.payload?.chatId;
      const sameChat = typeof chatId === 'string' && hold.queue.some(item => item.payload?.chatId === chatId);
      if (!carriesState(event.payload) && !sameChat) { forward(event); return; }
      if (hold.queue.length >= MAX_HELD) { connection.close(); return; }
      hold.queue.push(event);
      return;
    }
    if (!project || !event.payload?.stateTooLarge) { forward(event); return; }
    const created = { connection, queue: [event] };
    holds.set(project, created);
    // Events that arrived in the same read from the socket join the first state read.
    setImmediate(() => void release(project, created));
  }
  async function release(project, hold) {
    const live = () => holds.get(project) === hold && client === hold.connection && !closed;
    while (live() && hold.queue.length) {
      if (!carriesState(hold.queue[0].payload)) { forward(hold.queue.shift()); continue; }
      const batch = hold.queue.splice(0);
      let state;
      let read = true;
      try { state = /** @type {{ state: unknown }} */ (await hold.connection.call('project:snapshot', [project])).state; }
      catch { read = false; }
      if (!live()) return;
      const last = batch.findLastIndex(item => item.channel === 'project:state');
      batch.forEach((item, index) => {
        if (!carriesState(item.payload)) { forward(item); return; }
        const { stateTooLarge, state: _own, ...rest } = item.payload;
        // A failed read keeps the window's state; the event still moves the turn on screen.
        if (!read) { if (!stateTooLarge) forward(item); else if (item.channel !== 'project:state') forward({ ...item, payload: rest }); return; }
        if (item.channel === 'project:state' && index !== last) return;
        forward({ ...item, payload: { ...rest, state } });
      });
    }
    if (holds.get(project) === hold) holds.delete(project);
  }

  function attach(connection) {
    connection.on('event', event => {
      if (client !== connection || closed) return;
      if (!recovering) { deliver(connection, event); return; }
      if (!capturingSnapshot) return; // The later snapshot covers restoration events.
      bufferedBytes += Buffer.byteLength(JSON.stringify(event));
      // Recovery re-reads state instead of retaining an unbounded event stream.
      if (buffered.length >= 1024 || bufferedBytes > 16 * 1024 * 1024) {
        connection.close();
        return;
      }
      buffered.push(event);
    });
    connection.once('close', () => {
      if (client !== connection) return;
      client = null;
      if (closed || restarting) return;
      emit('runtime:connection', { connected: false, message: 'Connection to the host was interrupted. Reconnecting…' });
      if (!recovering) scheduleReconnect();
    });
  }
  function scheduleReconnect() {
    if (closed || timer) return;
    timer = setTimeout(() => { timer = null; void reconnect(); }, reconnectMs);
  }
  // A reconnect never starts or stops a daemon: an explicit host stop must stay stopped, and the next desktop launch
  // can start it again. Only restartHost passes `open` to start the new one.
  async function reconnect(open = () => compatibleClient(dataDir)) {
    let connection;
    try {
      connection = await open();
      if (closed) { connection.close(); return; }
      adopt(connection.status ?? await connection.call('daemon:status'));
      client = connection;
      recovering = true; capturingSnapshot = false; buffered = []; bufferedBytes = 0;
      attach(connection);
      for (const projectPath of projects) {
        try { await connection.call('project:open', [projectPath]); }
        catch (error) {
          // A Project removed while the host was offline must not prevent the
          // remaining Projects, or the folder picker, from becoming usable.
          if (!(error instanceof Error) || !('code' in error) || !['ENOENT', 'ENOTDIR'].includes(String(error.code))) throw error;
          projects.delete(projectPath);
          if (currentProject === projectPath) { currentProject = null; currentChat = null; }
        }
      }
      if (currentProject) await connection.call('project:open', [currentProject]);
      await connection.call('chat:set-open', [currentChat]);
      await connection.call('daemon:focus', [{ focused }]);
      capturingSnapshot = true;
      const manifest = await connection.call('daemon:snapshot', [{ paged: true }]);
      const pages = [];
      for (let index = 0; index < manifest.pageCount; index++) {
        pages.push(await connection.call('daemon:snapshot-page', [manifest.snapshotId, index]));
      }
      const snapshot = JSON.parse(pages.join(''));
      emit('runtime:snapshot', snapshot);
      for (const event of buffered) if (event.seq > snapshot.eventSeq) deliver(connection, event);
      buffered = []; recovering = false;
      emit('runtime:connection', connectedState());
    } catch (error) {
      recovering = false; buffered = [];
      if (client === connection) client = null;
      connection?.close();
      if (!closed) {
        emit('runtime:connection', { connected: false, message: `Host unavailable: ${error instanceof Error ? error.message : String(error)}` });
        scheduleReconnect();
      }
    }
  }
  attach(client);
  if (hostOutdated) emit('runtime:connection', connectedState());

  // Stops the host the way an update does (it saves and suspends running turns), then waits for the socket to close.
  async function stopHost(connection, message) {
    let deadline;
    let onClose;
    const stopped = new Promise((resolve, reject) => {
      onClose = resolve;
      connection.once('close', onClose);
      deadline = setTimeout(() => reject(new Error(message)), 30000);
    });
    try { await Promise.all([connection.call('daemon:stop'), stopped]); }
    finally { clearTimeout(deadline); if (onClose) connection.off('close', onClose); }
  }

  async function invoke(method, args = []) {
    if (closed || !client || recovering) throw new Error('Milagre host is disconnected. Your command was not sent.');
    const result = await client.call(method, args);
    if (['project:open', 'project:current', 'project:switch'].includes(method) && result && typeof result === 'object' && 'path' in result && typeof result.path === 'string') {
      currentProject = result.path; projects.add(result.path);
    }
    if (method === 'chat:set-open') currentChat = args[0] ?? null;
    return result;
  }
  return {
    /** The host's commands; restartHost can add the newer host's. */
    methods,
    environmentReady: Promise.resolve(),
    invoke,
    openProject: projectPath => invoke('project:open', [projectPath]),
    resumeRecentProjects: async () => {}, // The daemon resumes once, before it announces startup.
    focused: () => invoke('daemon:focus', [{ focused: true }]),
    setFocused(value) { focused = value === true; return invoke('daemon:focus', [{ focused }]); },
    /** Replaces a running host with this desktop's own (an older one can't load large Projects). The window reconnects to it. */
    async restartHost() {
      if (closed || restarting) return;
      if (!client || recovering) throw new Error('Reconnect to the host before restarting it.');
      const connection = client;
      restarting = true;
      try {
        emit('runtime:connection', { connected: false, message: 'Restarting the background host…' });
        await stopHost(connection, 'The background host has not stopped. Try again.');
        clearTimeout(timer); timer = null;
        await reconnect(() => ensureDaemon(options));
      } catch (error) {
        if (client === connection) emit('runtime:connection', connectedState());
        throw error;
      } finally { restarting = false; }
    },
    async close({ stopHost: stop = false } = {}) {
      if (closed) return;
      if (stop) {
        if (!client || recovering) throw new Error('Reconnect to the host before installing an update.');
        // A stop acknowledgement follows saving. Socket closure also confirms
        // host shutdown before the installer can replace its files.
        await stopHost(client, 'The host has not stopped. The update was not installed.');
      } else if (client && !recovering) await client.call('daemon:flush');
      closed = true;
      clearTimeout(timer);
      client?.close();
    },
  };
}
module.exports = { connectDesktopRuntime };
