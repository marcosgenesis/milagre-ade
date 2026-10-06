import { SIMULATOR_RECEIVER_SCRIPT } from './simulator-browser.mjs';
export { SIMULATOR_RECEIVER_SCRIPT } from './simulator-browser.mjs';

/** Geometry follows Device Hub's raw portrait capture orientation, including already-rotated buffers. */
export function simulatorGeometry(status, box) {
  if (!status || status.width <= 0 || status.height <= 0 || box.width <= 0 || box.height <= 0) return null;
  const degrees = { 'landscape-left': 90, 'landscape-right': -90, 'portrait-upside-down': 180 }[status.orientation] || 0;
  const rotation = Math.abs(degrees) === 90 && status.width > status.height ? 0 : degrees;
  const sideways = Math.abs(rotation) === 90;
  const width = sideways ? status.height : status.width;
  const height = sideways ? status.width : status.height;
  const scale = Math.min(box.width / width, box.height / height);
  return { left: (box.width - width * scale) / 2, top: (box.height - height * scale) / 2, width: width * scale, height: height * scale, rawWidth: status.width * scale, rawHeight: status.height * scale, rotation };
}

/** Coordinates are relative to the stage; outside starts are ignored, captured drags clamp at the edge. */
export function simulatorPoint(point, geometry, clamp = false) {
  if (!geometry) return null;
  let x = (point.x - geometry.left) / geometry.width, y = (point.y - geometry.top) / geometry.height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || (!clamp && (x < 0 || x > 1 || y < 0 || y > 1))) return null;
  x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
  switch (geometry.rotation) {
    case 90: return { x: y, y: 1 - x };
    case -90: return { x: 1 - y, y: x };
    case 180: return { x: 1 - x, y: 1 - y };
    default: return { x, y };
  }
}

/** One RPC at a time. Replace only consecutive moves, never a gesture boundary. Overflow ends the session. */
export function createSimulatorInputQueue(send, failed, limit = 32) {
  let queue = [], sending = false, disposed = false;
  const drain = async () => {
    if (sending || disposed) return;
    sending = true;
    try { while (queue.length && !disposed) await send(queue.shift()); }
    catch (error) { if (!disposed) { disposed = true; queue = []; failed(error); } }
    finally { sending = false; }
  };
  return {
    push(event) {
      if (disposed) return;
      const previous = queue[queue.length - 1];
      if (event.kind === 'touch' && event.phase === 'move' && previous?.kind === 'touch' && previous.phase === 'move' && previous.points.length === event.points.length) queue[queue.length - 1] = event;
      else if (queue.length >= limit) { disposed = true; queue = []; failed(new Error('Connection is too slow for input. Retry the simulator.')); return; }
      else queue.push(event);
      void drain();
    },
    dispose() { disposed = true; queue = []; },
  };
}

/** The wrapper is capability-scoped too: a receiver cannot address another viewer or call arbitrary RPC. */
export function createSimulatorBridge(call, respond) {
  const viewers = new Set();
  const openings = new Map();
  let disposed = false;
  const close = viewerId => Promise.resolve().then(() => call('close', { viewerId })).catch(() => {});
  return {
    async receive(message) {
      if (disposed || !message || message.channel !== 'milagre-simulator' || !Number.isSafeInteger(message.id)) return;
      const { id, method, args } = message;
      if (message.event === 'cancel') {
        const opening = openings.get(id);
        if (opening) {
          opening.cancelled = true;
          if (opening.viewerId) { viewers.delete(opening.viewerId); await close(opening.viewerId); openings.delete(id); }
        }
        return;
      }
      const reply = value => { if (!disposed) respond({ channel: 'milagre-simulator', id, ...value }); };
      try {
        if (!['open', 'offer', 'status', 'control', 'input', 'close'].includes(method)) throw new Error('Unknown simulator command.');
        if (!args || typeof args !== 'object') throw new Error('Invalid simulator request.');
        if (method === 'open') {
          if ([...openings.values()].some(value => !value.cancelled) || viewers.size) throw new Error('Close the current viewer before opening another.');
          const opening = { cancelled: false, viewerId: null };
          openings.set(id, opening);
          let result;
          try { result = await call(method, args); } catch (error) { openings.delete(id); throw error; }
          if (disposed || opening.cancelled) { if (result?.viewerId) await close(result.viewerId); openings.delete(id); return; }
          opening.viewerId = result.viewerId;
          viewers.add(result.viewerId); reply({ result });
        } else {
          if (!viewers.has(args.viewerId)) throw new Error('This simulator viewer is closed.');
          // Keep ownership until close finishes, so disposal can still close an in-flight request.
          let result;
          try { result = await call(method, args); }
          finally {
            // A network failure must not bind Retry to a dead capability. The host also expires disconnected viewers.
            if (method === 'close') { viewers.delete(args.viewerId); for (const [requestId, item] of openings) if (item.viewerId === args.viewerId) openings.delete(requestId); }
          }
          reply({ result });
        }
      } catch (error) { reply({ error: error instanceof Error ? error.message : 'Simulator request failed.' }); }
    },
    dispose() { disposed = true; for (const viewerId of viewers) void close(viewerId); viewers.clear(); openings.clear(); },
  };
}

