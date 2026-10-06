import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { simulatorGeometry, simulatorPoint, createSimulatorInputQueue, createSimulatorBridge, createSimulatorReceiverHtml, buildSimulatorReceiverScript, SIMULATOR_RECEIVER_SCRIPT } from './simulator-receiver.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const portrait = { width: 400, height: 800, orientation: 'portrait' };
test('letterboxing ignores outside taps and maps displayed pixels to raw capture', () => {
  const geometry = simulatorGeometry(portrait, { width: 600, height: 600 });
  assert.deepEqual(geometry, { left: 150, top: 0, width: 300, height: 600, rawWidth: 300, rawHeight: 600, rotation: 0 });
  assert.equal(simulatorPoint({ x: 100, y: 30 }, geometry), null);
  assert.deepEqual(simulatorPoint({ x: 225, y: 450 }, geometry), { x: .25, y: .75 });
  assert.deepEqual(simulatorPoint({ x: 700, y: -10 }, geometry, true), { x: 1, y: 0 });
});
test('all orientations invert the displayed rotation, without rotating already-landscape buffers twice', () => {
  for (const [orientation, rotation, point] of [
    ['portrait', 0, { x: .25, y: .75 }],
    ['landscape-left', 90, { x: .75, y: .75 }],
    ['landscape-right', -90, { x: .25, y: .25 }],
    ['portrait-upside-down', 180, { x: .75, y: .25 }],
  ]) {
    const g = simulatorGeometry({ ...portrait, orientation }, { width: 800, height: 800 });
    assert.equal(g.rotation, rotation);
    assert.deepEqual(simulatorPoint({ x: g.left + g.width / 4, y: g.top + g.height * .75 }, g), point);
  }
  assert.equal(simulatorGeometry({ width: 800, height: 400, orientation: 'landscape-left' }, { width: 800, height: 800 }).rotation, 0);
  assert.equal(simulatorGeometry({ ...portrait, width: 0 }, { width: 600, height: 600 }), null);
});
test('slow input coalesces moves while preserving begin/end and one request in flight', async () => {
  const gate = deferred(); const sent = [];
  const queue = createSimulatorInputQueue(async event => { sent.push(event); if (sent.length === 1) await gate.promise; }, assert.fail);
  queue.push({ kind: 'touch', phase: 'begin', points: [{ x: 0, y: 0 }] });
  for (let x = 1; x < 100; x++) queue.push({ kind: 'touch', phase: 'move', points: [{ x: x / 100, y: 0 }] });
  queue.push({ kind: 'touch', phase: 'end', points: [{ x: 1, y: 0 }] });
  assert.equal(sent.length, 1);
  gate.resolve(); await tick();
  assert.deepEqual(sent.map(event => event.phase), ['begin', 'move', 'end']);
  assert.equal(sent[1].points[0].x, .99);
});
test('cancellation drops queued input and a late send cannot resurrect it', async () => {
  const gate = deferred(); const sent = []; const errors = [];
  const queue = createSimulatorInputQueue(async event => { sent.push(event); await gate.promise; }, error => errors.push(error));
  queue.push({ kind: 'button', button: 'home' }); queue.push({ kind: 'button', button: 'home' });
  queue.dispose(); gate.resolve(); await tick();
  queue.push({ kind: 'button', button: 'home' });
  assert.equal(sent.length, 1); assert.equal(errors.length, 0);
});
test('queue overflow fails closed instead of dropping a touch boundary', () => {
  const errors = [];
  const queue = createSimulatorInputQueue(() => new Promise(() => {}), error => errors.push(error), 2);
  for (let i = 0; i < 4; i++) queue.push({ kind: 'touch', phase: 'begin', points: [{ x: .5, y: .5 }] });
  assert.match(errors[0].message, /too slow/i);
});
const request = (id, method, args = {}) => ({ channel: 'milagre-simulator', id, method, args });
test('wrapper closes an open that resolves after unmount and never replies to the old receiver', async () => {
  const gate = deferred(); const calls = []; const replies = [];
  const bridge = createSimulatorBridge(async (method, args) => { calls.push([method, args]); return method === 'open' ? gate.promise : null; }, value => replies.push(value));
  const opening = bridge.receive(request(1, 'open', { deviceId: 'sim' }));
  bridge.dispose(); gate.resolve({ viewerId: 'old' }); await opening;
  assert.deepEqual(calls, [['open', { deviceId: 'sim' }], ['close', { viewerId: 'old' }]]);
  assert.equal(replies.length, 0);
});
test('timed out open is canceled, retry opens a fresh session, and late success is closed', async () => {
  const gate = deferred(); const calls = []; const replies = [];
  const bridge = createSimulatorBridge(async (method, args) => { calls.push([method, args]); return method === 'open' ? args.deviceId === 'first' ? gate.promise : { viewerId: 'fresh' } : null; }, value => replies.push(value));
  const opening = bridge.receive(request(1, 'open', { deviceId: 'first' }));
  await bridge.receive({ channel: 'milagre-simulator', id: 1, event: 'cancel' });
  await bridge.receive(request(2, 'open', { deviceId: 'second' }));
  assert.equal(replies[0].result.viewerId, 'fresh');
  gate.resolve({ viewerId: 'stale' }); await opening;
  assert.ok(calls.some(([method, args]) => method === 'close' && args.viewerId === 'stale'));
  assert.equal(replies.length, 1);
  bridge.dispose();
});
test('timeout racing a completed open still closes its capability', async () => {
  const calls = [];
  const bridge = createSimulatorBridge(async (method, args) => { calls.push([method, args]); return method === 'open' ? { viewerId: 'orphan' } : null; }, () => {});
  await bridge.receive(request(1, 'open', { deviceId: 'sim' }));
  await bridge.receive({ channel: 'milagre-simulator', id: 1, event: 'cancel' });
  await tick();
  assert.deepEqual(calls[1], ['close', { viewerId: 'orphan' }]);
});
test('failed close does not keep retry attached to a dead session', async () => {
  const replies = []; let opens = 0;
  const bridge = createSimulatorBridge(async method => { if (method === 'open') return { viewerId: `viewer-${++opens}` }; throw new Error('Connection lost'); }, reply => replies.push(reply));
  await bridge.receive(request(1, 'open', { deviceId: 'sim' }));
  await bridge.receive(request(2, 'close', { viewerId: 'viewer-1' }));
  await bridge.receive(request(3, 'open', { deviceId: 'sim' }));
  assert.equal(replies[2].result?.viewerId, 'viewer-2');
  bridge.dispose();
});
test('wrapper rejects unknown commands and foreign viewers; dispose releases only owned viewers', async () => {
  const calls = []; const replies = [];
  const bridge = createSimulatorBridge(async (method, args) => { calls.push([method, args]); return method === 'open' ? { viewerId: 'mine' } : null; }, value => replies.push(value));
  await bridge.receive(request(1, 'open', { deviceId: 'sim' }));
  await bridge.receive(request(2, 'input', { viewerId: 'foreign' }));
  await bridge.receive(request(3, 'shell', {}));
  assert.equal(calls.length, 1); assert.match(replies[1].error, /viewer/i); assert.match(replies[2].error, /command/i);
  bridge.dispose(); await tick();
  assert.deepEqual(calls[1], ['close', { viewerId: 'mine' }]);
});
test('HTML embeds the receiver in the JS bundle and escapes device identifiers', () => {
  const html = createSimulatorReceiverHtml({ deviceId: '</script><script>bad()</script>' });
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.ok(html.includes('RTCPeerConnection'));
  assert.ok(html.includes('playsinline'));
  assert.ok(!html.includes('src="http'));
});
test('bundled script stays identical to tested source and every device uses the same CSP hash', () => {
  assert.equal(SIMULATOR_RECEIVER_SCRIPT, buildSimulatorReceiverScript(), 'Run node packages/shared/scripts/generate-simulator-receiver.mjs after editing the receiver');
  for (const deviceId of ['one', 'two', '</script>']) assert.equal(createSimulatorReceiverHtml({ deviceId }).match(/<script>([\s\S]+)<\/script>/)[1], SIMULATOR_RECEIVER_SCRIPT);
});

