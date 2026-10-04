import type { PhoneStatus } from "../electron";

/** The one line under "Allow your phone to connect". */
export function phoneStatusLine(status: PhoneStatus | null): string {
  if (!status) return "Checking…";
  switch (status.state) {
    case "off": return "Off";
    case "starting": return "Starting…";
    case "error": return status.error || "Phone access stopped.";
    case "on":
      if (status.remote === "cloudflare" && status.publicUrl) return `Reachable at ${new URL(status.publicUrl).host}`;
      // Without a tunnel the bridge answers on this Mac's loopback only.
      return `This Mac only — ${status.localUrl ? new URL(status.localUrl).hostname : "127.0.0.1"}`;
  }
}

/** The host's QR code is an SVG string; an <img> shows it without letting it run anything. */
export const phoneQrSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