// This function is serialized with its dependencies as arguments. It must not close over module state.
function receiver(config, geometryFor, pointFor, inputQueue) {
  window.simulatorTheme = theme => {
    if (!theme || typeof theme !== 'object') return;
    const style = document.documentElement.style;
    for (const key of ['surface', 'ink', 'ink2', 'line', 'hover', 'accent']) {
      if (typeof theme[key] === 'string' && theme[key].length <= 128) style.setProperty('--' + key, theme[key]);
    }
    style.colorScheme = theme.scheme === 'dark' ? 'dark' : 'light';
  };
  window.simulatorTheme(config.theme);
  const stage = document.getElementById('stage'), video = document.getElementById('video');
  const message = document.getElementById('message'), retry = document.getElementById('retry');
  const failure = document.getElementById('failure');
  const back = document.getElementById('back');
  const control = document.getElementById('control'), home = document.getElementById('home'), rotate = document.getElementById('rotate');
  let nextId = 0, epoch = 0, viewerId = null, peer = null, status = null, queue = null, sequence = 0;
  let heartbeat = null, deadline = null, disconnected = null, rotationTimer = null, rotatingGeneration = null, frames = false, active = false, stopped = false, claiming = false;
  const pending = new Map(), pointers = new Map();
  const post = data => {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(data));
    else window.parent.postMessage(data, '*');
  };
  const rpc = (method, args) => new Promise((resolve, reject) => {
    const id = ++nextId;
    // Helper startup and the host's bounded 20-second offer may run slowly on a busy Mac.
    const timeout = method === 'open' || method === 'offer' ? 25000 : 12000;
    const timer = setTimeout(() => { pending.delete(id); if (method === 'open') post({ channel: 'milagre-simulator', id, event: 'cancel' }); reject(new Error('The Mac did not respond. Check the connection and retry.')); }, timeout);
    pending.set(id, { resolve, reject, timer, method }); post({ channel: 'milagre-simulator', id, method, args });
  });
  window.simulatorReply = data => {
    if (data?.channel !== 'milagre-simulator') return;
    const item = pending.get(data.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(data.id);
    if (data.error) item.reject(new Error(data.error)); else item.resolve(data.result);
  };
  window.addEventListener('message', event => { if (event.source === window.parent) { if (event.data?.channel === 'milagre-simulator-theme') window.simulatorTheme(event.data.theme); else window.simulatorReply(event.data); } });
  const geometry = () => geometryFor(status, { width: stage.clientWidth, height: stage.clientHeight });
  const layout = () => {
    const g = geometry(); if (!g) return;
    video.style.width = g.rawWidth + 'px'; video.style.height = g.rawHeight + 'px';
    video.style.transform = 'translate(-50%,-50%) rotate(' + g.rotation + 'deg)';
  };
  new ResizeObserver(layout).observe(stage);
  const render = () => {
    const ready = active && frames && status?.ready;
    back.disabled = home.disabled = rotate.disabled = !(ready && status.controlling);
    control.disabled = !ready || claiming;
    control.hidden = !!status?.controlling;
    if (active) message.textContent = !frames ? 'Connecting video...' : !status?.ready ? 'Preparing simulator input...' : status.controlling ? 'You control this simulator' : 'View only. Another viewer may control it.';
    if (ready) { clearTimeout(deadline); deadline = null; }
    layout();
  };
  const clearInput = () => { queue?.dispose(); queue = null; pointers.clear(); };
  const stop = () => {
    epoch++; active = false; stopped = true; frames = false; clearInput();
    clearInterval(heartbeat); clearTimeout(deadline); clearTimeout(disconnected); clearTimeout(rotationTimer);
    heartbeat = deadline = disconnected = rotationTimer = rotatingGeneration = null;
    if (peer) { peer.ontrack = peer.onconnectionstatechange = peer.oniceconnectionstatechange = null; peer.close(); peer = null; }
    if (video.srcObject) for (const track of video.srcObject.getTracks()) track.stop();
    video.srcObject = null;
    const old = viewerId; viewerId = null; status = null;
    const closing = old ? rpc('close', { viewerId: old }).catch(() => {}) : Promise.resolve();
    for (const [id, item] of pending) {
      if (item.method === 'close') continue;
      if (item.method === 'open') post({ channel: 'milagre-simulator', id, event: 'cancel' });
      clearTimeout(item.timer); item.reject(new Error('Viewer closed.')); pending.delete(id);
    }
    render();
    return closing;
  };
  const fail = error => { stop(); message.textContent = error?.message || 'Simulator connection lost. Retry to reconnect.'; failure.textContent = message.textContent; failure.hidden = false; retry.title = message.textContent + ' Retry'; retry.hidden = false; };
  const acceptStatus = value => {
    if (status && status.generation > value.generation) return;
    if (rotatingGeneration !== null) {
      if (value.generation === rotatingGeneration) value = { ...value, ready: false };
      else { rotatingGeneration = null; clearTimeout(rotationTimer); rotationTimer = null; }
    }
    if (status && (status.generation !== value.generation || status.controlling !== value.controlling)) clearInput();
    status = value;
    if (status.controlling && !queue) {
      const currentViewer = viewerId, generation = status.generation, currentEpoch = epoch;
      queue = inputQueue(async event => {
        const result = await rpc('input', { viewerId: currentViewer, sequence: ++sequence, generation, event });
        if (currentEpoch !== epoch) return;
        if (!result.accepted) {
          clearInput();
          const value = await rpc('status', { viewerId: currentViewer });
          if (currentEpoch === epoch) acceptStatus(value);
        }
      }, error => { if (currentEpoch === epoch) fail(error); });
    }
    render();
  };
  const claim = async takeOver => {
    const currentEpoch = epoch;
    claiming = true; render();
    try { const value = await rpc('control', { viewerId, takeOver }); if (active && currentEpoch === epoch) acceptStatus(value); }
    catch (error) { if (active && currentEpoch === epoch) fail(error); }
    finally { if (currentEpoch === epoch) { claiming = false; render(); } }
  };
  control.onclick = () => { void claim(true); };
  back.onclick = () => queue?.push({ kind: 'button', button: 'back' });
  home.onclick = () => queue?.push({ kind: 'button', button: 'home' });
  rotate.onclick = () => {
    if (!queue || pointers.size) return;
    // iPhones do not support upside-down portrait. A two-way toggle always offers a usable next orientation.
    const orientation = status.orientation.startsWith('landscape') ? 'portrait' : 'landscape-left';
    rotatingGeneration = status.generation;
    const currentEpoch = epoch;
    rotationTimer = setTimeout(() => { if (currentEpoch === epoch) fail(new Error('The simulator did not finish rotating. Retry to reconnect.')); }, 8000);
    queue.push({ kind: 'rotate', orientation });
    // Wait for the new generation before accepting touches in the old geometry.
    back.disabled = home.disabled = rotate.disabled = true; status.ready = false;
  };
  const sendTouch = phase => { if (pointers.size && queue) queue.push({ kind: 'touch', phase, points: Array.from(pointers.values()) }); };
  stage.onpointerdown = event => {
    if (!active || !frames || !status?.controlling || !status.ready || pointers.size >= 2 || event.button > 0) return;
    const rect = stage.getBoundingClientRect();
    const point = pointFor({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry());
    if (!point) return;
    event.preventDefault(); stage.setPointerCapture(event.pointerId);
    // Device Hub starts a gesture with its entire contact set. End/rebegin when adding a second contact.
    if (pointers.size) sendTouch('end');
    pointers.set(event.pointerId, point); sendTouch('begin');
  };
  stage.onpointermove = event => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault(); const rect = stage.getBoundingClientRect();
    const point = pointFor({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry(), true);
    if (point) { pointers.set(event.pointerId, point); sendTouch('move'); }
  };
  const release = event => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault(); sendTouch('end'); pointers.delete(event.pointerId);
    if (pointers.size) sendTouch('begin');
  };
  const cancelTouches = () => { sendTouch('end'); pointers.clear(); };
  stage.onpointerup = release; stage.onpointercancel = cancelTouches; stage.onlostpointercapture = event => { if (pointers.has(event.pointerId)) cancelTouches(); };
  window.addEventListener('blur', () => { sendTouch('end'); pointers.clear(); });
  stage.oncontextmenu = event => event.preventDefault();
  const start = async () => {
    const closing = stop(); stopped = false; active = true; claiming = false; sequence = 0; const currentEpoch = epoch;
    retry.hidden = true; failure.hidden = true; render();
    deadline = setTimeout(() => { if (currentEpoch === epoch) fail(new Error('Video or input could not connect. Check that the simulator is running and retry.')); }, 45000);
    try {
      await closing;
      if (currentEpoch !== epoch) return;
      const opened = await rpc('open', { deviceId: config.deviceId });
      if (currentEpoch !== epoch || stopped) { void rpc('close', { viewerId: opened.viewerId }).catch(() => {}); return; }
      back.hidden = opened.device?.platform !== 'android';
      viewerId = opened.viewerId;
      const connection = new RTCPeerConnection({ iceServers: opened.iceServers }); peer = connection;
      connection.addTransceiver('video', { direction: 'recvonly' });
      connection.ontrack = event => {
        if (currentEpoch !== epoch) return;
        video.srcObject = event.streams[0] || new MediaStream([event.track]);
        event.track.onended = () => { if (currentEpoch === epoch) fail(new Error('The simulator video stopped. Retry to reconnect.')); };
        void video.play().catch(error => { if (currentEpoch === epoch) fail(error); });
      };
      video.onplaying = () => { if (currentEpoch === epoch) { frames = true; render(); } };
      const checkConnection = () => {
        if (currentEpoch !== epoch) return;
        const state = connection.connectionState, ice = connection.iceConnectionState;
        if (state === 'failed' || ice === 'failed') fail(new Error('Video could not reach this device. Check the network and retry.'));
        else if (state === 'disconnected' || ice === 'disconnected') disconnected ||= setTimeout(() => fail(new Error('Video connection lost. Retry to reconnect.')), 6000);
        else { clearTimeout(disconnected); disconnected = null; }
      };
      connection.onconnectionstatechange = connection.oniceconnectionstatechange = checkConnection;
      await connection.setLocalDescription(await connection.createOffer());
      await new Promise((resolve, reject) => {
        if (connection.iceGatheringState === 'complete') { resolve(); return; }
        const timer = setTimeout(() => { connection.removeEventListener('icegatheringstatechange', changed); reject(new Error('Video negotiation timed out. Retry on another network.')); }, 8000);
        const changed = () => { if (connection.iceGatheringState === 'complete') { clearTimeout(timer); connection.removeEventListener('icegatheringstatechange', changed); resolve(); } };
        connection.addEventListener('icegatheringstatechange', changed);
      });
      if (currentEpoch !== epoch) return;
      const answer = await rpc('offer', { viewerId, sdp: connection.localDescription.sdp });
      if (currentEpoch !== epoch) return;
      await connection.setRemoteDescription(answer);
      if (currentEpoch !== epoch) return;
      let polling = false, triedControl = false;
      const poll = async () => {
        if (polling || currentEpoch !== epoch) return;
        polling = true;
        try {
          const value = await rpc('status', { viewerId });
          if (currentEpoch !== epoch) return;
          acceptStatus(value);
          if (value.ready && !triedControl) { triedControl = true; await claim(false); }
        } catch (error) { if (currentEpoch === epoch) fail(error); }
        finally { polling = false; }
      };
      await poll(); if (currentEpoch === epoch && active) heartbeat = setInterval(poll, 1000);
    } catch (error) { if (currentEpoch === epoch) fail(error); }
  };
  retry.onclick = () => { void start(); };
  window.simulatorDispose = stop;
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); message.textContent = 'Viewer paused while hidden.'; retry.hidden = false; } });
  window.addEventListener('pagehide', stop);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') post({ channel: 'milagre-simulator', event: 'close' }); });
  void start();
}

