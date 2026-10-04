const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const QRCode = require('qrcode');
const { startMobileBridge } = require('./mobile-bridge.cjs');
const { readCloudflare } = require('./mobile-cloudflare.cjs');
const { pairingLink, computerName } = require('./mobile-pairing.cjs');
const defaultTunnels = require('./mobile-tunnel.cjs');

// Without a Cloudflare tunnel the bridge only answers on this Mac's loopback. 8797 is the port `mobile:cloudflare` also defaults to.
const LOCAL_PORT = 8797;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const TOKEN = /^[a-f0-9]{64}$/;
const message = error => error instanceof Error ? error.message : String(error);

/**
 * The Phone setting, run by the daemon: the HTTP bridge and its tunnel, started and stopped on request. State lives in
 * `<dataDir>/mobile.json` ({ enabled, token }, 0600). Transitions run one at a time. `setEnabled`, `reset` and `start`
 * return once the new state is saved and the change has begun (`status().state` is then 'starting' or 'off'); `settled()`
 * resolves when it has finished, and every change goes to `onChange`. A start that fails is an 'error' state, not a throw.
 */
function createPhone({ dataDir, tunnels = defaultTunnels, startBridge = startMobileBridge, onChange = () => {}, localPort = LOCAL_PORT, retryDelaysMs = RETRY_DELAYS_MS, name = computerName }) {
  const file = path.join(dataDir, 'mobile.json');
  let config; // { enabled, token | null }, read once
  let state = 'off';
  let error;
  let live; // { bridge, tunnel, localUrl, publicUrl, remote, link, qrSvg } while on
  let remote = 'none';
  let generation = 0; // a bridge or retry from an earlier run must not touch this one
  let attempts = 0;
  let retryTimer;
  let queue = Promise.resolve();
  let closed = false;
  const enqueue = work => { const run = queue.then(work); queue = run.catch(() => {}); return run; };

  function status() {
    const on = state === 'on' && live;
    return {
      enabled: config?.enabled === true, state,
      ...(state === 'error' ? { error } : {}),
      remote: live?.remote ?? remote,
      ...(on ? { localUrl: live.localUrl, ...(live.publicUrl ? { publicUrl: live.publicUrl } : {}), pairingLink: live.link, qrSvg: live.qrSvg } : {}),
    };
  }
  function set(next, failure) {
    if (state === next && error === failure) return;
    state = next; error = failure;
    try { onChange(status()); } catch { /* a listener must not break the setting */ }
  }

  async function load() {
    if (config) return config;
    try {
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      config = { enabled: value.enabled === true && TOKEN.test(value.token), token: TOKEN.test(value.token) ? value.token : null };
    } catch { config = { enabled: false, token: null }; }
    return config;
  }
  async function save() {
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ enabled: config.enabled, token: config.token }, null, 2), { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
  }

  async function teardown() {
    generation++;
    clearTimeout(retryTimer);
    const old = live;
    live = undefined;
    // The tunnel goes first so it never answers 502 from a bridge that is already gone.
    await old?.tunnel?.close().catch(() => {});
    await old?.bridge.close().catch(() => {});
  }

  async function cloudflareOrNull() {
    try { await fs.access(path.join(dataDir, 'cloudflare.json')); } catch { return null; }
    return readCloudflare(dataDir);
  }

  // `retrying`: a failure waits and tries again (up to retryDelaysMs.length times) instead of ending in 'error'.
  async function launch({ retrying = false } = {}) {
    const mine = generation;
    set('starting');
    let bridge, tunnel;
    try {
      const cloudflare = await cloudflareOrNull();
      remote = cloudflare ? 'cloudflare' : 'none';
      bridge = await startBridge({ dataDir, port: cloudflare ? cloudflare.port : localPort, token: config.token });
      if (cloudflare) tunnel = await tunnels.startNamedTunnel({ hostname: cloudflare.hostname, connectorToken: cloudflare.connectorToken });
      const publicUrl = tunnel?.url;
      const link = pairingLink({ address: publicUrl || bridge.url, token: config.token, name: name(), access: cloudflare?.access });
      const qrSvg = await QRCode.toString(link, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
      live = { bridge, tunnel, localUrl: bridge.url, publicUrl, remote, link, qrSvg };
      attempts = 0;
      void bridge.lost.then(() => { if (mine === generation) restartLater(); });
      set('on');
    } catch (failure) {
      await tunnel?.close().catch(() => {});
      await bridge?.close().catch(() => {});
      if (retrying && attempts < retryDelaysMs.length) restartLater();
      else set('error', message(failure));
    }
  }

  // A bridge that lost the daemon would leave the tunnel answering 502, so it is started again.
  function restartLater() {
    if (closed || !config?.enabled) return;
    const mine = ++generation;
    const delay = retryDelaysMs[attempts++];
    set('starting');
    const old = live;
    live = undefined;
    // Closing is queued so a new enable or disable cannot interleave with it.
    void enqueue(async () => {
      await old?.tunnel?.close().catch(() => {});
      await old?.bridge.close().catch(() => {});
    });
    retryTimer = setTimeout(() => {
      void enqueue(async () => { if (mine === generation && !closed && config.enabled) await launch({ retrying: true }); });
    }, delay);
  }

  // Applies the saved setting: whatever runs is stopped, and a start follows if the phone is enabled.
  function apply() {
    return enqueue(async () => {
      await teardown();
      if (closed) return;
      if (config.enabled) await launch(); else set('off');
    });
  }

  return {
    status,
    settled: () => queue,
    async setEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('Expected enabled to be true or false');
      await enqueue(async () => {
        await load();
        if (enabled && config.enabled && state !== 'error') return;
        config.enabled = enabled;
        if (enabled && !config.token) config.token = randomBytes(32).toString('hex');
        await save();
        attempts = 0;
        if (enabled) set('starting'); else set('off');
        void apply().catch(() => {});
      });
      return status();
    },
    /** A new token: phones paired with the old one stop working and scan again. */
    async reset() {
      await enqueue(async () => {
        await load();
        config.token = randomBytes(32).toString('hex');
        await save();
        if (config.enabled) { attempts = 0; set('starting'); void apply().catch(() => {}); }
      });
      return status();
    },
    /** On daemon boot: starts the phone if it was left enabled. */
    async start() {
      await enqueue(async () => {
        await load();
        if (config.enabled && !closed) { set('starting'); void apply().catch(() => {}); }
      });
      return status();
    },
    async close() {
      closed = true;
      await queue;
      await enqueue(teardown);
    },
  };
}

module.exports = { createPhone, LOCAL_PORT };
