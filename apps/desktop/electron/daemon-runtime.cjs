const { ensureDaemon, compatibleClient } = require('@milagre/daemon/bootstrap');
const { projectOfKey } = require('@milagre/shared/agent-runs');

async function connectDesktopRuntime(options) {
  const { emit = () => {}, dataDir, reconnectMs = 1000 } = options;
  /** @type {import('@milagre/daemon/bootstrap').DaemonClient | null} */
  let client = await ensureDaemon(options);
  const status = await client.call('daemon:status');
  let closed = false;
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

  // The host leaves a project state too large for one frame out of an event (`stateTooLarge`). It is read in pages
  // and put back before the window sees the event, so a turn's end and its saved reply still arrive together. Events
  // behind it wait, in order. A reconnect drops what is waiting: its snapshot holds every state.
  let held = null;
  let heldFor = null;
  function deliver(connection, event) {
    if (held && heldFor === connection) { held.push(event); return; }
    if (!event.payload?.stateTooLarge) { forward(event); return; }
    held = [event];
    heldFor = connection;
    void releaseHeld(connection);
  }
  async function releaseHeld(connection) {
    while (heldFor === connection && held.length) {
      const event = held.shift();
      const ready = event.payload?.stateTooLarge ? await withState(connection, event) : event;
      if (heldFor !== connection || client !== connection || closed) return;
      if (ready) forward(ready);
    }
    if (heldFor === connection) { held = null; heldFor = null; }
  }
  async function withState(connection, { channel, payload, seq }) {
    const { stateTooLarge: _left, ...rest } = payload;
    const projectPath = channel === 'project:state' ? payload.path : projectOfKey(payload.chatId);
    try {
      const project = /** @type {{ state: unknown }} */ (await connection.call('project:snapshot', [projectPath]));
      return { channel, payload: { ...rest, state: project.state }, seq };
    } catch {
      // The window keeps the state it has; the event still moves the turn on screen.
      return channel === 'project:state' ? null : { channel, payload: rest, seq };
    }
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
      if (closed) return;
      emit('runtime:connection', { connected: false, message: 'Connection to the host was interrupted. Reconnecting…' });
      if (!recovering) scheduleReconnect();
    });
  }
  function scheduleReconnect() {
    if (closed || timer) return;
    timer = setTimeout(() => { timer = null; void reconnect(); }, reconnectMs);
  }
  async function reconnect() {
    let connection;
    try {
      // A reconnect never starts or stops a daemon. An explicit host stop must
      // stay stopped; the next desktop launch can start it again.
      connection = await compatibleClient(dataDir);
      if (closed) { connection.close(); return; }
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
      emit('runtime:connection', { connected: true });
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
    methods: status.methods,
    environmentReady: Promise.resolve(),
    invoke,
    openProject: projectPath => invoke('project:open', [projectPath]),
    resumeRecentProjects: async () => {}, // The daemon resumes once, before it announces startup.
    focused: () => invoke('daemon:focus', [{ focused: true }]),
    setFocused(value) { focused = value === true; return invoke('daemon:focus', [{ focused }]); },
    async close({ stopHost = false } = {}) {
      if (closed) return;
      if (stopHost) {
        if (!client || recovering) throw new Error('Reconnect to the host before installing an update.');
        const connection = client;
        // A stop acknowledgement follows saving. Socket closure also confirms
        // host shutdown before the installer can replace its files.
        let deadline;
        let onClose;
        const stopped = new Promise((resolve, reject) => {
          onClose = resolve;
          connection.once('close', onClose);
          deadline = setTimeout(() => reject(new Error('The host has not stopped. The update was not installed.')), 30000);
        });
        try { await Promise.all([connection.call('daemon:stop'), stopped]); }
        finally { clearTimeout(deadline); if (onClose) connection.off('close', onClose); }
      } else if (client && !recovering) await client.call('daemon:flush');
      closed = true;
      clearTimeout(timer);
      client?.close();
    },
  };
}
module.exports = { connectDesktopRuntime };
