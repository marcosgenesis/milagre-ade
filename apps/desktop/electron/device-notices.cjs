// @ts-check
const TAKE = "devices:take-notices";

/**
 * The "New phone paired" notice, kept by this Mac's host until a window takes it (devices:take-notices), so a phone
 * that pairs while Milagre is closed is still announced when it opens. The host hands each pairing out once, so two
 * windows, or a connect racing the pairing event, never show it twice.
 *
 * `connected()` runs when the window has its host (at launch, and after a reconnect): whatever paired meanwhile is
 * announced as having paired while Milagre was closed. `paired(payload)` runs on the host's phone:paired event. A host
 * from before devices:take-notices keeps nothing for later, so its event is announced straight away, as before.
 *
 * @param {{
 *   methods: () => readonly string[] | null | undefined;
 *   invoke: (method: string, args: unknown[]) => Promise<unknown>;
 *   notifyPhones: (phones: Array<{ name: string | null }>, options: { away: boolean }) => unknown;
 *   notifyDevice: (kind: string | undefined) => unknown;
 * }} options
 */
function createDeviceNotices({ methods, invoke, notifyPhones, notifyDevice }) {
  /** @param {boolean} away */
  async function take(away) {
    let taken;
    try {
      taken = await invoke(TAKE, []);
    } catch {
      return; // The host went away; the next connect asks again for whatever it still keeps.
    }
    const phones = (Array.isArray(taken) ? taken : [])
      .filter((device) => device && device.kind === "phone")
      .map((device) => ({ name: typeof device.name === "string" ? device.name : null }));
    if (phones.length) notifyPhones(phones, { away });
  }
  return {
    connected() {
      if (methods()?.includes(TAKE)) return take(true);
      return Promise.resolve();
    },
    /** @param {{ kind?: string } | undefined} payload */
    paired(payload) {
      const known = methods();
      // Not connected yet: the launch's connected() takes it.
      if (!known) return Promise.resolve();
      if (known.includes(TAKE)) return take(false);
      // A computer pairs only once its owner clicked Allow here, so only a phone's pairing needs telling.
      if (payload?.kind !== "computer") notifyDevice(payload?.kind);
      return Promise.resolve();
    },
  };
}

module.exports = { createDeviceNotices };
