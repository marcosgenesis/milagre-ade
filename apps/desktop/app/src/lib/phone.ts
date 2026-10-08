import type { PhoneStatus } from "../electron";

/** The one line under "Allow your phone to connect". */
export function phoneStatusLine(status: PhoneStatus | null): string {
  if (!status) return "Checking…";
  switch (status.state) {
    case "off":
      return "Off";
    case "starting":
      return "Starting…";
    case "error":
      return status.error || "Phone access stopped.";
    case "on":
      if (status.remote === "cloudflare" && status.publicUrl) return `Reachable at ${new URL(status.publicUrl).host}`;
      if (status.remote === "relay") {
        if (status.relay === "online") return "On, reachable from any network";
        if (status.relay === "offline") return "On, can't reach the relay. Retrying…";
        return "On, connecting to the relay…";
      }
      // Without a tunnel the bridge answers on this Mac's loopback only.
      return `This Mac only — ${status.localUrl ? new URL(status.localUrl).hostname : "127.0.0.1"}`;
  }
}

/** The line under "Allow on local network". Null until the daemon reports it. */
export function phoneLanLine(status: PhoneStatus | null): string | null {
  if (!status?.lan) return null;
  if (!status.lan.enabled) return "Off";
  if (status.lan.error) return `Couldn't listen on the local network: ${status.lan.error}`;
  if (!status.lan.addresses.length) return "Not connected to a local network";
  return `Reachable at ${status.lan.addresses.join(", ")}`;
}

/** Whether new phones may still pair, and for how many whole minutes (rounded up). Only a relay phone has a window. */
export function pairingWindow(status: PhoneStatus | null, now: number): { open: boolean; minutes: number } | null {
  if (!status || status.remote !== "relay" || status.pairingUntil === undefined) return null;
  const left = status.pairingUntil - now;
  return left > 0 ? { open: true, minutes: Math.ceil(left / 60_000) } : { open: false, minutes: 0 };
}

/** How many phones paired since the last reset. Only a relay phone keeps count. */
export function pairedPhonesLine(status: PhoneStatus | null): string | null {
  if (!status || status.remote !== "relay" || status.pairedPhones === undefined) return null;
  const count = status.pairedPhones;
  return count === 0 ? "No phones yet" : count === 1 ? "1 phone" : `${count} phones`;
}

/** The host's QR code is an SVG string; an <img> shows it without letting it run anything. */
export const phoneQrSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
