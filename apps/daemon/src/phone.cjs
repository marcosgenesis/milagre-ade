const { preparePrivateDirectory, assertPrivate } = require('@milagre/core/private-files');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const QRCode = require('qrcode');
const { startMobileBridge } = require('./mobile-bridge.cjs');
const { readCloudflare } = require('./mobile-cloudflare.cjs');
const { pairingLink, relayPairingLink, computerName } = require('./mobile-pairing.cjs');
const { startRelayHost } = require('./relay-host.cjs');
const { readIdentity, rotateIdentity, readRetired, createPhones } = require('./relay-identity.cjs');
const { b64url } = require('@milagre/shared/relay-crypto');
const defaultTunnels = require('./mobile-tunnel.cjs');

// Without a Cloudflare tunnel the bridge only answers on this Mac's loopback. 8797 is the port `mobile:cloudflare` also defaults to.
const LOCAL_PORT = 8797;
const RELAY_URL = 'wss://relay.milagre.cloud';
// A phone that is not yet known may pair only for this long after the QR was shown, so a leaked link is not a standing invitation.
const PAIRING_WINDOW_MS = 10 * 60 * 1000;
// After a Reset, the old relay room keeps answering for this long, so a phone paired before hears "this Mac was reset".
const RETIRED_MS = 14 * 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const TOKEN = /^[a-f0-9]{64}$/;
const message = error => error instanceof Error ? error.message : String(error);

/**
 * The Phone setting, run by the daemon: the HTTP bridge and its tunnel, started and stopped on request. State lives in
 * `<dataDir>/mobile.json` ({ enabled, token }, 0600). Transitions run one at a time. `setEnabled`, `reset` and `start`
 * return once the new state is saved and the change has begun (`status().state` is then 'starting' or 'off'); `settled()`
 * resolves when it has finished, and every change goes to `onChange`. A start that fails is an 'error' state, not a throw.
 * Without a Cloudflare tunnel the Mac reaches the phone through the public relay (`remote: 'relay'`); `status()` then also
 * carries the relay's `relay` state, `pairingUntil` (ms epoch), the end of the window in which new phones may pair, and
 * `pairedPhones`, how many phones have paired since the last Reset. `onPaired({ pairedPhones })` runs when a phone pairs
 * for the first time. While the phone is on, identities a Reset replaced keep their old relay rooms for RETIRED_MS, only
 * to tell the phones that dial them that this Mac was reset.
 * `allowedRoot` confines a paired phone to one folder (see the bridge); the owner's app never sets it.
 */