/** Build-time only. A checked-in string keeps script bytes stable across Vite/Metro minification and CSP hashing. */
export function buildSimulatorReceiverScript() {
  return `(${receiver.toString()})(JSON.parse(document.getElementById('config').dataset.config),${simulatorGeometry.toString()},${simulatorPoint.toString()},${createSimulatorInputQueue.toString()});`;
}

/** No hosted asset or native resource: this string travels inside desktop and OTA JS bundles. */
export function createSimulatorReceiverHtml(config) {
  const escaped = JSON.stringify(config).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>
:root{--surface:#ffffff;--ink:#1f2124;--ink2:#62656b;--line:#ecedef;--hover:#f4f5f6;--accent:#0285ff}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font:12px -apple-system,BlinkMacSystemFont,sans-serif;background:var(--surface);color:var(--ink);display:flex;flex-direction:column;color-scheme:inherit}#stage{position:relative;min-height:0;flex:1;background:#101113;touch-action:none;user-select:none;overflow:hidden}video{position:absolute;left:50%;top:50%;object-fit:fill;pointer-events:none}footer{padding:6px 12px;flex-shrink:0;border-top:1px solid var(--line)}#failure{position:absolute;left:16px;right:16px;top:50%;transform:translateY(-50%);margin:0;padding:16px;border-radius:10px;background:var(--surface);color:var(--ink);text-align:center;line-height:1.5}#failure[hidden]{display:none}#message{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}nav{display:flex;gap:8px;align-items:center;justify-content:center}button{display:grid;place-items:center;width:44px;height:44px;padding:0;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--ink2);cursor:pointer}button:hover:not(:disabled){background:var(--hover);color:var(--ink)}button:disabled{opacity:.3;cursor:default}button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}button[hidden]{display:none}button svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
</style></head><body><div id="config" hidden data-config="${escaped}"></div><div id="stage" aria-label="Simulator touch screen"><video id="video" autoplay muted playsinline></video><p id="failure" role="alert" hidden></p></div><footer><p id="message" role="status" aria-live="polite">Connecting...</p><nav aria-label="Simulator controls"><button id="back" aria-label="Back" title="Back" hidden disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg></button><button id="home" aria-label="Home" title="Home" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></svg></button><button id="rotate" aria-label="Rotate" title="Rotate" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="5" width="9" height="14" rx="2" transform="rotate(30 12.5 12)"/><path d="M3 10a9 9 0 0 1 14-7M3 5v5h5m13 4a9 9 0 0 1-14 7m14-2v-5h-5"/></svg></button><button id="control" aria-label="Take control" title="Take control" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13V6a2 2 0 0 1 4 0v6-2a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v4c0 4-3 6-6 6h-1c-2 0-3-1-4-2l-5-6a2 2 0 0 1 3-2l1 1Z"/></svg></button><button id="retry" aria-label="Retry" title="Retry" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5m5 0a8 8 0 1 0-2 6"/></svg></button></nav></footer><script>${SIMULATOR_RECEIVER_SCRIPT}</script></body></html>`;
}