/** Exercise the exact bundled browser script, with only browser/WebRTC boundaries replaced. */
function browserHarness(call, { playVideo = true } = {}) {
  const listeners = {}, elements = {}, timers = new Map(), intervals = new Map(), peers = [];
  let serial = 0;
  for (const id of ['config', 'stage', 'video', 'message', 'retry', 'control', 'home', 'rotate', 'back']) elements[id] = { style: {}, clientWidth: 600, clientHeight: 600, dataset: { config: JSON.stringify({ deviceId: 'sim' }) }, getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {} };
  const track = { stop() {} };
  elements.video.play = async () => { if (playVideo) elements.video.onplaying?.(); };
  const themeValues = {}; const rootStyle = { setProperty: (key,value) => { themeValues[key] = value; } };
  const document = { documentElement: { style: rootStyle }, hidden: false, getElementById: id => elements[id], addEventListener: (name, fn) => { listeners[name] = fn; } };
  const window = { addEventListener: (name, fn) => { listeners[name] = fn; }, ReactNativeWebView: { postMessage: json => { void bridge.receive(JSON.parse(json)); } } };
  const bridge = createSimulatorBridge(call, reply => window.simulatorReply(JSON.parse(JSON.stringify(reply))));
  class Peer {
    iceGatheringState = 'complete'; connectionState = 'connected'; iceConnectionState = 'connected';
    constructor() { peers.push(this); }
    addTransceiver() {}
    async createOffer() { return { type: 'offer', sdp: 'offer' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription() { this.ontrack?.({ streams: [{ getTracks: () => [track] }], track }); }
    close() { this.closed = true; }
  }
  const context = { window, document, RTCPeerConnection: Peer, ResizeObserver: class { observe() {} },
    setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { const id = ++serial; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id),
  };
  runInNewContext(SIMULATOR_RECEIVER_SCRIPT, context);
  return { window, elements, document, listeners, peers, bridge, intervals, timeout(delay) { for (const [id, value] of timers) if (value.delay === delay) { timers.delete(id); value.fn(); } }, async flush() { await tick(); await tick(); } };
}
const readyStatus = { ...portrait, generation: 1, ready: true, controlling: true };
function fakeHost(calls, status = readyStatus) {
  return async (method, args) => {
    calls.push([method, args]);
    if (method === 'open') return { viewerId: 'viewer', iceServers: [] };
    if (method === 'offer') return { type: 'answer', sdp: 'answer' };
    if (method === 'input') return { accepted: true };
    if (method === 'status' || method === 'control') return status;
    return null;
  };
}
const pointer = (pointerId, clientX = 300, clientY = 300) => ({ pointerId, clientX, clientY, button: 0, preventDefault() {} });
test('bundled receiver releases pointer cancellation and closes video/control on page hide', async () => {
  const calls = []; const h = browserHarness(fakeHost(calls)); await h.flush();
  assert.equal(h.elements.message.textContent, 'You control this simulator');
  h.elements.stage.onpointerdown(pointer(1)); h.elements.stage.onpointermove(pointer(1, 350)); h.elements.stage.onpointercancel(pointer(1)); await h.flush();
  assert.deepEqual(calls.filter(([method]) => method === 'input').map(([, args]) => args.event.phase), ['begin', 'move', 'end']);
  h.document.hidden = true; h.listeners.visibilitychange(); await h.flush();
  assert.equal(h.peers[0].closed, true); assert.equal(h.intervals.size, 0);
  assert.ok(calls.some(([method]) => method === 'close'));
  h.elements.stage.onpointerdown(pointer(2)); await h.flush();
  assert.equal(calls.filter(([method]) => method === 'input').length, 3);
});
test('bundled receiver shows a bounded negotiation failure when no video frames arrive', async () => {
  const calls = []; const h = browserHarness(fakeHost(calls), { playVideo: false }); await h.flush();
  h.timeout(45000); await h.flush();
  assert.match(h.elements.message.textContent, /could not connect/);
  assert.equal(h.elements.retry.hidden, false); assert.equal(h.peers[0].closed, true);
});
test('bundled receiver cancels a timed out open and retries without inheriting old input', async () => {
  const gate = deferred(), calls = []; let attempts = 0;
  const host = fakeHost(calls);
  const h = browserHarness(async (method, args) => method === 'open' && ++attempts === 1 ? gate.promise : host(method, args));
  await h.flush(); h.timeout(12000); await h.flush();
  assert.equal(h.elements.retry.hidden, true, 'opening gets time for the helper to start on a busy Mac');
  h.timeout(25000); await h.flush();
  assert.equal(h.elements.retry.hidden, false);
  h.elements.retry.onclick(); await h.flush();
  assert.equal(h.elements.message.textContent, 'You control this simulator');
  gate.resolve({ viewerId: 'orphan', iceServers: [] }); await h.flush();
  assert.ok(calls.some(([method, args]) => method === 'close' && args.viewerId === 'orphan'));
  assert.equal(calls.filter(([method]) => method === 'input').length, 0);
  h.bridge.dispose();
});
test('slow video negotiation can finish after the ordinary RPC deadline', async () => {
  const gate = deferred(), calls = [], host = fakeHost(calls);
  const h = browserHarness(async (method, args) => method === 'offer' ? gate.promise : host(method, args));
  await h.flush(); h.timeout(12000); await h.flush();
  assert.equal(h.elements.retry.hidden, true);
  assert.equal(h.peers[0].closed, undefined);
  gate.resolve({ type: 'answer', sdp: 'answer' }); await h.flush();
  assert.equal(h.elements.message.textContent, 'You control this simulator');
  h.bridge.dispose();
});
test('video negotiation still expires at 25 seconds and releases the viewer', async () => {
  const calls = [], host = fakeHost(calls);
  const h = browserHarness(async (method, args) => method === 'offer' ? new Promise(() => {}) : host(method, args));
  await h.flush(); h.timeout(25000); await h.flush();
  assert.match(h.elements.message.textContent, /did not respond/);
  assert.equal(h.elements.retry.hidden, false); assert.equal(h.peers[0].closed, true);
  assert.ok(calls.some(([method]) => method === 'close'));
});
test('status keeps its shorter 12-second connection-loss deadline', async () => {
  const calls = [], host = fakeHost(calls);
  const h = browserHarness(async (method, args) => method === 'status' ? new Promise(() => {}) : host(method, args));
  await h.flush(); h.timeout(12000); await h.flush();
  assert.match(h.elements.message.textContent, /did not respond/);
  assert.equal(h.elements.retry.hidden, false); assert.equal(h.peers[0].closed, true);
});
test('rotation waits for a new geometry generation even when an old status says ready', async () => {
  const calls = []; const h = browserHarness(fakeHost(calls)); await h.flush();
  h.elements.rotate.onclick(); await h.flush();
  for (const poll of h.intervals.values()) await poll();
  h.elements.stage.onpointerdown(pointer(1)); await h.flush();
  assert.equal(calls.filter(([method, args]) => method === 'input' && args.event.kind === 'touch').length, 0);
  h.bridge.dispose();
});
test('Rotate returns landscape phones to portrait without requesting unsupported upside-down orientation', async () => {
  for (const [orientation, target] of [['portrait', 'landscape-left'], ['landscape-left', 'portrait'], ['landscape-right', 'portrait']]) {
    const calls = []; const h = browserHarness(fakeHost(calls, { ...readyStatus, orientation })); await h.flush();
    h.elements.rotate.onclick(); await h.flush();
    assert.equal(calls.find(([method]) => method === 'input')[1].event.orientation, target);
    h.bridge.dispose();
  }
});

test('Android Back is shown only for Android and sends a scoped button event', async () => {
 const calls=[];const base=fakeHost(calls);
 const h=browserHarness(async(method,args)=>method==='open'?{viewerId:'viewer',iceServers:[],device:{platform:'android'}}:base(method,args));
 await h.flush();assert.equal(h.elements.back.hidden,false);assert.equal(h.elements.back.disabled,false);
 h.elements.back.onclick();await h.flush();
 assert.deepEqual(calls.find(([m])=>m==='input')[1].event,{kind:'button',button:'back'});
 const ios=browserHarness(fakeHost([]));await ios.flush();assert.equal(ios.elements.back.hidden,true);
});

test('theme updates restyle controls without reopening the stream', async () => {
 const calls=[];const h=browserHarness(fakeHost(calls));await h.flush();
 assert.equal(typeof h.window.simulatorTheme,'function');
 h.window.simulatorTheme({surface:'#fff',ink:'#111',ink2:'#555',line:'#ddd',hover:'#eee',accent:'#08f',scheme:'light'});
 assert.equal(h.document.documentElement.style.colorScheme,'light');
 assert.equal(calls.filter(([m])=>m==='open').length,1);assert.equal(h.peers[0].closed,undefined);
});
