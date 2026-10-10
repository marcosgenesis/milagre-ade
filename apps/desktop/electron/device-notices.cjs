// @ts-check
const TAKE = "devices:take-notices";
const CONFIRM = "devices:confirm-notices";

/**
 * The "New phone paired" notice, kept by this Mac's host until a window shows it, so a phone that pairs while Milagre
 * is closed is still announced when it opens. The window takes the notices (devices:take-notices: the host holds them
 * for it, so no other window shows them meanwhile), shows them, then confirms (devices:confirm-notices). A reply lost on
 * the way never loses one: the host offers it again when this connection closes or the claim times out.
 *
 * `connected()` runs when the window has its host (at launch, and after a reconnect): whatever paired meanwhile is
 * announced as having paired while Milagre was closed. `paired(payload)` runs on the host's phone:paired event.
 * `methods()` must be the commands of the host connected now: a host without devices:take-notices (an older one, maybe
 * reconnected to after a newer one) keeps nothing for later, so its event is announced straight away, as before.
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
    /** @type {any} */
    let taken;
    try {
      taken = await invoke(TAKE, []);
    } catch {
      return; // Nothing was shown; the host offers whatever it held again.
    }
    const phones = (Array.isArray(taken?.devices) ? taken.devices : [])
      .filter((/** @type {any} */ device) => device && device.kind === "phone")
      .map((/** @type {any} */ device) => ({ name: typeof device.name === "string" ? device.name : null }));
    if (phones.length) notifyPhones(phones, { away });
    if (typeof taken?.claim !== "string") return;
    try {
      await invoke(CONFIRM, [taken.claim]);
    } catch {
      // Shown but not confirmed: the host may offer it again, which beats never showing it.
    }
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