function createPhone({ dataDir, tunnels = defaultTunnels, startBridge = startMobileBridge, relayUrl = RELAY_URL, startRelay = startRelayHost, now = Date.now, onChange = () => {}, onPaired = () => {}, localPort = LOCAL_PORT, retryDelaysMs = RETRY_DELAYS_MS, retiredMs = RETIRED_MS, name = computerName, allowedRoot }) {
  const file = path.join(dataDir, 'mobile.json');
  let config; // { enabled, token | null }, read once
  let state = 'off';
  let error;
  let live; // { bridge, tunnel, relay, retired, localUrl, publicUrl, remote, link, qrSvg } while on
  let remote = 'none';
  let relayStatus = 'offline';
  let pairingUntil = 0;
  let relayPhones; // the paired-phone list, one instance so a reset clears what the running host sees
  let generation = 0; // a bridge or retry from an earlier run must not touch this one
  let attempts = 0;
  let retryTimer;
  let queue = Promise.resolve();
  let closed = false;
  const enqueue = work => { const run = queue.then(work); queue = run.catch(() => {}); return run; };

  function status() {
    const on = state === 'on' && live;
    const current = live?.remote ?? remote;
    return {
      enabled: config?.enabled === true, state,
      ...(state === 'error' ? { error } : {}),
      remote: current,
      ...(current === 'relay' ? { relay: relayStatus, pairingUntil, pairedPhones: relayPhones?.count() ?? 0 } : {}),
      ...(on ? { localUrl: live.localUrl, ...(live.publicUrl ? { publicUrl: live.publicUrl } : {}), pairingLink: live.link, qrSvg: live.qrSvg } : {}),
    };
  }
  const changed = () => { try { onChange(status()); } catch { /* a listener must not break the setting */ } };
  function set(next, failure) {
    if (state === next && error === failure) return;
    state = next; error = failure;
    changed();
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
    if (process.platform === "win32") preparePrivateDirectory(dataDir);
    const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ enabled: config.enabled, token: config.token }, null, 2), { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
  }

  const openPairing = () => { pairingUntil = now() + PAIRING_WINDOW_MS; };

  // The tunnel or relay goes first so it never answers 502 from a bridge that is already gone.
  async function closeLive(old) {
    await old?.tunnel?.close().catch(() => {});
    await old?.relay?.close().catch(() => {});
    await Promise.all((old?.retired ?? []).map(({ host, timer }) => { clearTimeout(timer); return host.close().catch(() => {}); }));
    await old?.bridge?.close().catch(() => {});
  }

  /** The old rooms a Reset left behind, each held until it expires (see RETIRED_MS). */
  async function holdRetired(current) {
    const held = [];
    for (const old of await readRetired(dataDir, now())) {
      // A reset that failed after saving the retired key may still use it: two hosts on one id would knock each other off.
      if (old.hostId === current.hostId) continue;
      const host = startRelay({ relayUrl, identity: { hostId: old.hostId, sign: old.sign }, retired: true });
      const timer = setTimeout(() => { void host.close().catch(() => {}); }, Math.min(old.until - now(), 2 ** 31 - 1));
      timer.unref?.();
      held.push({ host, timer });
    }
    return held;
  }

  async function teardown() {
    generation++;
    clearTimeout(retryTimer);
    const old = live;
    live = undefined;
    relayStatus = 'offline';
    await closeLive(old);
  }

  async function cloudflareOrNull() {
    try { await fs.access(path.join(dataDir, 'cloudflare.json')); } catch { return null; }
    return readCloudflare(dataDir);
  }

  // `retrying`: a failure waits and tries again (up to retryDelaysMs.length times) instead of ending in 'error'.
  async function launch({ retrying = false } = {}) {
    const mine = generation;
    set('starting');
    let bridge, tunnel, relay, retired;
    try {
      const cloudflare = await cloudflareOrNull();
      remote = cloudflare ? 'cloudflare' : 'relay';
      relayStatus = 'connecting';
      bridge = await startBridge({ dataDir, port: cloudflare ? cloudflare.port : localPort, token: config.token, ...(allowedRoot ? { allowedRoot } : {}) });
      let link;
      if (cloudflare) {
        tunnel = await tunnels.startNamedTunnel({ hostname: cloudflare.hostname, connectorToken: cloudflare.connectorToken });
        link = pairingLink({ address: tunnel.url || bridge.url, token: config.token, name: name(), access: cloudflare.access });
      } else {
        const identity = await readIdentity(dataDir);
        relayPhones ??= createPhones(dataDir);
        await relayPhones.load();
        const known = relayPhones;
        const phones = {
          isKnown: id => known.isKnown(id),
          async add(id) {
            await known.add(id);
            // A pairing the old host saw while a reset tore it down is about to be forgotten: nothing to announce.
            if (mine !== generation) return;
            changed();
            try { onPaired({ pairedPhones: known.count() }); } catch { /* a listener must not break the setting */ }
          },
        };
        relay = startRelay({
          relayUrl, identity, phones, token: config.token, bridgeUrl: bridge.url,
          canPair: () => now() < pairingUntil,
          onStatus: next => {
            if (mine !== generation) return;
            relayStatus = next;
            changed();
          },
        });
        retired = await holdRetired(identity);
        link = relayPairingLink({ relay: relayUrl, hostId: identity.hostId, key: b64url(identity.box.publicKey), token: config.token, name: name() });
      }
      const publicUrl = tunnel?.url;
      const qrSvg = await QRCode.toString(link, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
      live = { bridge, tunnel, relay, retired, localUrl: bridge.url, publicUrl, remote, link, qrSvg };
      attempts = 0;
      void bridge.lost.then(() => { if (mine === generation) restartLater(); });
      set('on');
    } catch (failure) {
      await closeLive({ tunnel, relay, retired, bridge });
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
    void enqueue(() => closeLive(old));
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
        if (enabled) openPairing();
        await save();
        attempts = 0;
        if (enabled) set('starting'); else set('off');
        void apply().catch(() => {});
      });
      return status();
    },
    /**
     * A new token: phones paired with the old one stop working and scan again. Whatever runs is stopped first, so the
     * old host can never see the new pairing window or re-add a phone after the list is cleared. Nothing here needs a
     * phone or the relay to answer. A failure part way leaves an enabled phone stopped in 'error'; with the phone off
     * it stays 'off' and the reset throws, so the caller hears it failed.
     */
    async reset() {
      await enqueue(async () => {
        await load();
        if (config.enabled) set('starting');
        await teardown();
        try {
          config.token = randomBytes(32).toString('hex');
          await save();
          if (!relayPhones) { relayPhones = createPhones(dataDir); await relayPhones.load(); }
          const hadPhones = relayPhones.count() > 0;
          // Phones paired through the relay are bound to the old token, so they go with it.
          await relayPhones.clear();
          // A new host id and key too: an old link can no longer reach this Mac. The old room stays held for a while,
          // only to tell the phones that paired there to scan the new code.
          await rotateIdentity(dataDir, hadPhones ? { retireUntil: now() + retiredMs, now: now() } : {});
          openPairing();
        } catch (failure) {
          if (config.enabled) { set('error', message(failure)); return; }
          set('off');
          throw failure;
        }
        if (config.enabled) { attempts = 0; void apply().catch(() => {}); } else set('off');
      });
      return status();
    },
    /** Lets phones that are not yet known pair for another window. Settings calls it whenever it shows the QR. */
    async openPairing() {
      await enqueue(async () => {
        await load();
        if (config.enabled) { openPairing(); changed(); }
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

module.exports = { createPhone, LOCAL_PORT, RELAY_URL, PAIRING_WINDOW_MS, RETIRED_MS };
